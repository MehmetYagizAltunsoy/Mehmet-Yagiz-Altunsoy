import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync(process.env.DB_PATH || "ganimet.db");
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,      -- IsThereAnyDeal oyun kimliği
  slug          TEXT,
  title         TEXT NOT NULL,         -- orijinal ad, asla çevrilmez
  release_date  TEXT,
  developers    TEXT,                  -- JSON dizi
  tags          TEXT,                  -- JSON dizi
  boxart        TEXT,                  -- resmi kapak görseli adresi
  steam_appid   INTEGER UNIQUE,
  popular_rank  INTEGER,
  history_done  INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prices (
  game_id    TEXT NOT NULL REFERENCES games(id),
  country    TEXT NOT NULL,            -- US, DE, TR ...
  shop_id    TEXT NOT NULL,
  shop_name  TEXT NOT NULL,
  price      REAL NOT NULL,
  regular    REAL NOT NULL,
  currency   TEXT NOT NULL,
  cut        INTEGER DEFAULT 0,        -- indirim yüzdesi
  expiry     TEXT,                     -- indirimin bitiş zamanı
  url        TEXT,
  updated_at TEXT,
  PRIMARY KEY (game_id, country, shop_id)
);
CREATE TABLE IF NOT EXISTS price_history (
  game_id  TEXT NOT NULL,
  country  TEXT NOT NULL,
  day      TEXT NOT NULL,              -- YYYY-MM-DD
  lowest   REAL NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (game_id, country, day)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS history_fetched (   -- hangi oyun+bölgenin geçmişi çekildi
  game_id TEXT NOT NULL,
  country TEXT NOT NULL,
  PRIMARY KEY (game_id, country)
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,             -- scrypt + tuz, düz şifre asla saklanmaz
  country    TEXT DEFAULT 'US',         -- fiyat bildirimleri bu bölgeye göre
  lang       TEXT DEFAULT 'tr',         -- mailler bu dilde
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL REFERENCES games(id),
  added_at   TEXT DEFAULT (datetime('now')),
  last_price REAL,                      -- fiyat düşüşünü yakalamak için son bilinen fiyat
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT,
  kind    TEXT,                         -- added | drop
  text    TEXT,
  sent_at TEXT DEFAULT (datetime('now'))
);
`);

// Eski sürümden kalan veri tabanlarına yeni sütunları ekle
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    return true;
  }
  return false;
}
addColumn("games", "type", "TEXT");
addColumn("games", "appid", "INTEGER");                    // Steam numarası (kapak için)
addColumn("games", "free", "INTEGER DEFAULT 0");           // ücretsiz oyun
addColumn("games", "last_priced", "TEXT");                 // fiyatı en son ne zaman çekildi
addColumn("games", "viewed_at", "TEXT");                   // en son ne zaman bakıldı (sık güncellenir)
db.exec("UPDATE games SET appid = steam_appid WHERE appid IS NULL AND steam_appid IS NOT NULL");

db.exec(`
CREATE TABLE IF NOT EXISTS lows (                          -- her oyun+bölge için en ucuz teklif (liste ve sıralama için)
  game_id TEXT NOT NULL, country TEXT NOT NULL,
  shop TEXT, price REAL, regular REAL, currency TEXT, cut INTEGER, expiry TEXT,
  PRIMARY KEY (game_id, country)
);
CREATE TABLE IF NOT EXISTS steam_apps (                    -- Steam'in resmi oyun listesi (ara tablo)
  appid INTEGER PRIMARY KEY, name TEXT, mapped INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS games_rank ON games (popular_rank);
CREATE INDEX IF NOT EXISTS games_title ON games (title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS games_priced ON games (last_priced);
CREATE INDEX IF NOT EXISTS steam_unmapped ON steam_apps (mapped);
`);
addColumn("lows", "usd", "REAL");                          // karşılaştırma/sıralama için yaklaşık dolar karşılığı
addColumn("lows", "low_m3", "REAL");                       // son 3 ayın en düşüğü
addColumn("lows", "low_all", "REAL");                      // tüm zamanların en düşüğü
addColumn("users", "notify_drops", "INTEGER DEFAULT 1");
addColumn("games", "rating_pos", "INTEGER");                 // olumlu değerlendirme sayısı (Steam)
addColumn("games", "rating_neg", "INTEGER");                 // olumsuz değerlendirme sayısı (Steam)
addColumn("games", "rating_at", "TEXT");
addColumn("games", "owners", "INTEGER");                     // tahmini satış (SteamSpy)
addColumn("games", "waitlist_rank", "INTEGER");              // en çok istek listesine eklenenler sırası
addColumn("games", "collected_rank", "INTEGER");             // en çok sahip olunanlar sırası
addColumn("prices", "usd", "REAL");
addColumn("games", "appid_checked", "INTEGER DEFAULT 0");      // Steam numarası arandı mı
// e-posta doğrulama: bu sürümden önce açılmış hesaplar doğrulanmış sayılır
if (addColumn("users", "email_verified", "INTEGER DEFAULT 0")) db.exec("UPDATE users SET email_verified = 1");
addColumn("users", "consent_at", "TEXT");
addColumn("users", "avatar", "TEXT");                          // profil resmi olarak seçilen oyunun kimliği                     // kayıt sırasında aydınlatma metninin gösterildiği zaman
addColumn("wishlist", "target_price", "REAL");                // hedef fiyat alarmı
addColumn("wishlist", "target_currency", "TEXT");
addColumn("wishlist", "target_hit", "INTEGER DEFAULT 0");      // hedefe ulaşıldı maili gönderildi mi
db.exec("CREATE TABLE IF NOT EXISTS media (game_id TEXT PRIMARY KEY, video TEXT, poster TEXT, checked_at TEXT)");
addColumn("media", "req_min", "TEXT");                         // sistem gereksinimleri (JSON satırlar)
addColumn("media", "req_rec", "TEXT");
addColumn("media", "details_v", "INTEGER DEFAULT 0");
addColumn("media", "shots", "TEXT");                           // oyunun ekran görüntüleri (JSON)
db.exec(`CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,              -- verify | reset
  expires_at TEXT NOT NULL
)`);
db.exec(`
CREATE TABLE IF NOT EXISTS game_tags (game_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (game_id, tag));
CREATE INDEX IF NOT EXISTS game_tags_tag ON game_tags (tag, game_id);
CREATE TABLE IF NOT EXISTS media (game_id TEXT PRIMARY KEY, video TEXT, poster TEXT, checked_at TEXT);
CREATE INDEX IF NOT EXISTS games_owners ON games (owners);
CREATE INDEX IF NOT EXISTS games_appid ON games (appid);
`);   // fiyat düşünce mail at
addColumn("users", "min_cut", "INTEGER DEFAULT 0");        // sadece bu indirim oranından sonra
if (!db.prepare("SELECT 1 FROM lows LIMIT 1").get()) {
  db.exec(`INSERT OR IGNORE INTO lows (game_id, country, shop, price, regular, currency, cut, expiry)
    SELECT game_id, country, shop_name, price, regular, currency, cut, expiry FROM prices p
    WHERE price = (SELECT MIN(price) FROM prices p2 WHERE p2.game_id = p.game_id AND p2.country = p.country)`);
}
addColumn("games", "hidden", "INTEGER DEFAULT 0");          // DLC, yetişkin içerik vb. gizlenir
if (addColumn("games", "info_done", "INTEGER DEFAULT 0")) {  // bilgi ve kapak çekildi mi
  db.exec("UPDATE games SET info_done = 1 WHERE boxart IS NOT NULL OR tags IS NOT NULL");
}
db.exec(`UPDATE games SET free = 1 WHERE free = 0 AND tags LIKE '%"Free to Play"%'`);

// Farklı para birimlerindeki fiyatları karşılaştırmak için yaklaşık kurlar (1 birim = ? USD)
export const USD_RATE = { USD: 1, EUR: 1.16, GBP: 1.33, JPY: 0.0067, BRL: 0.185, CAD: 0.72, AUD: 0.66, MXN: 0.054, CHF: 1.25, TRY: 0.024 };
db.exec(`UPDATE lows SET usd = price * CASE currency ${Object.entries({ USD: 1, EUR: 1.16, GBP: 1.33, JPY: 0.0067, BRL: 0.185, CAD: 0.72, AUD: 0.66, MXN: 0.054, CHF: 1.25, TRY: 0.024 })
  .map(([c, r]) => `WHEN '${c}' THEN ${r}`).join(" ")} ELSE 1 END WHERE usd IS NULL`);

const rateCase = `CASE currency ${Object.entries(USD_RATE).map(([c, r]) => `WHEN '${c}' THEN ${r}`).join(" ")} ELSE 1 END`;
db.exec(`UPDATE prices SET usd = price * ${rateCase} WHERE usd IS NULL`);
// eski sürümden kalan etiketleri kategori tablosuna aktar
if (!db.prepare("SELECT 1 FROM game_tags LIMIT 1").get()) {
  const ins = db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag) VALUES (?, ?)");
  db.exec("BEGIN");
  for (const g of db.prepare("SELECT id, tags FROM games WHERE tags IS NOT NULL").all()) {
    try { for (const t of JSON.parse(g.tags)) ins.run(g.id, t); } catch {}
  }
  db.exec("COMMIT");
}

export function tx(fn) {
  db.exec("BEGIN");
  try { fn(); db.exec("COMMIT"); }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}
