// veritabani/fiyatavi.sql testleri: şema ER diyagramına uygun mu, kısıtlamalar çalışıyor mu?
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

let db;
before(() => {
  const sql = fs.readFileSync(new URL("../veritabani/fiyatavi.sql", import.meta.url), "utf8");
  db = new DatabaseSync(":memory:");
  db.exec(sql);
});

const hataVerir = (sql, desen) => assert.throws(() => db.exec(sql), desen);

test("ER diyagramındaki tüm varlıklar ve ara tablolar oluşturulur", () => {
  const tablolar = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((r) => r.name);
  assert.deepEqual(tablolar, ["categories", "email_tokens", "game_tags", "games", "media", "notifications",
    "price_history", "prices", "sessions", "users", "wishlist"]);
});

test("M:N ara tabloların birincil anahtarı iki sütundan oluşur", () => {
  for (const [tablo, beklenen] of [["wishlist", ["user_id", "game_id"]], ["game_tags", ["game_id", "tag"]]]) {
    const pk = db.prepare(`PRAGMA table_info(${tablo})`).all().filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    assert.deepEqual(pk, beklenen, tablo);
  }
});

test("olmayan bir oyuna fiyat eklenemez (FOREIGN KEY)", () => {
  hataVerir(`INSERT INTO prices (game_id, country, shop_id, shop_name, price, regular, currency)
             VALUES ('olmayan-oyun', 'TR', '1', 'Steam', 10, 10, 'TRY')`, /FOREIGN KEY/);
});

test("aynı oyun aynı kullanıcının listesine iki kez eklenemez", () => {
  hataVerir("INSERT INTO wishlist (user_id, game_id) VALUES (1, 'g-elden-ring')", /UNIQUE/);
});

test("aynı e-postayla ikinci hesap açılamaz", () => {
  hataVerir(`INSERT INTO users (email, name, pass_hash, consent_at)
             VALUES ('ali@example.com', 'x', 'y', '2026-10-01')`, /UNIQUE/);
});

test("geçersiz değerler CHECK kısıtına takılır", () => {
  hataVerir("UPDATE prices SET cut = 150 WHERE game_id = 'g-hades'", /CHECK/);
  hataVerir("UPDATE prices SET price = -5 WHERE game_id = 'g-hades'", /CHECK/);
  hataVerir("UPDATE users SET lang = 'de' WHERE id = 1", /CHECK/);
});

test("kullanıcı silinince istek listesi, bildirim ve oturumları da silinir", () => {
  db.exec("BEGIN");
  db.exec("DELETE FROM users WHERE id = 1");
  for (const tablo of ["wishlist", "notifications", "sessions"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${tablo} WHERE user_id = 1`).get().n, 0, tablo);
  }
  db.exec("ROLLBACK");
});

test("en ucuz fiyat sorgusu doğru mağazayı bulur", () => {
  const r = db.prepare(`SELECT p.shop_name, p.price FROM prices p
    WHERE p.game_id = 'g-cyberpunk' AND p.country = 'TR' ORDER BY p.price LIMIT 1`).get();
  assert.equal(r.shop_name, "GOG");
  assert.equal(r.price, 499.5);
});
