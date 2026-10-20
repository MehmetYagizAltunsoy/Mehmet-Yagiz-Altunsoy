import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db, tx, USD_RATE } from "./db.js";
import * as itad from "./itad.js";
import * as steam from "./steam.js";
import * as spy from "./steamspy.js";
import * as store from "./steamstore.js";
import { checkPriceDrops } from "./notify.js";
import { blockedShops, isBlocked, rememberSamples } from "./shops.js";

// Site para birimi → IsThereAnyDeal ülkesi (EUR için Almanya fiyatları)
export const COUNTRIES = ["US", "DE", "GB", "JP", "BR", "CA", "AU", "MX", "CH", "TR"];
export const HISTORY_MONTHS = 36;   // oyun sayfasındaki grafik için en fazla 3 yıllık fiyat geçmişi
const CATALOG_SIZE = Math.min(Math.max(Number(process.env.CATALOG_SIZE || 1000), 0), 1000);
const TAIL_HOURS = Number(process.env.TAIL_REFRESH_HOURS || 24);   // az bakılan oyunlar kaç saatte bir
const BACKGROUND_SHARE = 0.6;                                       // arka plan işleri limitin en fazla %60'ı

const seed = JSON.parse(fs.readFileSync(new URL("../games.json", import.meta.url), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// "fetch failed" yerine gerçek sebebi göster (ör. ENOTFOUND = alan adı bulunamadı, ECONNRESET = bağlantı kesildi)
export const errText = (e) => [e?.message, e?.cause?.code || e?.cause?.message].filter(Boolean).join(" — ");
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function waitBudget() {
  while (itad.usage() >= itad.RATE_LIMIT * BACKGROUND_SHARE) await sleep(5000);
}

const insGame = db.prepare(`INSERT INTO games (id, slug, title, type) VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING`);
const setAppid = db.prepare("UPDATE games SET appid = ? WHERE id = ? AND appid IS NULL");

/* ---------- 1) Katalog ---------- */

// games.json'daki oyunlar her zaman sitede olsun
async function ensureSeeds() {
  const has = db.prepare("SELECT 1 FROM games WHERE steam_appid = ?");
  const setApp = db.prepare("UPDATE games SET steam_appid = ?, appid = ? WHERE id = ? AND steam_appid IS NULL");
  for (const s of seed) {
    if (has.get(s.steamAppId)) continue;
    const f = await itad.lookup({ appid: s.steamAppId });
    if (!f?.found) { console.warn(`  bulunamadı: ${s.title}`); continue; }
    insGame.run(f.game.id, f.game.slug ?? null, f.game.title, f.game.type ?? null);
    setApp.run(s.steamAppId, s.steamAppId, f.game.id);
  }
}

// En popüler oyunlar
async function syncCatalog() {
  const all = [];
  for (let off = 0; off < CATALOG_SIZE; off += 100) {
    let page;
    try { page = await itad.mostPopular(off, Math.min(100, CATALOG_SIZE - off)); }
    catch (e) { console.warn("  popüler liste alınamadı:", errText(e)); break; }
    if (!page?.length) break;
    all.push(...page);
    if (page.length < 100) break;
  }
  if (!all.length) return;
  const rank = db.prepare("UPDATE games SET popular_rank = ? WHERE id = ?");
  tx(() => {
    db.exec("UPDATE games SET popular_rank = NULL");
    for (const x of all) {
      insGame.run(x.id, x.slug ?? null, x.title, null);
      rank.run(x.position, x.id);
    }
  });
  console.log(`  katalog: ${all.length} popüler oyun`);
}

// Steam'deki tüm oyunlar: günde bir listeyi yenile, sonra arka planda sitenin kataloğuna çevir
async function importSteamList() {
  const key = process.env.STEAM_API_KEY;
  if (!key) return;
  const last = db.prepare("SELECT value FROM meta WHERE key = 'steam_import'").get()?.value;
  if (last && Date.now() - Date.parse(last) < 24 * 3_600_000) return;
  const ins = db.prepare("INSERT INTO steam_apps (appid, name) VALUES (?, ?) ON CONFLICT(appid) DO UPDATE SET name = excluded.name");
  let n = 0;
  for await (const apps of steam.gamePages(key)) {
    tx(() => { for (const a of apps) if (a.appid && a.name) { ins.run(a.appid, a.name); n++; } });
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('steam_import', ?)").run(new Date().toISOString());
  const left = db.prepare("SELECT COUNT(*) AS n FROM steam_apps WHERE mapped = 0").get().n;
  console.log(`  Steam listesi: ${n} oyun (${left} tanesi siteye eklenmeyi bekliyor)`);
}

let mapping = false;
export async function mapSteamInBackground() {
  if (mapping || !process.env.STEAM_API_KEY) return;
  mapping = true;
  const next = db.prepare("SELECT appid, name FROM steam_apps WHERE mapped = 0 ORDER BY appid DESC LIMIT 200");
  const mark = db.prepare("UPDATE steam_apps SET mapped = 1 WHERE appid = ?");
  const hasApp = db.prepare("SELECT 1 FROM games WHERE appid = ?");
  let added = 0, errors = 0;
  try {
    for (;;) {
      const batch = next.all();
      if (!batch.length) break;
      await waitBudget();
      let res;
      try { res = await itad.lookupSteam(batch.map((b) => b.appid)); errors = 0; }
      catch (e) {
        if (++errors >= 3) { console.warn("  Steam eşleme durdu, sonra devam edecek:", e.message); break; }
        await sleep(60_000); continue;
      }
      tx(() => {
        for (const b of batch) {
          const id = res?.[`app/${b.appid}`];
          if (id && !hasApp.get(b.appid)) {
            if (insGame.run(id, null, b.name, "game").changes) added++;
            setAppid.run(b.appid, id);
          }
          mark.run(b.appid);
        }
      });
      if (added && added % 2000 < 200) {
        console.log(`  Steam oyunları siteye ekleniyor: ${added}`);
        tailPricesInBackground();
      }
    }
    if (added) console.log(`  Steam eşleme bitti: ${added} yeni oyun`);
  } finally { mapping = false; }
}

/* ---------- 2) Fiyatlar ---------- */

const delP = db.prepare("DELETE FROM prices WHERE game_id = ? AND country = ?");
const insP = db.prepare(`INSERT INTO prices
  (game_id, country, shop_id, shop_name, price, regular, currency, cut, expiry, url, usd, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`);
const setLow = db.prepare(`INSERT OR REPLACE INTO lows (game_id, country, shop, price, regular, currency, cut, expiry, usd, low_m3, low_all)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const toUsd = (p) => p.amount * (USD_RATE[p.currency] ?? 1);
const delLow = db.prepare("DELETE FROM lows WHERE game_id = ? AND country = ?");
const insToday = db.prepare(`INSERT INTO price_history (game_id, country, day, lowest, currency)
  VALUES (?, ?, date('now'), ?, ?)
  ON CONFLICT(game_id, country, day) DO UPDATE SET lowest = MIN(lowest, excluded.lowest)`);
const setPriced = db.prepare("UPDATE games SET last_priced = datetime('now') WHERE id = ?");

export async function syncPricesFor(ids, countries = COUNTRIES, { background = false } = {}) {
  const blocked = blockedShops();
  const samples = new Map();
  for (const part of chunks(ids, 200)) {
    for (const c of countries) {
      if (background) await waitBudget();
      const data = await itad.prices(part, c);
      tx(() => {
        for (const g of data ?? []) {
          delP.run(g.id, c);
          const byShop = new Map();
          for (const d of g.deals ?? []) {
            const k = String(d.shop.id);
            if (d.url) {
              const sm = samples.get(k) ?? { name: d.shop.name, urls: [] };
              if (sm.urls.length < 3) sm.urls.push(d.url);
              samples.set(k, sm);
            }
            if (isBlocked(blocked, k, d.shop.name)) continue;   // bu bilgisayardan açılmayan mağaza
            const prev = byShop.get(k);
            if (!prev || d.price.amount < prev.price.amount) byShop.set(k, d);
          }
          let low = null;
          for (const [shopId, d] of byShop) {
            insP.run(g.id, c, shopId, d.shop.name, d.price.amount, d.regular.amount,
              d.price.currency, d.cut ?? 0, d.expiry ?? null, d.url ?? null, toUsd(d.price));
            if (!low || toUsd(d.price) < toUsd(low.price)) low = d;
          }
          if (low) {
            const sameCur = (h) => (h && h.currency === low.price.currency ? h.amount : null);
            setLow.run(g.id, c, low.shop.name, low.price.amount, low.regular.amount, low.price.currency, low.cut ?? 0,
              low.expiry ?? null, toUsd(low.price), sameCur(g.historyLow?.m3), sameCur(g.historyLow?.all));
            insToday.run(g.id, c, low.price.amount, low.price.currency);
          } else delLow.run(g.id, c);
        }
      });
    }
    if (countries.length === COUNTRIES.length) tx(() => { for (const id of part) setPriced.run(id); });
  }
  if (samples.size) rememberSamples(samples);
}

// Sık güncellenenler: popüler, istek listesinde olan, son 7 günde bakılan, games.json'dakiler
const qHot = db.prepare(`SELECT id FROM games WHERE hidden = 0 AND (
    popular_rank IS NOT NULL OR steam_appid IS NOT NULL OR waitlist_rank IS NOT NULL OR collected_rank IS NOT NULL
    OR viewed_at >= datetime('now', '-7 days')
    OR id IN (SELECT game_id FROM wishlist))`);
async function syncHotPrices() {
  const ids = qHot.all().map((r) => r.id);
  await syncPricesFor(ids);
  console.log(`  fiyatlar güncellendi: ${ids.length} sık bakılan oyun, ${COUNTRIES.length} bölge`);
}

// Diğer tüm oyunlar: arka planda, her biri TAIL_HOURS saatte bir
let tailRunning = false;
export async function tailPricesInBackground() {
  if (tailRunning) return;
  tailRunning = true;
  const next = db.prepare(`SELECT id FROM games WHERE hidden = 0
    AND (last_priced IS NULL OR last_priced < datetime('now', ?))
    ORDER BY last_priced IS NOT NULL, last_priced LIMIT 200`);
  const left = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE hidden = 0
    AND (last_priced IS NULL OR last_priced < datetime('now', ?))`);
  let done = 0, errors = 0;
  try {
    for (;;) {
      const ids = next.all(`-${TAIL_HOURS} hours`).map((r) => r.id);
      if (!ids.length) break;
      try { await syncPricesFor(ids, COUNTRIES, { background: true }); errors = 0; }
      catch (e) {
        if (++errors >= 3) { console.warn("  arka plan fiyat güncellemesi durdu, sonra devam edecek:", e.message); break; }
        await sleep(60_000); continue;
      }
      done += ids.length;
      if (done % 2000 < 200) console.log(`  arka plan fiyatları: ${done} oyun güncellendi, ${left.get(`-${TAIL_HOURS} hours`).n} kaldı`);
    }
  } finally { tailRunning = false; }
}

/* ---------- 3) Oyun bilgisi ve kapak ---------- */

const qInfoDone = db.prepare("SELECT info_done FROM games WHERE id = ?");
const setInfo = db.prepare(`UPDATE games SET title = ?, release_date = ?, developers = ?, tags = ?,
  boxart = COALESCE(?, boxart), type = ?, hidden = ?, free = ?, info_done = 1 WHERE id = ?`);
const infoInflight = new Map();
const insTag = db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag) VALUES (?, ?)");

export function ensureInfo(id) {
  const row = qInfoDone.get(id);
  if (!row || row.info_done) return Promise.resolve();
  if (!infoInflight.has(id)) {
    infoInflight.set(id, itad.info(id)
      .then((i) => {
        const hide = (i.type && i.type !== "game") || i.mature ? 1 : 0;
        const tags = i.tags ?? [];
        tx(() => {
          setInfo.run(i.title, i.releaseDate ?? null, JSON.stringify((i.developers ?? []).map((d) => d.name)),
            JSON.stringify(tags), i.assets?.boxart ?? i.assets?.banner600 ?? null, i.type ?? null, hide,
            tags.includes("Free to Play") ? 1 : 0, id);
          for (const t of tags) insTag.run(id, t);
        });
      })
      .finally(() => infoInflight.delete(id)));
  }
  return infoInflight.get(id);
}

// Bilgiler arka planda sadece sık bakılan oyunlar için çekilir; diğerleri sayfaları açılınca
let enriching = false;
export async function enrichInBackground() {
  if (enriching) return;
  enriching = true;
  const next = db.prepare(`SELECT id FROM games WHERE info_done = 0 AND (
      popular_rank IS NOT NULL OR steam_appid IS NOT NULL OR viewed_at IS NOT NULL
      OR id IN (SELECT game_id FROM wishlist) OR appid IS NULL)
    ORDER BY popular_rank IS NULL, popular_rank LIMIT 1`);
  let errors = 0, done = 0;
  try {
    for (;;) {
      const g = next.get();
      if (!g) break;
      await waitBudget();
      try { await ensureInfo(g.id); errors = 0; done++; }
      catch (e) {
        if (++errors >= 3) { console.warn("  kapak/bilgi çekme durdu, sonra devam edecek:", e.message); break; }
        await sleep(60_000);
      }
    }
    if (done) console.log(`  kapak ve bilgiler güncel (${done} oyun)`);
  } finally { enriching = false; }
}

/* ---------- 4) Fiyat geçmişi (oyun sayfası ilk açıldığında) ---------- */

const inflight = new Map();
const qFetched = db.prepare("SELECT 1 FROM history_fetched WHERE game_id = ? AND country = ?");
const markFetched = db.prepare("INSERT OR IGNORE INTO history_fetched (game_id, country) VALUES (?, ?)");
// Geçmiş eskiden 3 ay çekiliyordu; 3 yıla çıkınca oyunlar açıldıkça geçmişleri bir kez yeniden çekilsin
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'history_v2'").get()) {
  db.exec("DELETE FROM history_fetched; INSERT OR REPLACE INTO meta (key, value) VALUES ('history_v2', '1')");
}
const insHist = db.prepare(`INSERT INTO price_history (game_id, country, day, lowest, currency)
  VALUES (?,?,?,?,?)
  ON CONFLICT(game_id, country, day) DO UPDATE SET lowest = MIN(lowest, excluded.lowest)`);

export function ensureHistory(gameId, country) {
  if (qFetched.get(gameId, country)) return Promise.resolve();
  const key = gameId + ":" + country;
  if (!inflight.has(key)) {
    const since = new Date(Date.now() - (HISTORY_MONTHS * 31 + 5) * 864e5).toISOString().slice(0, 19) + "+00:00";
    inflight.set(key, itad.history(gameId, country, since)
      .then((events) => {
        tx(() => {
          for (const e of events ?? []) {
            if (!e.deal?.price) continue;
            insHist.run(gameId, country, e.timestamp.slice(0, 10), e.deal.price.amount, e.deal.price.currency);
          }
          markFetched.run(gameId, country);
        });
      })
      .finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

/* ---------- 5) Arama: listede olmayan oyunları ekle ---------- */

const searchCache = new Map();
export async function searchRemote(q, country) {
  const key = q.toLocaleLowerCase("tr");
  const last = searchCache.get(key);
  if (last && Date.now() - last < 3_600_000) return 0;
  searchCache.set(key, Date.now());
  const results = await itad.search(q, 20);
  const fresh = [];
  const setArt = db.prepare("UPDATE games SET boxart = ? WHERE id = ? AND boxart IS NULL");
  tx(() => {
    for (const g of results ?? []) {
      if ((g.type && g.type !== "game") || g.mature) continue;
      if (insGame.run(g.id, g.slug ?? null, g.title, g.type ?? null).changes) {
        fresh.push(g.id);
        if (g.assets?.boxart) setArt.run(g.assets.boxart, g.id);
      }
    }
  });
  if (fresh.length) {
    await syncPricesFor(fresh, [country]);
    enrichInBackground();
  }
  return fresh.length;
}

/* ---------- 6) Çok satanlar, en çok favorilenenler, kategoriler, puanlar ---------- */

const metaGet = (k) => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value;
const metaSet = (k, v) => db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(k, v);
const olderThan = (k, hours) => { const v = metaGet(k); return !v || Date.now() - Date.parse(v) > hours * 3_600_000; };

// IsThereAnyDeal: en çok istek listesine eklenenler (favori) ve en çok sahip olunanlar (çok satan) — günde bir
async function syncRankings() {
  if (!olderThan("rankings_at", 24)) return;
  let ok = 0;
  for (const [fn, col] of [["mostWaitlisted", "waitlist_rank"], ["mostCollected", "collected_rank"]]) {
    const all = [];
    for (let off = 0; off < 500; off += 100) {
      let page;
      try { page = await itad[fn](off, 100); } catch (e) { console.warn(`  ${col} alınamadı:`, errText(e)); break; }
      if (!page?.length) break;
      all.push(...page);
      if (page.length < 100) break;
    }
    if (!all.length) continue;
    ok++;
    const up = db.prepare(`UPDATE games SET ${col} = ? WHERE id = ?`);
    tx(() => {
      db.exec(`UPDATE games SET ${col} = NULL`);
      for (const x of all) { insGame.run(x.id, x.slug ?? null, x.title, null); up.run(x.position, x.id); }
    });
  }
  if (!ok) return;   // hiçbiri gelmediyse bir sonraki senkronizasyonda tekrar dene
  metaSet("rankings_at", new Date().toISOString());
  console.log("  sıralamalar güncellendi (en çok favorilenen, çok satan)");
}

// SteamSpy: kategoriler + değerlendirme sayıları + tahmini satışlar — günde bir, arka planda
let categorizing = false;
export async function syncCategories() {
  if (categorizing || !olderThan("categories_at", 24)) return;
  categorizing = true;
  const byApp = db.prepare("SELECT id FROM games WHERE appid = ?");
  const setStats = db.prepare(`UPDATE games SET owners = ?,
      rating_pos = CASE WHEN rating_at IS NULL THEN ? ELSE rating_pos END,
      rating_neg = CASE WHEN rating_at IS NULL THEN ? ELSE rating_neg END WHERE id = ?`);
  let tagged = 0, failed = 0;
  try {
    for (const tag of spy.FETCH_TAGS) {
      let apps;
      try { apps = await spy.fetchTag(tag); } catch (e) { failed++; console.warn(`  kategori "${tag}" alınamadı:`, errText(e)); continue; }
      tx(() => {
        for (const a of apps) {
          const g = byApp.get(a.appid);
          if (!g) continue;
          insTag.run(g.id, tag);
          setStats.run(spy.parseOwners(a.owners), a.positive ?? null, a.negative ?? null, g.id);
          tagged++;
        }
      });
    }
    if (failed < spy.FETCH_TAGS.length && tagged > 0) metaSet("categories_at", new Date().toISOString());
    console.log(`  kategoriler güncellendi (${tagged} eşleşme)`);
  } finally { categorizing = false; }
}

// Steam değerlendirmeleri: oyun sayfası açılınca (7 günde bir tazelenir)
const ratingInflight = new Map();
const setRating = db.prepare("UPDATE games SET rating_pos = ?, rating_neg = ?, rating_at = datetime('now') WHERE id = ?");
export async function ensureRating(id) {
  try { await ensureAppids([id]); } catch {}
  const g = db.prepare("SELECT appid, rating_at FROM games WHERE id = ?").get(id);
  if (!g?.appid || (g.rating_at && Date.now() - Date.parse(g.rating_at + "Z") < 7 * 864e5)) return Promise.resolve();
  if (!ratingInflight.has(id)) {
    ratingInflight.set(id, store.reviews(g.appid)
      .then((r) => { if (r) setRating.run(r.pos, r.neg, id); })
      .finally(() => ratingInflight.delete(id)));
  }
  return ratingInflight.get(id);
}
// Sık bakılan oyunların puanları arka planda (saniyede birden az istek)
let rating = false;
export async function ratingsInBackground() {
  if (rating) return;
  rating = true;
  try {
    const rows = db.prepare(`SELECT id FROM games WHERE hidden = 0 AND appid IS NOT NULL
      AND (rating_at IS NULL OR rating_at < datetime('now', '-7 days'))
      AND (popular_rank IS NOT NULL OR waitlist_rank IS NOT NULL OR collected_rank IS NOT NULL OR viewed_at >= datetime('now', '-7 days'))
      LIMIT 1500`).all();
    for (const r of rows) {
      try { await ensureRating(r.id); } catch {}
      await sleep(1500);
    }
    if (rows.length) console.log(`  puanlar güncellendi (${rows.length} oyun)`);
  } finally { rating = false; }
}

/* ---------- Steam numarası: puan, kapak, fragman ve kategoriler için gerekli ---------- */
const setApp2 = db.prepare("UPDATE games SET appid = COALESCE(appid, ?), appid_checked = 1 WHERE id = ?");
export async function ensureAppids(ids) {
  const need = ids.filter((id) => {
    const g = db.prepare("SELECT appid, appid_checked FROM games WHERE id = ?").get(id);
    return g && !g.appid && !g.appid_checked;
  });
  for (const part of chunks(need, 200)) {
    const res = await itad.steamIdsOf(part);
    tx(() => {
      for (const id of part) {
        const app = (res?.[id] ?? []).find((x) => /^app\/\d+$/.test(x));
        setApp2.run(app ? Number(app.slice(4)) : null, id);
      }
    });
  }
}
async function fillHotAppids() {
  const ids = db.prepare(`SELECT id FROM games WHERE hidden = 0 AND appid IS NULL AND appid_checked = 0 AND (
      popular_rank IS NOT NULL OR waitlist_rank IS NOT NULL OR collected_rank IS NOT NULL
      OR viewed_at IS NOT NULL OR id IN (SELECT game_id FROM wishlist))`).all().map((r) => r.id);
  if (!ids.length) return;
  try { await ensureAppids(ids); console.log(`  Steam numaraları eşlendi (${ids.length} oyun)`); }
  catch (e) { console.warn("  Steam numaraları alınamadı:", e.message); }
}

/* ---------- 7) Öncelikli fiyat: listede fiyatı hiç çekilmemiş oyun görünürse hemen sıraya al ---------- */
const priorityQueue = new Set();
let prioritizing = false;
export function queuePriority(ids) {
  for (const id of ids) priorityQueue.add(id);
  if (!prioritizing) processPriority();
}
async function processPriority() {
  prioritizing = true;
  try {
    while (priorityQueue.size) {
      const batch = [...priorityQueue].slice(0, 200);
      batch.forEach((id) => priorityQueue.delete(id));
      try { await syncPricesFor(batch, COUNTRIES, { background: true }); } catch (e) { console.warn("  öncelikli fiyat:", e.message); await sleep(30_000); }
    }
  } finally { prioritizing = false; }
}

/* ---------- 8) Ana sayfa tanıtım bandı: öne çıkan oyunun fragmanı ---------- */
const qMedia = db.prepare("SELECT video, poster, shots, req_min, req_rec, details_v, checked_at FROM media WHERE game_id = ?");
const setMedia = db.prepare(`INSERT OR REPLACE INTO media (game_id, video, poster, shots, req_min, req_rec, details_v, checked_at)
  VALUES (?, ?, ?, ?, ?, ?, 3, datetime('now'))`);
const mediaInflight = new Map();
// Steam ayrıntıları (fragman + sistem gereksinimleri), 7 günde bir tazelenir
export async function ensureDetails(id, appid) {
  if (!appid) {
    try { await ensureAppids([id]); } catch {}
    appid = db.prepare("SELECT appid FROM games WHERE id = ?").get(id)?.appid;
    if (!appid) return null;
  }
  const m = qMedia.get(id);
  const hasReq = m && (m.req_min?.length > 2 || m.req_rec?.length > 2);
  const maxAge = hasReq ? 7 * 864e5 : 864e5;   // gereksinim bulunamadıysa ertesi gün tekrar dene
  if (m && m.details_v >= 3 && Date.now() - Date.parse(m.checked_at + "Z") < maxAge) return m;
  if (!mediaInflight.has(id)) {
    mediaInflight.set(id, store.details(appid)
      .then((d) => {
        setMedia.run(id, d.video, d.poster, JSON.stringify(d.shots ?? []), JSON.stringify(d.reqMin), JSON.stringify(d.reqRec));
      })
      .catch((e) => { console.warn(`  Steam ayrıntıları alınamadı (${appid}):`, errText(e)); throw e; })
      .finally(() => mediaInflight.delete(id)));
  }
  await mediaInflight.get(id);
  return qMedia.get(id);
}
export async function spotlightMedia(candidates) {
  let withPoster = null;
  for (const c of candidates) {
    let m;
    try { m = await ensureDetails(c.id, c.appid); } catch { continue; }
    if (m?.video) return { id: c.id, video: m.video, poster: m.poster };
    if (!withPoster && m?.poster) withPoster = { id: c.id, video: null, poster: m.poster };
  }
  return withPoster;   // hiçbirinin fragmanı yoksa en azından görseliyle göster
}

/* ---------- Ana döngü ---------- */

export async function runSync() {
  if (!process.env.ITAD_API_KEY) throw new Error('API anahtarı ayarlanmamış. Sunucuyu durdurup önce "npm run kurulum" yaz.');
  const t0 = Date.now();
  console.log("Senkronizasyon başladı…");
  // yeni etiketler eklendiğinde kategorileri bir kez yeniden çek
  if (!metaGet("cats_v3")) { db.prepare("DELETE FROM meta WHERE key = 'categories_at'").run(); metaSet("cats_v3", "1"); }
  await ensureSeeds();
  await syncCatalog();
  await syncRankings();
  await fillHotAppids();
  await syncHotPrices();
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)").run(new Date().toISOString());
  await checkPriceDrops();
  console.log(`Fiyatlar hazır (${((Date.now() - t0) / 1000).toFixed(0)} sn)`);
}

// Sunucu her senkronizasyondan sonra bunu çağırır; işler kendi aralarında limiti paylaşır
export function startBackgroundWork() {
  enrichInBackground();
  syncCategories().catch((e) => console.warn("  kategoriler:", e.message)).finally(() => ratingsInBackground());
  tailPricesInBackground();
  importSteamList()
    .catch((e) => console.warn("  Steam listesi:", e.message))
    .then(() => mapSteamInBackground())
    .catch((e) => console.warn("  Steam eşleme:", e.message))
    .finally(() => tailPricesInBackground());   // yeni eklenen oyunların fiyatları
}

// "npm run sync" ile tek başına çalıştırılabilir
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSync().catch((e) => { console.error(e.message); process.exit(1); });
}
