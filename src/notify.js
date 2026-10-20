import { db } from "./db.js";
import { sendMail } from "./mailer.js";
import { layout, gameImage, gameRows } from "./mailtemplate.js";

const SITE = (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const NAME = process.env.SITE_NAME || "Fiyatavı";
const qLow = db.prepare("SELECT shop, price, regular, currency, cut FROM lows WHERE game_id = ? AND country = ?");
const qGameInfo = db.prepare("SELECT id, slug, title, appid, boxart FROM games WHERE id = ?");
const setLast = db.prepare("UPDATE wishlist SET last_price = ? WHERE user_id = ? AND game_id = ?");
const setHit = db.prepare("UPDATE wishlist SET target_hit = ? WHERE user_id = ? AND game_id = ?");
const log = db.prepare("INSERT INTO notifications (user_id, game_id, kind, text) VALUES (?, ?, ?, ?)");

const money = (v, c, lang) => {
  try { return new Intl.NumberFormat(lang === "en" ? "en-US" : "tr-TR", { style: "currency", currency: c }).format(v); }
  catch { return `${v} ${c}`; }
};
const gameUrl = (g) => `${SITE}/oyun/${encodeURIComponent(g.slug || g.id)}`;

// Her bildirim türünün yazıları. d = { g: oyun adı, p: şimdiki fiyat, old: önceki fiyat, s: mağaza, t: hedef fiyat }
const T = {
  tr: {
    added: {
      subject: (d) => `${d.g} istek listene eklendi`,
      kicker: "İstek listesi", title: (d) => `${d.g} istek listende`,
      body: (d) => d.p ? [`Bu oyunu takip etmeye başladık. Fiyatı düştüğünde sana hemen haber vereceğiz.`]
                       : [`Bu oyunu takip etmeye başladık. Bölgende fiyatı çıktığında ve fiyat düştüğünde sana haber vereceğiz.`],
      priceLabel: "Şu an en ucuz",
    },
    drop: {
      subject: (d) => `${d.g} ucuzladı: ${d.p}`,
      kicker: "Fiyat düştü", title: (d) => `${d.g} ucuzladı`,
      body: () => [`İstek listendeki oyunun fiyatı düştü.`],
      priceLabel: "Yeni fiyat", extra: (d) => `Önceki fiyat: ${d.old}`,
    },
    target: {
      subject: (d) => `${d.g} hedef fiyatına indi: ${d.p}`,
      kicker: "Hedef fiyat", title: (d) => `${d.g} hedef fiyatına indi`,
      body: () => [`Belirlediğin hedef fiyata ulaşıldı. Bu fiyat ne kadar sürer bilinmez, kaçırma.`],
      priceLabel: "Şu an", extra: (d) => `Hedefin: ${d.t}`,
    },
    cta: "Fiyatları gör", ctaHint: "Düğme çalışmazsa:",
    footer: ["Bu maili Fiyatavı'da istek listene eklediğin bir oyun için aldın.",
      "Fiyat bildirimlerini profilindeki Bildirimler sekmesinden kapatabilirsin."],
  },
  en: {
    added: {
      subject: (d) => `${d.g} added to your wishlist`,
      kicker: "Wishlist", title: (d) => `${d.g} is on your wishlist`,
      body: (d) => d.p ? [`We're now tracking this game and will email you as soon as the price drops.`]
                       : [`We're now tracking this game and will email you once it's priced in your region and when it drops.`],
      priceLabel: "Cheapest right now",
    },
    drop: {
      subject: (d) => `${d.g} price drop: ${d.p}`,
      kicker: "Price drop", title: (d) => `${d.g} got cheaper`,
      body: () => [`A game on your wishlist just dropped in price.`],
      priceLabel: "New price", extra: (d) => `Before: ${d.old}`,
    },
    target: {
      subject: (d) => `${d.g} hit your target price: ${d.p}`,
      kicker: "Target price", title: (d) => `${d.g} hit your target price`,
      body: () => [`The price reached the target you set. Deals like this don't always last.`],
      priceLabel: "Now", extra: (d) => `Your target: ${d.t}`,
    },
    cta: "See prices", ctaHint: "If the button doesn't work:",
    footer: ["You got this email because this game is on your Fiyatavı wishlist.",
      "You can turn price alerts off in the Notifications tab of your profile."],
  },
};

// Bir bildirim mailinin konu, düz metin ve HTML hallerini üretir
export function buildMail(kind, lang, game, lo, d) {
  const L = T[lang], K = L[kind], url = gameUrl(game);
  const subject = K.subject(d);
  const extra = K.extra ? K.extra(d) : null;
  const priceLine = lo ? `${K.priceLabel}: ${d.p} (${d.s})` : null;
  const text = [K.title(d), "", ...K.body(d), priceLine, extra, "", `${L.cta}: ${url}`, "", NAME].filter((x) => x != null).join("\n");
  const html = layout({
    lang, site: NAME, siteUrl: SITE, preheader: priceLine || K.body(d)[0],
    image: gameImage(game), imageAlt: game.title,
    kicker: K.kicker, title: K.title(d), paragraphs: K.body(d),
    price: lo ? { label: K.priceLabel, now: d.p, old: lo.cut > 0 && lo.regular > lo.price ? money(lo.regular, lo.currency, lang) : null,
                  cut: lo.cut > 0 ? lo.cut : null, shop: lo.shop, extra } : null,
    cta: { href: url, label: L.cta }, ctaHint: L.ctaHint, footer: L.footer,
  });
  return { subject, text, html };
}

async function deliver(user, gameId, kind, mail) {
  if (!user.verified) return;   // doğrulanmamış adreslere mail gönderilmez
  log.run(user.id, gameId, kind, mail.subject);
  try { await sendMail({ to: user.email, ...mail }); }
  catch (e) { console.error("Mail gönderilemedi:", e.message); }
}

// İstek listesine eklenince
export async function notifyAdded(user, game) {
  const lang = user.lang === "en" ? "en" : "tr";
  const g = qGameInfo.get(game.id) ?? game;
  const lo = qLow.get(game.id, user.country);
  setLast.run(lo?.price ?? null, user.id, game.id);
  const d = { g: g.title, p: lo ? money(lo.price, lo.currency, lang) : null, s: lo?.shop };
  await deliver({ ...user, verified: !!user.email_verified }, game.id, "added", buildMail("added", lang, g, lo, d));
}

// Her fiyat güncellemesinden sonra: istek listesindeki oyunlar ucuzladı mı?
export async function checkPriceDrops() {
  const rows = db.prepare(`SELECT w.user_id, w.game_id, w.last_price, w.target_price, w.target_currency, w.target_hit,
      u.email, u.email_verified, u.country, u.lang, u.notify_drops, u.min_cut, g.title, g.slug, g.appid, g.boxart
    FROM wishlist w JOIN users u ON u.id = w.user_id JOIN games g ON g.id = w.game_id`).all();
  let sent = 0;
  for (const r of rows) {
    const lo = qLow.get(r.game_id, r.country);
    if (!lo) continue;
    const lang = r.lang === "en" ? "en" : "tr";
    const who = { id: r.user_id, email: r.email, verified: !!r.email_verified };
    const game = { id: r.game_id, slug: r.slug, title: r.title, appid: r.appid, boxart: r.boxart };
    // hedef fiyat alarmı: hedef konmuşsa genel düşüş maili yerine sadece hedefe inince haber ver
    if (r.target_price != null) {
      if (lo.currency === r.target_currency) {
        if (lo.price <= r.target_price + 1e-9 && !r.target_hit) {
          const d = { g: r.title, p: money(lo.price, lo.currency, lang), s: lo.shop, t: money(r.target_price, lo.currency, lang) };
          await deliver(who, r.game_id, "target", buildMail("target", lang, game, lo, d));
          setHit.run(1, r.user_id, r.game_id); sent++;
        } else if (lo.price > r.target_price && r.target_hit) setHit.run(0, r.user_id, r.game_id);
      }
      if (lo.price !== r.last_price) setLast.run(lo.price, r.user_id, r.game_id);
      continue;
    }
    if (lo.price === r.last_price) continue;
    if (r.last_price != null && lo.price < r.last_price - 0.005 && r.notify_drops && (lo.cut ?? 0) >= (r.min_cut ?? 0)) {
      const d = { g: r.title, p: money(lo.price, lo.currency, lang), s: lo.shop, old: money(r.last_price, lo.currency, lang) };
      await deliver(who, r.game_id, "drop", buildMail("drop", lang, game, lo, d));
      sent++;
    }
    setLast.run(lo.price, r.user_id, r.game_id); // fiyat yükseldiyse de yeni taban olarak kaydet
  }
  if (sent) console.log(`  ${sent} fiyat düşüşü bildirimi gönderildi`);
}

/* ---------- Haftalık özet ---------- */
const D = {
  tr: {
    subject: (n, m) => m ? `Haftalık özet: istek listende ${m} oyun indirimde` : `Haftalık özet: istek listendeki ${n} oyun`,
    kicker: "Haftalık özet", title: "İstek listende bu hafta",
    lead: (n, m) => m ? `Takip ettiğin ${n} oyunun ${m} tanesi şu an indirimde.` : `Takip ettiğin ${n} oyunun şu anki fiyatları aşağıda.`,
    down: (p) => `↓ Geçen haftaya göre ${p} ucuz`, up: (p) => `↑ Geçen haftaya göre ${p} pahalı`, same: "Geçen haftayla aynı",
    noPrice: "Bölgende fiyat yok", atl: "En düşük fiyat", cta: "İstek listemi aç",
    footer: ["Bu özet haftada bir gönderilir.", "Profilindeki Bildirimler sekmesinden kapatabilirsin."],
  },
  en: {
    subject: (n, m) => m ? `Weekly digest: ${m} games on your wishlist are on sale` : `Weekly digest: ${n} games on your wishlist`,
    kicker: "Weekly digest", title: "Your wishlist this week",
    lead: (n, m) => m ? `${m} of the ${n} games you track are on sale right now.` : `Here are the current prices of the ${n} games you track.`,
    down: (p) => `↓ ${p} cheaper than last week`, up: (p) => `↑ ${p} more than last week`, same: "Same as last week",
    noPrice: "No price in your region", atl: "All-time low", cta: "Open my wishlist",
    footer: ["This digest is sent once a week.", "You can turn it off in the Notifications tab of your profile."],
  },
};
const qDigestUsers = db.prepare(`SELECT id, email, name, country, lang, last_digest_at FROM users
  WHERE email_verified = 1 AND weekly_digest = 1 AND EXISTS (SELECT 1 FROM wishlist w WHERE w.user_id = users.id)`);
const qDigestGames = db.prepare(`SELECT g.id, g.slug, g.title, g.appid, g.boxart,
    l.price, l.regular, l.currency, l.cut, l.low_all, l.shop
  FROM wishlist w JOIN games g ON g.id = w.game_id LEFT JOIN lows l ON l.game_id = g.id AND l.country = ?
  WHERE w.user_id = ? ORDER BY COALESCE(l.cut, 0) DESC, g.title LIMIT 20`);
const qWeekAgo = db.prepare(`SELECT lowest, currency FROM price_history
  WHERE game_id = ? AND country = ? AND day <= date('now', '-7 days') ORDER BY day DESC LIMIT 1`);
const setDigest = db.prepare("UPDATE users SET last_digest_at = datetime('now') WHERE id = ?");
const WEEK = 7 * 864e5;

// Bir kullanıcının özet mailini hazırlar (gönderimden ayrı, böylece test edilebilir)
export function buildDigest(user) {
  const lang = user.lang === "en" ? "en" : "tr", L = D[lang];
  const games = qDigestGames.all(user.country, user.id);
  const onSale = games.filter((g) => g.cut > 0).length;
  const items = games.map((g) => {
    const it = { title: g.title, url: gameUrl(g), image: gameImage(g), noPrice: L.noPrice };
    if (g.price == null) return it;
    it.price = money(g.price, g.currency, lang);
    it.cut = g.cut > 0 ? g.cut : null;
    it.atl = g.low_all != null && g.price <= g.low_all + 0.005 ? L.atl : null;
    const old = qWeekAgo.get(g.id, user.country);
    if (old && old.currency === g.currency) {
      const diff = g.price - old.lowest;
      if (diff < -0.005) { it.change = L.down(money(-diff, g.currency, lang)); it.changeColor = "down"; }
      else if (diff > 0.005) { it.change = L.up(money(diff, g.currency, lang)); it.changeColor = "up"; }
      else it.change = L.same;
    }
    return it;
  });
  const subject = L.subject(games.length, onSale);
  const text = [L.title, "", L.lead(games.length, onSale), "",
    ...items.map((it) => `- ${it.title}: ${it.price ?? it.noPrice}${it.cut ? ` (-%${it.cut})` : ""}${it.change ? ` · ${it.change}` : ""}`),
    "", `${L.cta}: ${SITE}`, "", NAME].join("\n");
  const html = layout({
    lang, site: NAME, siteUrl: SITE, preheader: L.lead(games.length, onSale),
    kicker: L.kicker, title: L.title, paragraphs: [L.lead(games.length, onSale)],
    blocks: gameRows(items), cta: { href: SITE, label: L.cta }, ctaHint: T[lang].ctaHint, footer: L.footer,
  });
  return { subject, text, html, count: games.length };
}

/**
 * Haftalık özetleri gönderir. Sunucu saatte bir çağırır; her kullanıcıya en fazla 7 günde bir gider.
 * İlk kez sırası gelen kullanıcıya hemen gönderilmez, sayaç başlatılır (sunucu ilk açıldığında herkese birden mail gitmesin).
 * force: süreye bakmadan gönder (yönetim sayfasındaki deneme düğmesi), onlyUserId: sadece bu kullanıcıya
 */
export async function sendWeeklyDigests({ force = false, onlyUserId = null } = {}) {
  let sent = 0;
  for (const u of qDigestUsers.all()) {
    if (onlyUserId != null && u.id !== onlyUserId) continue;
    if (!force) {
      if (!u.last_digest_at) { setDigest.run(u.id); continue; }
      if (Date.now() - Date.parse(u.last_digest_at.replace(" ", "T") + "Z") < WEEK) continue;
    }
    const mail = buildDigest(u);
    if (!mail.count) continue;
    log.run(u.id, null, "digest", mail.subject);
    setDigest.run(u.id);
    try { await sendMail({ to: u.email, subject: mail.subject, text: mail.text, html: mail.html }); sent++; }
    catch (e) { console.error("Haftalık özet gönderilemedi:", e.message); }
  }
  if (sent) console.log(`  ${sent} haftalık özet maili gönderildi`);
  return sent;
}
