// Fiyat takibi testleri: fiyat düşünce ve hedef fiyata inince bildirim oluşuyor mu?
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { geciciVeriTabani } from "./yardimci.js";

geciciVeriTabani("bildirim");
const { db } = await import("../src/db.js");
const { checkPriceDrops } = await import("../src/notify.js");

// mail gönderilmediğinde mailer.js içeriği ekrana yazar; testlerde bu çıktıyı sustur
console.log = () => {};

let uid = 0;
function hazirla({ dogrulandi = 1, sonFiyat = 1000, hedef = null, simdi = 900, minCut = 0, indirim = 10 } = {}) {
  uid++;
  const oyun = `oyun-${uid}`;
  db.prepare("INSERT INTO games (id, title) VALUES (?, ?)").run(oyun, `Oyun ${uid}`);
  const kullanici = db.prepare(`INSERT INTO users (email, name, pass_hash, country, email_verified, min_cut)
    VALUES (?, 'Test', 'x', 'TR', ?, ?)`).run(`k${uid}@test.com`, dogrulandi, minCut).lastInsertRowid;
  db.prepare(`INSERT INTO wishlist (user_id, game_id, last_price, target_price, target_currency)
    VALUES (?, ?, ?, ?, ?)`).run(kullanici, oyun, sonFiyat, hedef, hedef ? "TRY" : null);
  db.prepare(`INSERT INTO lows (game_id, country, shop, price, regular, currency, cut)
    VALUES (?, 'TR', 'Steam', ?, 1000, 'TRY', ?)`).run(oyun, simdi, indirim);
  return { kullanici, oyun };
}
const bildirimler = (kullanici) =>
  db.prepare("SELECT kind FROM notifications WHERE user_id = ?").all(kullanici).map((r) => r.kind);
const fiyatDegistir = (oyun, fiyat) => db.prepare("UPDATE lows SET price = ? WHERE game_id = ?").run(fiyat, oyun);

beforeEach(() => db.exec("DELETE FROM notifications"));

test("fiyat düşünce 'drop' bildirimi oluşur ve son fiyat güncellenir", async () => {
  const { kullanici, oyun } = hazirla({ sonFiyat: 1000, simdi: 900 });
  await checkPriceDrops();
  assert.deepEqual(bildirimler(kullanici), ["drop"]);
  const son = db.prepare("SELECT last_price FROM wishlist WHERE game_id = ?").get(oyun).last_price;
  assert.equal(son, 900);
});

test("fiyat değişmediyse ikinci kez bildirim gönderilmez", async () => {
  const { kullanici } = hazirla({ sonFiyat: 1000, simdi: 900 });
  await checkPriceDrops();
  await checkPriceDrops();
  assert.equal(bildirimler(kullanici).length, 1);
});

test("fiyat yükselirse bildirim gitmez", async () => {
  const { kullanici } = hazirla({ sonFiyat: 900, simdi: 1000 });
  await checkPriceDrops();
  assert.deepEqual(bildirimler(kullanici), []);
});

test("e-postası doğrulanmamış kullanıcıya bildirim gitmez", async () => {
  const { kullanici } = hazirla({ dogrulandi: 0, sonFiyat: 1000, simdi: 500 });
  await checkPriceDrops();
  assert.deepEqual(bildirimler(kullanici), []);
});

test("indirim, kullanıcının seçtiği orandan küçükse bildirim gitmez", async () => {
  const { kullanici } = hazirla({ sonFiyat: 1000, simdi: 900, indirim: 10, minCut: 50 });
  await checkPriceDrops();
  assert.deepEqual(bildirimler(kullanici), []);
});

test("hedef fiyata inince 'target' bildirimi bir kez gider", async () => {
  const { kullanici, oyun } = hazirla({ sonFiyat: 1000, hedef: 800, simdi: 900 });
  await checkPriceDrops();
  assert.deepEqual(bildirimler(kullanici), [], "hedefin üstündeyken haber verilmez");

  fiyatDegistir(oyun, 750);
  await checkPriceDrops();
  await checkPriceDrops();
  assert.deepEqual(bildirimler(kullanici), ["target"], "hedefe inince tek bildirim");
});

test("fiyat hedefin üstüne çıkıp tekrar inerse yeniden haber verilir", async () => {
  const { kullanici, oyun } = hazirla({ sonFiyat: 1000, hedef: 800, simdi: 750 });
  await checkPriceDrops();
  fiyatDegistir(oyun, 950);
  await checkPriceDrops();
  fiyatDegistir(oyun, 700);
  await checkPriceDrops();
  assert.deepEqual(bildirimler(kullanici), ["target", "target"]);
});

// ---------- Haftalık özet ----------
const { sendWeeklyDigests, buildDigest } = await import("../src/notify.js");
const ozetSayisi = (kullanici) =>
  db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'digest'").get(kullanici).n;

test("haftalık özet: ilk turda gönderilmez, sadece sayaç başlar", async () => {
  const { kullanici } = hazirla();
  db.prepare("UPDATE users SET last_digest_at = NULL WHERE id = ?").run(kullanici);
  await sendWeeklyDigests();
  assert.equal(ozetSayisi(kullanici), 0);
  assert.ok(db.prepare("SELECT last_digest_at FROM users WHERE id = ?").get(kullanici).last_digest_at);
});

test("haftalık özet: 7 gün dolmadan tekrar gönderilmez, dolunca gönderilir", async () => {
  const { kullanici } = hazirla();
  db.prepare("UPDATE users SET last_digest_at = datetime('now', '-3 days') WHERE id = ?").run(kullanici);
  await sendWeeklyDigests();
  assert.equal(ozetSayisi(kullanici), 0, "3 gün sonra gitmemeli");
  db.prepare("UPDATE users SET last_digest_at = datetime('now', '-8 days') WHERE id = ?").run(kullanici);
  await sendWeeklyDigests();
  assert.equal(ozetSayisi(kullanici), 1, "8 gün sonra gitmeli");
});

test("haftalık özeti kapatan kullanıcıya özet gitmez", async () => {
  const { kullanici } = hazirla();
  db.prepare("UPDATE users SET weekly_digest = 0, last_digest_at = datetime('now', '-30 days') WHERE id = ?").run(kullanici);
  await sendWeeklyDigests();
  assert.equal(ozetSayisi(kullanici), 0);
});

test("haftalık özet maili indirimdeki oyunları ve fiyat değişimini yazar", () => {
  const { kullanici, oyun } = hazirla({ simdi: 500, indirim: 50 });
  db.prepare("INSERT INTO price_history (game_id, country, day, lowest, currency) VALUES (?, 'TR', date('now', '-8 days'), 1000, 'TRY')").run(oyun);
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(kullanici);
  const mail = buildDigest(u);
  assert.match(mail.subject, /1 oyun indirimde/);
  assert.match(mail.text, /-%50/);
  assert.match(mail.text, /Geçen haftaya göre .* ucuz/);
  assert.match(mail.html, /<table/);
});
