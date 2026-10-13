import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { runSync, COUNTRIES, ensureHistory, ensureInfo, syncPricesFor, searchRemote, startBackgroundWork, HISTORY_MONTHS,
  ensureRating, queuePriority, spotlightMedia, findGameByTitle, ensureDetails, ensureAppids } from "./sync.js";
import { CATEGORIES } from "./steamspy.js";
import { checkAI, aiAvailable, aiModel, suggestGames } from "./ai.js";
import {
  hashPassword, verifyPassword, createSession, destroySession, cleanupSessions,
  sessionCookie, attachUser, requireUser, tooManyAttempts,
  createEmailToken, consumeEmailToken, destroyUserSessions,
} from "./auth.js";
import { sendAccountMail } from "./accountmail.js";
import { notifyAdded } from "./notify.js";
import { checkShops, purgeBlocked } from "./shops.js";
import { refreshRates, currentRates } from "./rates.js";

const app = express();
// Tünel (Cloudflare) ya da nginx gibi aynı bilgisayardaki bir aracıdan gelen isteklerde ziyaretçinin gerçek adresini kullan.
// Sadece bu bilgisayardan (loopback) gelen aracıya güvenilir; dışarıdan sahte başlık gönderilerek kandırılamaz.
app.set("trust proxy", "loopback");
const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: "10kb" }));
app.use(attachUser);
app.use(express.static(path.join(root, "..", "public")));

/* ---------- Oyunlar ve fiyatlar ---------- */
const PAGE_SIZE = 60;
const qGame = db.prepare("SELECT * FROM games WHERE id = ?");
const qPrices = db.prepare(`SELECT shop_name AS shop, price, regular, currency, cut, expiry, url
  FROM prices WHERE game_id = ? AND country = ? ORDER BY price`);
const qHistory = db.prepare(`SELECT substr(day, 1, 7) AS month, MIN(lowest) AS lowest, currency
  FROM price_history
  WHERE game_id = ? AND country = ?
    AND day >= date('now', 'start of month', ?) AND day < date('now', 'start of month')
  GROUP BY month ORDER BY month`);
const qLow = db.prepare("SELECT shop, price, regular, currency, cut, expiry, low_m3, low_all FROM lows WHERE game_id = ? AND country = ?");
const qMeta = db.prepare("SELECT value FROM meta WHERE key = 'last_sync'");
const markViewed = db.prepare("UPDATE games SET viewed_at = datetime('now') WHERE id = ?");
const validCountry = (req) => {
  const c = String(req.query.country || "US").toUpperCase();
  return COUNTRIES.includes(c) ? c : null;
};

// Liste satırı: kart için gereken bilgiler
const GAME_COLS = `g.id, g.title, g.boxart, g.appid, g.release_date, g.tags, g.popular_rank, g.free,
  g.rating_pos, g.rating_neg, g.last_priced`;
const LOW_COLS = `l.shop AS l_shop, l.price AS l_price, l.regular AS l_regular, l.currency AS l_currency,
  l.cut AS l_cut, l.expiry AS l_expiry, l.low_m3 AS l_m3, l.low_all AS l_all`;
const SHOP_COLS = `l.shop_name AS l_shop, l.price AS l_price, l.regular AS l_regular, l.currency AS l_currency,
  l.cut AS l_cut, l.expiry AS l_expiry, NULL AS l_m3, NULL AS l_all`;
const LIST_COLS = `${GAME_COLS}, ${LOW_COLS}`;
// Seçilen bölgede fiyat yoksa: başka bölgedeki en ucuz fiyat (kart ve oyun sayfasında gösterilir)
const OTHER_COL = `(SELECT o.country || '|' || o.shop || '|' || o.price || '|' || o.currency FROM lows o
  WHERE o.game_id = g.id AND o.country <> ? ORDER BY o.usd LIMIT 1) AS other`;
function listItem(r) {
  const [oc, os, op, ocur] = String(r.other ?? "").split("|");
  return {
    id: r.id,
    title: r.title,
    boxart: r.boxart,
    appid: r.appid,
    releaseDate: r.release_date,
    tags: JSON.parse(r.tags || "[]").slice(0, 2),
    popularRank: r.popular_rank,
    free: !!r.free,
    pending: !r.last_priced,
    rating: r.rating_pos != null && r.rating_pos + r.rating_neg > 0 ? { pos: r.rating_pos, neg: r.rating_neg } : null,
    low: r.l_price == null ? null
      : { shop: r.l_shop, price: r.l_price, regular: r.l_regular, currency: r.l_currency, cut: r.l_cut, expiry: r.l_expiry,
          lowM3: r.l_m3, lowAll: r.l_all },
    other: r.other ? { country: oc, shop: os, price: Number(op), currency: ocur } : null,
  };
}

// Sıralamalar
const unpricedLast = "(l.price IS NULL AND g.free = 0)";
const ratingScore = "((g.rating_pos + 1.0) / (g.rating_pos + g.rating_neg + 2))";
const ORDERS = {
  popular: `${unpricedLast}, g.popular_rank IS NULL, g.popular_rank, g.collected_rank IS NULL, g.collected_rank, g.owners IS NULL, g.owners DESC, g.title COLLATE NOCASE`,
  bestsellers: `${unpricedLast}, g.collected_rank IS NULL, g.collected_rank, g.owners IS NULL, g.owners DESC, g.popular_rank IS NULL, g.popular_rank`,
  favorites: `${unpricedLast}, g.waitlist_rank IS NULL, g.waitlist_rank, g.popular_rank IS NULL, g.popular_rank, g.owners IS NULL, g.owners DESC`,
  rating: `(COALESCE(g.rating_pos, 0) + COALESCE(g.rating_neg, 0) < 50), ${ratingScore} DESC, g.rating_pos DESC`,
  price_asc: `l.usd IS NULL, l.usd, g.title COLLATE NOCASE`,
  price_desc: `l.usd IS NULL, l.usd DESC, g.title COLLATE NOCASE`,
  discount: `${unpricedLast}, COALESCE(l.cut, 0) DESC, g.popular_rank IS NULL, g.popular_rank`,
  az: `g.title COLLATE NOCASE`,
  newest: `g.release_date IS NULL, g.release_date DESC, g.title COLLATE NOCASE`,
};

// Filtreli sorgu: arama, harf, kategori, mağaza, sadece indirimdekiler, fiyatı olmayanlar
function buildQuery(req, country) {
  const q = String(req.query.q || "").trim().slice(0, 80);
  const letter = /^[A-Z]$/.test(req.query.letter || "") ? req.query.letter : null;
  const cat = String(req.query.cat || "").slice(0, 40);
  const shop = String(req.query.shop || "").slice(0, 60);
  const where = ["g.hidden = 0"], args = [];
  let join, cols;
  if (shop) {
    join = "JOIN prices l ON l.game_id = g.id AND l.country = ? AND l.shop_name = ?";
    args.push(country, shop); cols = SHOP_COLS;
  } else {
    join = "LEFT JOIN lows l ON l.game_id = g.id AND l.country = ?";
    args.push(country); cols = LOW_COLS;
    if (req.query.all !== "1") {
      // varsayılan: bu bölgede ya da başka bir bölgede fiyatı olanlar ve ücretsiz oyunlar
      where.push("(l.price IS NOT NULL OR g.free = 1 OR EXISTS (SELECT 1 FROM lows o WHERE o.game_id = g.id))");
    }
  }
  if (req.query.deals === "1") where.push("l.cut > 0");
  if (q) { where.push("g.title LIKE ? ESCAPE '\\'"); args.push(`%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`); }
  if (letter) { where.push("upper(substr(g.title, 1, 1)) = ?"); args.push(letter); }
  if (cat) { where.push("EXISTS (SELECT 1 FROM game_tags t WHERE t.game_id = g.id AND t.tag = ?)"); args.push(cat); }
  // çevrimiçi / çevrimdışı oyun filtresi
  return { from: `FROM games g ${join} WHERE ${where.join(" AND ")}`, args, cols };
}

app.get("/api/games", (req, res) => {
  const country = validCountry(req);
  if (!country) return res.status(400).json({ code: "country" });
  const page = Math.max(0, Math.min(Number(req.query.page) || 0, 2000));
  const size = Math.max(1, Math.min(Number(req.query.limit) || PAGE_SIZE, PAGE_SIZE));
  const { from, args, cols } = buildQuery(req, country);
  const order = "ORDER BY " + (ORDERS[String(req.query.sort)] || ORDERS.popular);
  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args).n;
  const rows = db.prepare(`SELECT ${GAME_COLS}, ${cols}, ${OTHER_COL} ${from} ${order} LIMIT ${size} OFFSET ${page * size}`)
    .all(country, ...args);
  const games = rows.map(listItem);
  // fiyatı hiç çekilmemiş oyunlar ekranda göründüyse sıranın başına al
  const pend = games.filter((g) => g.pending).map((g) => g.id);
  if (pend.length) queuePriority(pend);
  res.json({ country, updatedAt: qMeta.get()?.value ?? null, total, pageSize: size, games });
});

// İndirimdeki popüler oyunlar (mağaza seçiliyse o mağazadaki indirimler)
app.get("/api/deals", (req, res) => {
  const country = validCountry(req);
  if (!country) return res.status(400).json({ code: "country" });
  const shop = String(req.query.shop || "").slice(0, 60);
  const rows = shop
    ? db.prepare(`SELECT ${GAME_COLS}, ${SHOP_COLS}, NULL AS other FROM games g JOIN prices l ON l.game_id = g.id AND l.country = ? AND l.shop_name = ?
        WHERE g.hidden = 0 AND l.cut > 0 ORDER BY g.popular_rank IS NULL, g.popular_rank, g.owners IS NULL, g.owners DESC LIMIT 12`).all(country, shop)
    : db.prepare(`SELECT ${LIST_COLS}, NULL AS other FROM games g JOIN lows l ON l.game_id = g.id AND l.country = ?
        WHERE g.hidden = 0 AND g.popular_rank IS NOT NULL AND l.cut > 0 ORDER BY g.popular_rank LIMIT 12`).all(country);
  res.json({ games: rows.map(listItem) });
});

// Bu bölgede fiyat veren mağazalar (mağaza filtresi için)
const shopsCache = new Map();
app.get("/api/shops", (req, res) => {
  const country = validCountry(req);
  if (!country) return res.status(400).json({ code: "country" });
  const c = shopsCache.get(country);
  if (c && Date.now() - c.at < 30 * 60_000) return res.json({ shops: c.data });
  const data = db.prepare(`SELECT shop_name AS name, COUNT(*) AS n FROM prices WHERE country = ?
    GROUP BY shop_name HAVING n >= 5 ORDER BY n DESC`).all(country).map((r) => ({ ...r }));
  shopsCache.set(country, { at: Date.now(), data });
  res.json({ shops: data });
});

// Kategoriler ve oyun sayıları
let catCache = { at: 0, data: null };
app.get("/api/categories", (_req, res) => {
  if (!catCache.data || Date.now() - catCache.at > 30 * 60_000) {
    const cnt = db.prepare("SELECT COUNT(*) AS n FROM game_tags t JOIN games g ON g.id = t.game_id WHERE t.tag = ? AND g.hidden = 0");
    catCache = { at: Date.now(), data: CATEGORIES.map(([tag, tr, en]) => ({ tag, tr, en, n: cnt.get(tag).n })) };
  }
  res.json({ categories: catCache.data });
});

// Vitrin: indirimdeki popüler oyunlar, Steam ekran görüntüleriyle (kayan slaytlar)
const showCache = new Map();
app.get("/api/showcase", async (req, res) => {
  const country = validCountry(req);
  if (!country) return res.status(400).json({ code: "country" });
  const shop = String(req.query.shop || "").slice(0, 60);
  const key = country + "|" + shop;
  const hit = showCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60_000) return res.json(hit.data);
  const sql = shop
    ? `SELECT ${GAME_COLS}, ${SHOP_COLS}, NULL AS other FROM games g JOIN prices l ON l.game_id = g.id AND l.country = ? AND l.shop_name = ?
       WHERE g.hidden = 0 AND l.cut > 0 ORDER BY g.popular_rank IS NULL, g.popular_rank, g.collected_rank IS NULL, g.collected_rank, g.owners IS NULL, g.owners DESC LIMIT 20`
    : `SELECT ${LIST_COLS}, NULL AS other FROM games g JOIN lows l ON l.game_id = g.id AND l.country = ?
       WHERE g.hidden = 0 AND l.cut > 0 AND (g.popular_rank IS NOT NULL OR g.collected_rank IS NOT NULL OR g.waitlist_rank IS NOT NULL)
       ORDER BY COALESCE(g.popular_rank, g.collected_rank + 1000, g.waitlist_rank + 2000) LIMIT 20`;
  const args = shop ? [country, shop] : [country];
  let rows = db.prepare(sql).all(...args);
  try { await ensureAppids(rows.filter((r) => !r.appid).map((r) => r.id)); } catch {}
  rows = db.prepare(sql).all(...args);
  // ekran görüntülerini paralel getir (bir kez çekilir, sonra 7 gün saklanır)
  const media = await Promise.allSettled(rows.slice(0, 12).map((r) => (r.appid ? ensureDetails(r.id, r.appid) : null)));
  const slides = [];
  rows.slice(0, 12).forEach((r, i) => {
    const m = media[i].status === "fulfilled" ? media[i].value : null;
    const shots = JSON.parse(m?.shots || "[]");
    if (!shots.length && !m?.poster) return;
    slides.push({ ...listItem(r), shots: shots.length ? shots : [m.poster] });
  });
  const data = { games: slides.slice(0, 10) };
  showCache.set(key, { at: data.games.length ? Date.now() : Date.now() - 50 * 60_000, data });
  res.json(data);
});

// Şu an ücretsiz: normalde ücretli olup şu an 0 fiyatla verilen oyunlar (Epic'in haftalık ücretsiz oyunları gibi)
const freeCache = new Map();
app.get("/api/free", (req, res) => {
  const country = validCountry(req);
  if (!country) return res.status(400).json({ code: "country" });
  const hit = freeCache.get(country);
  if (hit && Date.now() - hit.at < 15 * 60_000) return res.json(hit.data);
  const rows = db.prepare(`SELECT ${GAME_COLS}, ${SHOP_COLS}, NULL AS other FROM games g
    JOIN prices l ON l.game_id = g.id AND l.country = ? AND l.price = 0 AND l.regular > 0
    WHERE g.hidden = 0
    ORDER BY g.popular_rank IS NULL, g.popular_rank, g.owners IS NULL, g.owners DESC, l.regular DESC LIMIT 12`).all(country);
  const seen = new Set(), games = [];
  for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); games.push(listItem(r)); }
  const data = { games };
  freeCache.set(country, { at: Date.now(), data });
  res.json(data);
});

// Benzer oyunlar: ortak etiketi en çok olan, fiyatı belli oyunlar (çok genel etiketler sayılmaz)
const GENERIC_TAGS = ["Indie", "Singleplayer", "Multiplayer", "Casual", "Free to Play", "Early Access", "Great Soundtrack", "Atmospheric", "2D", "3D", "Colorful"];
const simCache = new Map();
app.get("/api/games/:id/similar", (req, res) => {
  const country = validCountry(req);
  if (!country) return res.status(400).json({ code: "country" });
  const key = req.params.id + country;
  const hit = simCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60_000) return res.json(hit.data);
  const rows = db.prepare(`SELECT ${LIST_COLS}, NULL AS other, COUNT(*) AS shared
    FROM game_tags t
    JOIN game_tags t2 ON t2.tag = t.tag AND t2.game_id <> t.game_id
    JOIN games g ON g.id = t2.game_id
    JOIN lows l ON l.game_id = g.id AND l.country = ?
    WHERE t.game_id = ? AND t.tag NOT IN (${GENERIC_TAGS.map(() => "?").join(",")}) AND g.hidden = 0
    GROUP BY g.id
    ORDER BY shared DESC, g.popular_rank IS NULL, g.popular_rank, g.owners IS NULL, g.owners DESC
    LIMIT 8`).all(country, req.params.id, ...GENERIC_TAGS);
  const data = { games: rows.map(listItem) };
  simCache.set(key, { at: Date.now(), data });
  res.json(data);
});

// Yapay zekâ: anlatılan oyunu bul
app.post("/api/ai/find", async (req, res) => {
  const country = COUNTRIES.includes(String(req.body?.country).toUpperCase()) ? String(req.body.country).toUpperCase() : "US";
  const text = String(req.body?.text || "").trim();
  const lang = req.body?.lang === "en" ? "en" : "tr";
  if (text.length < 8) return res.status(400).json({ code: "short" });
  if (!aiAvailable() && !(await checkAI())) return res.status(503).json({ code: "ai_off" });
  if (tooManyAttempts("ai:" + req.ip)) return res.status(429).json({ code: "rate" });
  let ideas;
  try { ideas = await suggestGames(text, lang); }
  catch (e) { console.error("  yapay zekâ:", e.message); return res.status(502).json({ code: "ai_error" }); }
  const out = [], seen = new Set();
  for (const idea of ideas) {
    const id = await findGameByTitle(idea.title, country);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const r = db.prepare(`SELECT ${LIST_COLS}, ${OTHER_COL} FROM games g LEFT JOIN lows l ON l.game_id = g.id AND l.country = ? WHERE g.id = ?`).get(country, country, id);
    if (r) out.push({ ...listItem(r), why: idea.why });
  }
  res.json({ games: out, model: aiModel() });
});

// Oyun sayfası: bilgi, tüm mağaza fiyatları ve 3 aylık geçmiş (eksikse o an çekilir)
const priceTried = new Set();
app.get("/api/games/:id", async (req, res) => {
  const country = validCountry(req);
  if (!country) return res.status(400).json({ code: "country" });
  const id = req.params.id;
  if (!qGame.get(id)) return res.status(404).json({ code: "game" });
  markViewed.run(id);
  const qDaily = db.prepare(`SELECT day, lowest, currency FROM price_history
    WHERE game_id = ? AND country = ? AND day >= date('now', ?) ORDER BY day`);
  const jobs = [ensureInfo(id), ensureHistory(id, country), ensureRating(id), ensureDetails(id)];
  if (!qPrices.all(id, country).length && !priceTried.has(id + country)) {
    priceTried.add(id + country);
    jobs.push(syncPricesFor([id], [country]));
    queuePriority([id]);
  }
  for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected") console.error("  oyun ayrıntısı:", r.reason?.message);
  const g = qGame.get(id);
  const low = qLow.get(id, country);
  res.json({ game: {
    ...listItem({ ...g, l_shop: low?.shop, l_price: low?.price, l_regular: low?.regular, l_currency: low?.currency, l_cut: low?.cut, l_expiry: low?.expiry,
      l_m3: low?.low_m3, l_all: low?.low_all }),
    elsewhere: low ? [] : db.prepare(`SELECT country, shop, price, currency, cut FROM lows WHERE game_id = ? AND country <> ?
      ORDER BY usd LIMIT 6`).all(id, country).map((r) => ({ ...r })),
    developers: JSON.parse(g.developers || "[]"),
    tags: JSON.parse(g.tags || "[]"),
    prices: qPrices.all(id, country),
    history: qDaily.all(id, country, `-${HISTORY_MONTHS} months`),
    requirements: (() => {
      const m = db.prepare("SELECT req_min, req_rec FROM media WHERE game_id = ?").get(id);
      const min = JSON.parse(m?.req_min || "[]"), rec = JSON.parse(m?.req_rec || "[]");
      return min.length || rec.length ? { min, rec } : { min: [], rec: [], none: true, steam: !!g.appid };
    })(),
  } });
});

// Site ayarları, sayaçlar ve yardım sayfası bilgileri
let statsCache = { at: 0, data: null };
app.get("/api/config", (_req, res) => {
  if (Date.now() - statsCache.at > 10 * 60_000) {
    statsCache = { at: Date.now(), data: {
      games: db.prepare("SELECT COUNT(*) AS n FROM games WHERE hidden = 0").get().n,
      priced: db.prepare("SELECT COUNT(DISTINCT game_id) AS n FROM lows").get().n,
      shops: db.prepare("SELECT COUNT(DISTINCT shop_name) AS n FROM prices").get().n,
    } };
  }
  res.json({
    siteName: process.env.SITE_NAME || "Fiyatavı",
    email: process.env.SUPPORT_EMAIL || "",
    instagram: (process.env.SUPPORT_INSTAGRAM || "").replace(/^@/, ""),
    stats: statsCache.data,
    ai: aiAvailable(),
    controller: process.env.CONTROLLER_NAME || "",
    rates: currentRates(),
  });
});

// Giriş ekranının arka planı için popüler oyun kapakları
app.get("/api/covers", (_req, res) => {
  const rows = db.prepare(`SELECT id, title, boxart, appid FROM games
    WHERE hidden = 0 AND (boxart IS NOT NULL OR appid IS NOT NULL)
    ORDER BY popular_rank IS NULL, popular_rank LIMIT 60`).all();
  res.json({ games: rows.map((r) => ({ ...r })) });
});

// Listede olmayan oyunları tüm mağazalarda ara
app.get("/api/search", async (req, res) => {
  const country = validCountry(req);
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (!country || q.length < 3) return res.json({ added: 0 });
  try { res.json({ added: await searchRemote(q, country) }); }
  catch (e) { console.error("  arama:", e.message); res.json({ added: 0 }); }
});

/* ---------- Hesap ---------- */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanCountry = (c) => (COUNTRIES.includes(String(c).toUpperCase()) ? String(c).toUpperCase() : "US");
const cleanLang = (l) => (l === "en" ? "en" : "tr");
const qAvatar = db.prepare("SELECT id, title, boxart, appid FROM games WHERE id = ?");
const publicUser = (u) => ({ email: u.email, name: u.name, country: u.country, lang: u.lang,
  notifyDrops: u.notify_drops !== 0, minCut: u.min_cut ?? 0, emailVerified: !!u.email_verified,
  avatar: u.avatar ? { ...(qAvatar.get(u.avatar) ?? {}) } : null });

app.post("/api/auth/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim().slice(0, 40) || email.split("@")[0];
  if (!email || !password) return res.status(400).json({ code: "fill" });
  if (!EMAIL.test(email)) return res.status(400).json({ code: "email" });
  if (password.length < 6) return res.status(400).json({ code: "pass" });
  if (req.body.consent !== true) return res.status(400).json({ code: "consent" });
  if (tooManyAttempts("reg:" + req.ip)) return res.status(429).json({ code: "rate" });
  try {
    const info = db.prepare("INSERT INTO users (email, name, pass_hash, country, lang, email_verified, consent_at) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))")
      .run(email, name, await hashPassword(password), cleanCountry(req.body.country), cleanLang(req.body.lang));
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    res.setHeader("Set-Cookie", sessionCookie(createSession(user.id)));
    sendAccountMail("verify", user, createEmailToken(user.id, "verify", 48));
    res.json({ user: publicUser(user) });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ code: "exists" });
    throw e;
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ code: "fill" });
  if (tooManyAttempts("login:" + req.ip + ":" + email)) return res.status(429).json({ code: "rate" });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !(await verifyPassword(password, user.pass_hash))) return res.status(401).json({ code: "wrong" });
  res.setHeader("Set-Cookie", sessionCookie(createSession(user.id)));
  res.json({ user: publicUser(user) });
});

// E-posta doğrulama bağlantısı
app.post("/api/auth/verify", (req, res) => {
  const uid = consumeEmailToken(req.body?.token, "verify");
  if (!uid) return res.status(400).json({ code: "token" });
  db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(uid);
  res.json({ ok: true });
});
// Doğrulama mailini tekrar gönder
app.post("/api/auth/resend", requireUser, (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true });
  if (tooManyAttempts("resend:" + req.user.id)) return res.status(429).json({ code: "rate" });
  sendAccountMail("verify", req.user, createEmailToken(req.user.id, "verify", 48));
  res.json({ ok: true });
});
// Şifremi unuttum: hesap olsa da olmasa da aynı cevap (kimin üye olduğu anlaşılmasın)
app.post("/api/auth/forgot", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ code: "email" });
  if (tooManyAttempts("forgot:" + req.ip)) return res.status(429).json({ code: "rate" });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (user) sendAccountMail("reset", user, createEmailToken(user.id, "reset", 1));
  res.json({ ok: true });
});
// Yeni şifre: bağlantı tek kullanımlık, tüm eski oturumlar kapanır
app.post("/api/auth/reset", async (req, res) => {
  const password = String(req.body?.password || "");
  if (password.length < 6) return res.status(400).json({ code: "pass" });
  if (tooManyAttempts("reset:" + req.ip)) return res.status(429).json({ code: "rate" });
  const uid = consumeEmailToken(req.body?.token, "reset");
  if (!uid) return res.status(400).json({ code: "token" });
  db.prepare("UPDATE users SET pass_hash = ?, email_verified = 1 WHERE id = ?").run(await hashPassword(password), uid);
  destroyUserSessions(uid);
  res.setHeader("Set-Cookie", sessionCookie(createSession(uid)));
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(uid)) });
});

app.post("/api/auth/logout", (req, res) => {
  destroySession(req.sid);
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

// Şifre değiştir: mevcut şifre doğrulanır, diğer cihazlardaki oturumlar kapanır
app.post("/api/me/password", requireUser, async (req, res) => {
  const cur = String(req.body?.current || ""), next = String(req.body?.password || "");
  if (next.length < 6) return res.status(400).json({ code: "pass" });
  if (tooManyAttempts("pw:" + req.user.id)) return res.status(429).json({ code: "rate" });
  const user = db.prepare("SELECT pass_hash FROM users WHERE id = ?").get(req.user.id);
  if (!(await verifyPassword(cur, user.pass_hash))) return res.status(401).json({ code: "wrong" });
  db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(await hashPassword(next), req.user.id);
  destroyUserSessions(req.user.id);
  res.setHeader("Set-Cookie", sessionCookie(createSession(req.user.id)));
  res.json({ ok: true });
});

// Profil resmi seçmek için oyun kapakları (arama yapılabilir)
app.get("/api/avatars", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  const rows = q
    ? db.prepare(`SELECT id, title, boxart, appid FROM games WHERE hidden = 0 AND (boxart IS NOT NULL OR appid IS NOT NULL)
        AND title LIKE ? ORDER BY popular_rank IS NULL, popular_rank, owners IS NULL, owners DESC LIMIT 30`).all(`%${q}%`)
    : db.prepare(`SELECT id, title, boxart, appid FROM games WHERE hidden = 0 AND (boxart IS NOT NULL OR appid IS NOT NULL)
        AND (popular_rank IS NOT NULL OR collected_rank IS NOT NULL) ORDER BY COALESCE(popular_rank, collected_rank + 1000) LIMIT 30`).all();
  res.json({ games: rows.map((r) => ({ ...r })) });
});

// Hesabı sil (şifre onayıyla); oturumlar, istek listesi ve bildirimler de silinir
app.delete("/api/me", requireUser, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!(await verifyPassword(String(req.body?.password || ""), user.pass_hash))) return res.status(401).json({ code: "wrong" });
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  res.json({ ok: true });
});

app.patch("/api/me", requireUser, (req, res) => {
  if (req.body.country) {
    const c = cleanCountry(req.body.country);
    if (c !== req.user.country) {
      db.prepare("UPDATE users SET country = ? WHERE id = ?").run(c, req.user.id);
      // bölge değişince para birimi değişir; fiyat tabanı bir sonraki güncellemede yeniden alınır
      db.prepare("UPDATE wishlist SET last_price = NULL WHERE user_id = ?").run(req.user.id);
    }
  }
  if (req.body.lang) db.prepare("UPDATE users SET lang = ? WHERE id = ?").run(cleanLang(req.body.lang), req.user.id);
  if (typeof req.body.notifyDrops === "boolean") db.prepare("UPDATE users SET notify_drops = ? WHERE id = ?").run(req.body.notifyDrops ? 1 : 0, req.user.id);
  if ([0, 25, 50, 75].includes(req.body.minCut)) db.prepare("UPDATE users SET min_cut = ? WHERE id = ?").run(req.body.minCut, req.user.id);
  if (typeof req.body.name === "string" && req.body.name.trim()) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(req.body.name.trim().slice(0, 40), req.user.id);
  if (req.body.avatar === null) db.prepare("UPDATE users SET avatar = NULL WHERE id = ?").run(req.user.id);
  else if (typeof req.body.avatar === "string" && qAvatar.get(req.body.avatar)) db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(req.body.avatar, req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

/* ---------- İstek listesi ve bildirimler ---------- */
app.get("/api/wishlist", requireUser, (req, res) => {
  const country = COUNTRIES.includes(String(req.query.country).toUpperCase()) ? String(req.query.country).toUpperCase() : req.user.country;
  const rows = db.prepare(`SELECT ${LIST_COLS}, w.target_price, w.target_currency FROM wishlist w JOIN games g ON g.id = w.game_id
    LEFT JOIN lows l ON l.game_id = g.id AND l.country = ? WHERE w.user_id = ? ORDER BY w.added_at`).all(country, req.user.id);
  const targets = Object.fromEntries(rows.filter((r) => r.target_price != null).map((r) => [r.id, { price: r.target_price, currency: r.target_currency }]));
  res.json({ ids: rows.map((r) => r.id), games: rows.map(listItem), targets });
});

app.post("/api/wishlist/:gameId", requireUser, async (req, res) => {
  const game = db.prepare("SELECT id, title FROM games WHERE id = ?").get(req.params.gameId);
  if (!game) return res.status(404).json({ code: "game" });
  const r = db.prepare("INSERT OR IGNORE INTO wishlist (user_id, game_id) VALUES (?, ?)").run(req.user.id, game.id);
  if (r.changes) await notifyAdded(req.user, game);
  res.json({ ok: true });
});

// Hedef fiyat alarmı: { target: 499.99, currency: "TRY" } ya da { target: null } ile kaldır
app.patch("/api/wishlist/:gameId", requireUser, (req, res) => {
  const row = db.prepare("SELECT 1 FROM wishlist WHERE user_id = ? AND game_id = ?").get(req.user.id, req.params.gameId);
  if (!row) return res.status(404).json({ code: "game" });
  const t = req.body?.target;
  if (t === null) {
    db.prepare("UPDATE wishlist SET target_price = NULL, target_currency = NULL, target_hit = 0 WHERE user_id = ? AND game_id = ?").run(req.user.id, req.params.gameId);
    return res.json({ ok: true });
  }
  const price = Number(t), cur = String(req.body?.currency || "").toUpperCase();
  if (!(price > 0 && price < 1e7) || !/^[A-Z]{3}$/.test(cur)) return res.status(400).json({ code: "target" });
  const low = db.prepare("SELECT price, currency FROM lows WHERE game_id = ? AND country = ?").get(req.params.gameId, req.user.country);
  const already = !!low && low.currency === cur && low.price <= price;   // şu an zaten hedefin altındaysa
  db.prepare("UPDATE wishlist SET target_price = ?, target_currency = ?, target_hit = ? WHERE user_id = ? AND game_id = ?")
    .run(price, cur, already ? 1 : 0, req.user.id, req.params.gameId);
  res.json({ ok: true, already });
});

app.delete("/api/wishlist/:gameId", requireUser, (req, res) => {
  db.prepare("DELETE FROM wishlist WHERE user_id = ? AND game_id = ?").run(req.user.id, req.params.gameId);
  db.prepare("DELETE FROM notifications WHERE user_id = ? AND game_id = ? AND kind = 'added'").run(req.user.id, req.params.gameId);
  res.json({ ok: true });
});

app.get("/api/notifications", requireUser, (req, res) => {
  res.json({ items: db.prepare("SELECT kind, text, sent_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20").all(req.user.id) });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ code: "server" });
});

/* ---------- Zamanlayıcı ---------- */
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try { await refreshRates(); purgeBlocked(); await runSync(); cleanupSessions(); await checkShops(); startBackgroundWork(); }
  catch (e) { console.error("Senkronizasyon hatası:", [e.message, e.cause?.code].filter(Boolean).join(" — "), e.cause?.code ? "(internet bağlantısını ya da güvenlik duvarını kontrol et)" : ""); }
  finally { running = false; }
}

const port = Number(process.env.PORT || 3000);
const httpServer = app.listen(port, () => {
  console.log(`${process.env.SITE_NAME || "Fiyatavı"} çalışıyor → http://localhost:${port}`);
  checkAI();
  setInterval(checkAI, 5 * 60_000);
  tick();
  setInterval(tick, Number(process.env.SYNC_MINUTES || 60) * 60_000);
});
httpServer.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n✗ ${port} numaralı kapı kullanımda: büyük ihtimalle sunucu başka bir terminal penceresinde zaten açık.`);
    console.error("  O pencerede Ctrl + C ile durdur ya da hepsini kapatmak için şunu yaz:  taskkill /IM node.exe /F\n");
    process.exit(1);
  }
  throw e;
});
