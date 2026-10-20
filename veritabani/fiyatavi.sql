-- =====================================================================
--  Fiyatavı – Oyun Fiyat Karşılaştırma Sitesi
--  Fiziksel veri tabanı şeması (SQLite 3)
--
--  Bu dosya 4. haftadaki ER diyagramının birebir karşılığıdır:
--    10 varlık  → 10 tablo (+ M:N ilişkiler için 2 ara tablo)
--    1:N        → çocuk tabloda yabancı anahtar (FOREIGN KEY)
--    M:N        → iki yabancı anahtardan oluşan birleşik birincil anahtarlı ara tablo
--    1:1        → çocuk tablonun birincil anahtarı aynı zamanda yabancı anahtar
--
--  Çalıştırmak için:  sqlite3 fiyatavi.db < fiyatavi.sql
-- =====================================================================

PRAGMA foreign_keys = ON;   -- SQLite'ta yabancı anahtar kontrolü varsayılan olarak kapalıdır

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS email_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS wishlist;
DROP TABLE IF EXISTS game_tags;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS price_history;
DROP TABLE IF EXISTS prices;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS games;

-- ---------------------------------------------------------------------
-- 1) OYUN
-- ---------------------------------------------------------------------
CREATE TABLE games (
    id            TEXT    PRIMARY KEY,                 -- IsThereAnyDeal oyun kimliği (UUID)
    title         TEXT    NOT NULL,                    -- oyunun adı
    release_date  TEXT,                                -- çıkış tarihi, YYYY-MM-DD
    boxart        TEXT,                                -- kapak görselinin adresi
    appid         INTEGER UNIQUE,                      -- Steam numarası (varsa eşsiz)
    popular_rank  INTEGER CHECK (popular_rank > 0),    -- popülerlik sırası
    rating_pos    INTEGER NOT NULL DEFAULT 0 CHECK (rating_pos >= 0),   -- olumlu Steam değerlendirmesi
    rating_neg    INTEGER NOT NULL DEFAULT 0 CHECK (rating_neg >= 0),   -- olumsuz Steam değerlendirmesi
    free          INTEGER NOT NULL DEFAULT 0 CHECK (free IN (0, 1))     -- ücretsiz oyun mu
);

-- ---------------------------------------------------------------------
-- 2) KULLANICI
--    PROFİL RESMİ ilişkisi (N:1): avatar → games.id
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL,
    pass_hash       TEXT    NOT NULL,                  -- scrypt özeti "tuz:özet" (düz şifre saklanmaz)
    country         TEXT    NOT NULL DEFAULT 'US' CHECK (length(country) = 2),
    lang            TEXT    NOT NULL DEFAULT 'tr' CHECK (lang IN ('tr', 'en')),
    avatar          TEXT    REFERENCES games(id) ON DELETE SET NULL,   -- profil resmi olarak seçilen oyun
    email_verified  INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
    consent_at      TEXT    NOT NULL,                  -- KVKK onayının verildiği zaman
    notify_drops    INTEGER NOT NULL DEFAULT 1 CHECK (notify_drops IN (0, 1)),
    min_cut         INTEGER NOT NULL DEFAULT 0 CHECK (min_cut BETWEEN 0 AND 100),
    weekly_digest   INTEGER NOT NULL DEFAULT 1 CHECK (weekly_digest IN (0, 1)),   -- haftalık özet maili açık mı
    last_digest_at  TEXT,                              -- son haftalık özetin gönderildiği zaman
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 3) KATEGORİ  +  AİT OLUR ilişkisi (OYUN – KATEGORİ, M:N)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
    tag      TEXT PRIMARY KEY,                         -- etiket adı (Steam etiketi, ör. 'RPG')
    name_tr  TEXT NOT NULL,                            -- sitede görünen Türkçe adı
    name_en  TEXT NOT NULL                             -- sitede görünen İngilizce adı
);

CREATE TABLE game_tags (
    game_id  TEXT NOT NULL REFERENCES games(id)      ON DELETE CASCADE,
    tag      TEXT NOT NULL REFERENCES categories(tag) ON DELETE CASCADE,
    PRIMARY KEY (game_id, tag)
);

-- ---------------------------------------------------------------------
-- 4) İSTEK LİSTESİ = TAKİP EDER ilişkisi (KULLANICI – OYUN, M:N)
--    İlişkinin kendi nitelikleri olduğu için ayrı tablo
-- ---------------------------------------------------------------------
CREATE TABLE wishlist (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id          TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    added_at         TEXT    NOT NULL DEFAULT (datetime('now')),   -- eklenme tarihi
    last_price       REAL    CHECK (last_price >= 0),              -- son bilinen fiyat
    target_price     REAL    CHECK (target_price > 0),             -- hedef fiyat (isteğe bağlı)
    target_currency  TEXT    CHECK (length(target_currency) = 3),
    target_hit       INTEGER NOT NULL DEFAULT 0 CHECK (target_hit IN (0, 1)),
    PRIMARY KEY (user_id, game_id)                     -- aynı oyun aynı listeye iki kez eklenemez
);

-- ---------------------------------------------------------------------
-- 5) FİYAT (zayıf varlık) – SATILIR ilişkisi (OYUN 1:N FİYAT)
-- ---------------------------------------------------------------------
CREATE TABLE prices (
    game_id    TEXT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    country    TEXT    NOT NULL CHECK (length(country) = 2),   -- bölge: TR, US, DE…
    shop_id    TEXT    NOT NULL,                               -- mağaza kimliği
    shop_name  TEXT    NOT NULL,                               -- Steam, Epic Games Store…
    price      REAL    NOT NULL CHECK (price >= 0),            -- güncel fiyat
    regular    REAL    NOT NULL CHECK (regular >= 0),          -- indirimsiz fiyat
    currency   TEXT    NOT NULL CHECK (length(currency) = 3),  -- TRY, USD, EUR…
    cut        INTEGER NOT NULL DEFAULT 0 CHECK (cut BETWEEN 0 AND 100),   -- indirim yüzdesi
    url        TEXT,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (game_id, country, shop_id)
);

-- ---------------------------------------------------------------------
-- 6) FİYAT GEÇMİŞİ (zayıf varlık) – KAYDEDİLİR ilişkisi (OYUN 1:N)
-- ---------------------------------------------------------------------
CREATE TABLE price_history (
    game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    country   TEXT NOT NULL CHECK (length(country) = 2),
    day       TEXT NOT NULL,                               -- YYYY-MM-DD
    lowest    REAL NOT NULL CHECK (lowest >= 0),           -- o günün en düşük fiyatı
    currency  TEXT NOT NULL CHECK (length(currency) = 3),
    PRIMARY KEY (game_id, country, day)                    -- günde tek kayıt
);

-- ---------------------------------------------------------------------
-- 7) MEDYA – SAHİPTİR ilişkisi (OYUN 1:1 MEDYA)
--    Birincil anahtar aynı zamanda yabancı anahtar → her oyuna en fazla bir kayıt
-- ---------------------------------------------------------------------
CREATE TABLE media (
    game_id  TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    shots    TEXT,                                         -- ekran görüntüleri (JSON dizi)
    req_min  TEXT,                                         -- en düşük sistem gereksinimleri (JSON)
    req_rec  TEXT                                          -- önerilen sistem gereksinimleri (JSON)
);

-- ---------------------------------------------------------------------
-- 8) OTURUM – AÇAR ilişkisi (KULLANICI 1:N)
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
    token       TEXT    PRIMARY KEY,                       -- 64 karakterlik rastgele kod
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT    NOT NULL
);

-- ---------------------------------------------------------------------
-- 9) E-POSTA TOKENİ – ALIR ilişkisi (KULLANICI 1:N)
-- ---------------------------------------------------------------------
CREATE TABLE email_tokens (
    token_hash  TEXT    PRIMARY KEY,                       -- bağlantı kodunun SHA-256 özeti
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('verify', 'reset')),
    expires_at  TEXT    NOT NULL
);

-- ---------------------------------------------------------------------
-- 10) BİLDİRİM – GÖNDERİLİR (KULLANICI 1:N) ve İLGİLİDİR (OYUN 1:N)
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id  TEXT    REFERENCES games(id) ON DELETE SET NULL,
    kind     TEXT    NOT NULL CHECK (kind IN ('added', 'drop', 'target', 'digest')),
    text     TEXT    NOT NULL,
    sent_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- İndeksler: sık yapılan aramaları hızlandırır
-- ---------------------------------------------------------------------
CREATE INDEX idx_games_title    ON games (title COLLATE NOCASE);   -- oyun adıyla arama, A–Z
CREATE INDEX idx_games_rank     ON games (popular_rank);           -- popülerliğe göre sıralama
CREATE INDEX idx_game_tags_tag  ON game_tags (tag, game_id);       -- kategoriye göre listeleme
CREATE INDEX idx_prices_lookup  ON prices (game_id, country, price);
CREATE INDEX idx_sessions_user  ON sessions (user_id);
CREATE INDEX idx_wishlist_game  ON wishlist (game_id);


-- =====================================================================
--  ÖRNEK VERİLER
-- =====================================================================

INSERT INTO categories (tag, name_tr, name_en) VALUES
    ('Action',     'Aksiyon',       'Action'),
    ('Adventure',  'Macera',        'Adventure'),
    ('RPG',        'Rol yapma',     'RPG'),
    ('Open World', 'Açık dünya',    'Open world'),
    ('Strategy',   'Strateji',      'Strategy'),
    ('Indie',      'Bağımsız',      'Indie'),
    ('Simulation', 'Simülasyon',    'Simulation');

INSERT INTO games (id, title, release_date, appid, popular_rank, rating_pos, rating_neg, free) VALUES
    ('g-elden-ring',  'Elden Ring',        '2022-02-25', 1245620, 1, 620000, 45000, 0),
    ('g-cyberpunk',   'Cyberpunk 2077',    '2020-12-10', 1091500, 2, 690000, 95000, 0),
    ('g-stardew',     'Stardew Valley',    '2016-02-26',  413150, 3, 580000,  8000, 0),
    ('g-hades',       'Hades',             '2020-09-17', 1145360, 4, 270000,  4000, 0),
    ('g-dota2',       'Dota 2',            '2013-07-09',     570, 5, 1900000, 400000, 1);

INSERT INTO game_tags (game_id, tag) VALUES
    ('g-elden-ring', 'Action'), ('g-elden-ring', 'RPG'), ('g-elden-ring', 'Open World'),
    ('g-cyberpunk',  'RPG'),    ('g-cyberpunk',  'Open World'),
    ('g-stardew',    'Simulation'), ('g-stardew', 'Indie'),
    ('g-hades',      'Action'), ('g-hades', 'Indie'),
    ('g-dota2',      'Strategy');

INSERT INTO prices (game_id, country, shop_id, shop_name, price, regular, currency, cut) VALUES
    ('g-elden-ring', 'TR', '61', 'Steam',             1299.00, 1299.00, 'TRY',  0),
    ('g-elden-ring', 'TR', '16', 'Epic Game Store',    909.30, 1299.00, 'TRY', 30),
    ('g-elden-ring', 'US', '61', 'Steam',               59.99,   59.99, 'USD',  0),
    ('g-cyberpunk',  'TR', '61', 'Steam',              999.00,  999.00, 'TRY',  0),
    ('g-cyberpunk',  'TR', '35', 'GOG',                499.50,  999.00, 'TRY', 50),
    ('g-stardew',    'TR', '61', 'Steam',               50.14,   50.14, 'TRY',  0),
    ('g-hades',      'TR', '61', 'Steam',              184.00,  368.00, 'TRY', 50);

INSERT INTO price_history (game_id, country, day, lowest, currency) VALUES
    ('g-elden-ring', 'TR', '2026-08-15', 1299.00, 'TRY'),
    ('g-elden-ring', 'TR', '2026-09-15', 1039.20, 'TRY'),
    ('g-elden-ring', 'TR', '2026-10-15',  909.30, 'TRY'),
    ('g-cyberpunk',  'TR', '2026-09-15',  999.00, 'TRY'),
    ('g-cyberpunk',  'TR', '2026-10-15',  499.50, 'TRY');

INSERT INTO media (game_id, shots, req_min) VALUES
    ('g-elden-ring', '["https://.../ss1.jpg","https://.../ss2.jpg"]', '[{"k":"OS","v":"Windows 10"}]');

INSERT INTO users (email, name, pass_hash, country, lang, avatar, email_verified, consent_at) VALUES
    ('ali@example.com',  'Ali',  'a1b2c3…:9f8e7d…', 'TR', 'tr', 'g-elden-ring', 1, '2026-10-01 14:20:00'),
    ('ayse@example.com', 'Ayşe', 'd4e5f6…:6c5b4a…', 'TR', 'tr', NULL,           1, '2026-10-03 09:05:00');

INSERT INTO wishlist (user_id, game_id, last_price, target_price, target_currency) VALUES
    (1, 'g-elden-ring', 1299.00, 1000.00, 'TRY'),
    (1, 'g-hades',       368.00, NULL,    NULL),
    (2, 'g-elden-ring', 1299.00, NULL,    NULL);

INSERT INTO sessions (token, user_id, expires_at) VALUES
    ('3f9a…(64 karakter)', 1, datetime('now', '+30 days'));

INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES
    ('8c1d…(SHA-256 özeti)', 2, 'reset', datetime('now', '+1 hour'));

INSERT INTO notifications (user_id, game_id, kind, text) VALUES
    (1, 'g-elden-ring', 'target', 'Elden Ring hedef fiyatına indi: 909,30 TL'),
    (1, 'g-hades',      'drop',   'Hades fiyatı düştü: 184,00 TL');


-- =====================================================================
--  ÖRNEK SORGULAR
-- =====================================================================

-- S1) Türkiye'de her oyunun en ucuz mağazası ve fiyatı
SELECT g.title, p.shop_name, p.price, p.currency, p.cut
FROM games g
JOIN prices p ON p.game_id = g.id AND p.country = 'TR'
WHERE p.price = (SELECT MIN(p2.price) FROM prices p2
                 WHERE p2.game_id = g.id AND p2.country = 'TR')
ORDER BY g.popular_rank;

-- S2) Bir kullanıcının istek listesi ve hedef fiyata ulaşılıp ulaşılmadığı
SELECT u.name, g.title, w.target_price,
       MIN(p.price) AS en_ucuz,
       CASE WHEN w.target_price IS NOT NULL AND MIN(p.price) <= w.target_price
            THEN 'hedefe ulaştı' ELSE '-' END AS durum
FROM wishlist w
JOIN users u ON u.id = w.user_id
JOIN games g ON g.id = w.game_id
LEFT JOIN prices p ON p.game_id = w.game_id AND p.country = u.country
WHERE u.email = 'ali@example.com'
GROUP BY w.user_id, w.game_id;

-- S3) Kategorilere göre oyun sayısı (M:N ilişki üzerinden)
SELECT c.name_tr AS kategori, COUNT(gt.game_id) AS oyun_sayisi
FROM categories c
LEFT JOIN game_tags gt ON gt.tag = c.tag
GROUP BY c.tag
ORDER BY oyun_sayisi DESC;

-- S4) Fiyat geçmişi: bir oyunun aylara göre en düşük fiyatı (sitedeki grafik)
SELECT substr(day, 1, 7) AS ay, MIN(lowest) AS en_dusuk
FROM price_history
WHERE game_id = 'g-elden-ring' AND country = 'TR'
GROUP BY ay
ORDER BY ay;

-- S5) Fiyat güncellemesi (UPDATE) ve eski oturumların silinmesi (DELETE)
UPDATE prices SET price = 649.50, cut = 50, updated_at = datetime('now')
WHERE game_id = 'g-elden-ring' AND country = 'TR' AND shop_id = '16';

DELETE FROM sessions WHERE expires_at <= datetime('now');
