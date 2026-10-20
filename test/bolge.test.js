// Site sadece Türkiye fiyatlarını gösteriyor: eski sürümden kalan diğer bölge kayıtları
// sunucu açılınca bir kez silinmeli, Türkiye kayıtları ve kullanıcılar korunmalı.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { geciciVeriTabani } from "./yardimci.js";

geciciVeriTabani("bolge");
const { db } = await import("../src/db.js");
const { COUNTRIES } = await import("../src/sync.js");

test("fiyatlar sadece Türkiye için çekilir", () => {
  assert.deepEqual(COUNTRIES, ["TR"]);
});

test("eski sürümden kalan diğer bölge kayıtları bir kez temizlenir", () => {
  // eski sürümü taklit et: birkaç bölgeden fiyat, ABD'li bir kullanıcı, temizlik henüz yapılmamış
  db.prepare("INSERT INTO games (id, title) VALUES ('g1', 'Oyun')").run();
  const fiyat = db.prepare(`INSERT INTO prices (game_id, country, shop_id, shop_name, price, regular, currency, cut)
    VALUES ('g1', ?, '61', 'Steam', ?, ?, ?, 0)`);
  fiyat.run("TR", 500, 500, "TRY"); fiyat.run("US", 20, 20, "USD"); fiyat.run("DE", 18, 18, "EUR");
  const enDusuk = db.prepare(`INSERT INTO lows (game_id, country, shop, price, regular, currency, cut) VALUES ('g1', ?, 'Steam', ?, ?, ?, 0)`);
  enDusuk.run("TR", 500, 500, "TRY"); enDusuk.run("US", 20, 20, "USD");
  db.prepare("INSERT INTO price_history (game_id, country, day, lowest, currency) VALUES ('g1', 'US', '2026-01-01', 20, 'USD')").run();
  db.prepare("INSERT INTO users (email, name, pass_hash, country) VALUES ('a@test.com', 'A', 'x', 'US')").run();
  db.prepare("DELETE FROM meta WHERE key = 'only_tr'").run();

  // sunucunun yeniden açılmasını taklit et: db.js'i ayrı bir süreçte aynı veri tabanıyla yükle
  execFileSync(process.execPath, ["--no-warnings", "-e", "await import('./src/db.js')", "--input-type=module"],
    { env: process.env, cwd: new URL("..", import.meta.url).pathname });

  const bolgeler = (tablo) => db.prepare(`SELECT DISTINCT country AS c FROM ${tablo} ORDER BY c`).all().map((r) => r.c);
  assert.deepEqual(bolgeler("prices"), ["TR"]);
  assert.deepEqual(bolgeler("lows"), ["TR"]);
  assert.deepEqual(bolgeler("price_history"), []);
  assert.equal(db.prepare("SELECT price FROM prices WHERE country = 'TR'").get().price, 500, "Türkiye fiyatı korunur");
  assert.equal(db.prepare("SELECT country FROM users WHERE email = 'a@test.com'").get().country, "TR", "kullanıcı silinmez, bölgesi Türkiye olur");
  assert.ok(db.prepare("SELECT 1 FROM meta WHERE key = 'only_tr'").get(), "temizlik bir kez yapılır");
});
