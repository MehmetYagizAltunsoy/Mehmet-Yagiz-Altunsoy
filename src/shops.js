// Mağaza erişim kontrolü: bu bilgisayardan açılmayan mağazalar siteden gizlenir.
// Kontrol sunucunun çalıştığı internet bağlantısıyla yapılır (Türkiye'de çalışıyorsa Türkiye'den).
import { db, tx, USD_RATE } from "./db.js";

db.exec(`CREATE TABLE IF NOT EXISTS shop_health (
  shop_id    TEXT PRIMARY KEY,
  shop_name  TEXT,
  ok         INTEGER DEFAULT 1,     -- 0 = açılmıyor, gizli
  reason     TEXT,
  samples    TEXT,                  -- denenecek örnek bağlantılar (JSON)
  checked_at TEXT
)`);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CHECK_HOURS = 6;
const hiddenByUser = () => (process.env.SHOPS_HIDE || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Fiyat çekerken görülen bağlantıları örnek olarak sakla (mağaza gizliyken de tekrar denenebilsin)
const upSample = db.prepare(`INSERT INTO shop_health (shop_id, shop_name, samples) VALUES (?, ?, ?)
  ON CONFLICT(shop_id) DO UPDATE SET shop_name = excluded.shop_name,
    samples = CASE WHEN shop_health.samples IS NULL OR shop_health.checked_at IS NULL THEN excluded.samples ELSE shop_health.samples END`);
const refreshSamples = db.prepare("UPDATE shop_health SET samples = ? WHERE shop_id = ?");
export function rememberSamples(map) {
  tx(() => { for (const [id, v] of map) upSample.run(id, v.name, JSON.stringify(v.urls.slice(0, 3))); });
}

// Fiyat eklenirken atlanacak mağazalar
export function blockedShops() {
  const ids = new Set(db.prepare("SELECT shop_id FROM shop_health WHERE ok = 0").all().map((r) => r.shop_id));
  return { ids, names: new Set(hiddenByUser()) };
}
export const isBlocked = (b, shopId, shopName) => b.ids.has(String(shopId)) || b.names.has(String(shopName).toLowerCase());

// Tek bir bağlantıyı dene: yönlendirmeleri takip et, gerçekten açılıyor mu bak
async function probe(url) {
  let u = url;
  for (let hop = 0; hop < 8; hop++) {
    let r;
    try {
      r = await fetch(u, {
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8" },
      });
    } catch (e) {
      const host = new URL(u).host;
      // IsThereAnyDeal'ın kendi yönlendirme adresine ulaşılamıyorsa mağaza hakkında karar verme
      if (/(^|\.)itad\.link$|isthereanydeal\.com$/.test(host)) return { verdict: "unknown", why: `${host}: ${e.cause?.code || e.name}` };
      return { verdict: "down", why: `${host}: ${e.cause?.code || e.name}` };
    }
    try { await r.body?.cancel(); } catch {}
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u).href; continue; }
    const host = new URL(u).host;
    if (r.status === 451) return { verdict: "down", why: `${host}: erişim engeli (451)` };
    if (r.status >= 500) return { verdict: "down", why: `${host}: sunucu hatası (${r.status})` };
    // 401/403/429: site cevap veriyor (çoğu zaman bot koruması, tarayıcıda açılır); 404: oyuna özel
    return { verdict: "up", why: `${host}: ${r.status}` };
  }
  return { verdict: "unknown", why: "çok fazla yönlendirme" };
}

let checking = false;
export async function checkShops({ force = false } = {}) {
  if (checking) return;
  checking = true;
  try {
    const due = db.prepare(`SELECT shop_id, shop_name, ok, samples FROM shop_health
      WHERE samples IS NOT NULL AND (? OR checked_at IS NULL OR checked_at < datetime('now', ?))`).all(force ? 1 : 0, `-${CHECK_HOURS} hours`);
    if (!due.length) return;
    const setRes = db.prepare("UPDATE shop_health SET ok = ?, reason = ?, checked_at = datetime('now') WHERE shop_id = ?");
    const latest = db.prepare("SELECT url FROM prices WHERE shop_id = ? AND url IS NOT NULL ORDER BY updated_at DESC LIMIT 3");
    const changed = [];
    for (const s of due) {
      let urls = latest.all(s.shop_id).map((r) => r.url);
      if (urls.length) refreshSamples.run(JSON.stringify(urls), s.shop_id);
      else urls = JSON.parse(s.samples || "[]");
      if (!urls.length) continue;
      const results = [];
      for (const u of urls.slice(0, 2)) results.push(await probe(u));
      const ups = results.filter((r) => r.verdict === "up").length;
      const downs = results.filter((r) => r.verdict === "down");
      let ok = s.ok, reason = results.map((r) => r.why).join("; ");
      if (ups) ok = 1;
      else if (downs.length === results.length) ok = 0;   // hepsi açılmadıysa gizle
      setRes.run(ok, reason, s.shop_id);
      if (ok !== s.ok) changed.push(`${s.shop_name}: ${ok ? "tekrar açılıyor, geri eklendi" : "açılmıyor, gizlendi"} (${reason})`);
    }
    for (const c of changed) console.log("  mağaza " + c);
    purgeBlocked();
  } finally { checking = false; }
}

// Gizlenen mağazaların fiyatlarını sil, "en ucuz" bilgisini kalan mağazalardan yeniden hesapla
export function purgeBlocked() {
  const b = blockedShops();
  if (!b.ids.size && !b.names.size) return;
  const all = db.prepare("SELECT DISTINCT shop_id, shop_name FROM prices").all().filter((r) => isBlocked(b, r.shop_id, r.shop_name));
  if (!all.length) return;
  const delShop = db.prepare("DELETE FROM prices WHERE shop_id = ?");
  const orphans = db.prepare(`SELECT game_id, country, low_m3, low_all FROM lows l WHERE NOT EXISTS
    (SELECT 1 FROM prices p WHERE p.game_id = l.game_id AND p.country = l.country AND p.shop_name = l.shop)`);
  const rest = db.prepare("SELECT shop_name, price, regular, currency, cut, expiry FROM prices WHERE game_id = ? AND country = ?");
  const setLow = db.prepare(`INSERT OR REPLACE INTO lows (game_id, country, shop, price, regular, currency, cut, expiry, usd, low_m3, low_all)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const delLow = db.prepare("DELETE FROM lows WHERE game_id = ? AND country = ?");
  let fixed = 0;
  tx(() => {
    for (const s of all) delShop.run(s.shop_id);
    for (const o of orphans.all()) {
      const best = rest.all(o.game_id, o.country)
        .map((p) => ({ ...p, usd: p.price * (USD_RATE[p.currency] ?? 1) }))
        .sort((a, b) => a.usd - b.usd)[0];
      if (best) setLow.run(o.game_id, o.country, best.shop_name, best.price, best.regular, best.currency, best.cut, best.expiry, best.usd, o.low_m3, o.low_all);
      else delLow.run(o.game_id, o.country);
      fixed++;
    }
  });
  console.log(`  gizlenen mağazalar: ${all.map((s) => s.shop_name).join(", ")} (${fixed} oyunun en ucuz fiyatı yeniden hesaplandı)`);
}
