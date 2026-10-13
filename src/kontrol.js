// Tanı: hangi bölgede kaç oyunun fiyatı var, fiyatı olmayanlar hangileri
import "dotenv/config";
import { db } from "./db.js";

const COUNTRIES = ["US", "DE", "GB", "JP", "BR", "CA", "AU", "MX", "CH", "TR"];
const total = db.prepare("SELECT COUNT(*) AS n FROM games WHERE hidden = 0").get().n;
const priced = db.prepare(`SELECT COUNT(DISTINCT p.game_id) AS n FROM prices p
  JOIN games g ON g.id = p.game_id WHERE g.hidden = 0 AND p.country = ?`);
const pending = db.prepare("SELECT COUNT(*) AS n FROM games WHERE info_done = 0").get().n;

console.log(`\nSitedeki oyun: ${total}   (kapak/bilgisi henüz gelmeyen: ${pending})\n`);
console.log("Bölge  Fiyatı olan");
for (const c of COUNTRIES) {
  const n = priced.get(c).n;
  console.log(`  ${c}    ${String(n).padStart(4)}  (%${total ? Math.round((n / total) * 100) : 0})`);
}
const bolge = (process.argv[2] || "TR").toUpperCase();
const missing = db.prepare(`SELECT g.title, g.tags,
    (SELECT COUNT(*) FROM prices p2 WHERE p2.game_id = g.id) AS baska
  FROM games g WHERE g.hidden = 0
    AND NOT EXISTS (SELECT 1 FROM prices p WHERE p.game_id = g.id AND p.country = ?)
  ORDER BY g.popular_rank IS NULL, g.popular_rank LIMIT 15`).all(bolge);
console.log(`\n${bolge} bölgesinde fiyatı olmayan ilk 15 popüler oyun:`);
for (const m of missing) {
  const free = JSON.parse(m.tags || "[]").includes("Free to Play") ? "  [ücretsiz oyun]" : "";
  console.log(`  - ${m.title}${free}${m.baska ? "  (başka bölgelerde fiyatı var)" : "  (hiçbir bölgede fiyat yok)"}`);
}
const shops = db.prepare(`SELECT shop_name AS s, COUNT(DISTINCT game_id) AS n FROM prices
  WHERE country = ? GROUP BY shop_name ORDER BY n DESC`).all(bolge);
console.log(`\n${bolge} bölgesinde fiyat veren mağazalar (oyun sayısı):`);
for (const x of shops) console.log(`  ${x.s.padEnd(28)} ${x.n}`);
const health = db.prepare("SELECT shop_name, ok, reason, checked_at FROM shop_health ORDER BY ok, shop_name").all();
if (health.length) {
  const bad = health.filter((h) => !h.ok);
  console.log(`\nMağaza erişim kontrolü: ${health.length} mağaza, ${bad.length} tanesi açılmadığı için gizli`);
  for (const h of bad) console.log(`  ✗ ${h.shop_name}  (${h.reason})`);
}
if (process.env.SHOPS_HIDE) console.log(`Elle gizlenenler (.env SHOPS_HIDE): ${process.env.SHOPS_HIDE}`);
const tagged = db.prepare("SELECT COUNT(DISTINCT game_id) AS n FROM game_tags").get().n;
const rated = db.prepare("SELECT COUNT(*) AS n FROM games WHERE rating_pos IS NOT NULL").get().n;
const withReq = db.prepare("SELECT COUNT(*) AS n FROM media WHERE length(req_min) > 2 OR length(req_rec) > 2").get().n;
console.log(`\nKategorisi olan oyun: ${tagged}   Puanı olan oyun: ${rated}   Sistem gereksinimi olan oyun: ${withReq}`);
const steamTotal = db.prepare("SELECT COUNT(*) AS n FROM steam_apps").get().n;
if (steamTotal) {
  const mapped = db.prepare("SELECT COUNT(*) AS n FROM steam_apps WHERE mapped = 1").get().n;
  console.log(`\nSteam listesi: ${steamTotal} oyun, ${mapped} tanesi işlendi`);
}
const stale = db.prepare(`SELECT COUNT(*) AS n FROM games WHERE hidden = 0 AND last_priced IS NULL`).get().n;
console.log(`Fiyatı henüz hiç çekilmemiş oyun: ${stale}`);
console.log("");
