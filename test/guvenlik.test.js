// Üyelik ve güvenlik testleri: şifre özeti, oturum, e-posta bağlantıları, deneme sınırı
import { test } from "node:test";
import assert from "node:assert/strict";
import { geciciVeriTabani } from "./yardimci.js";

geciciVeriTabani("guvenlik");
const { db } = await import("../src/db.js");
const auth = await import("../src/auth.js");

const kullaniciEkle = (email) =>
  db.prepare("INSERT INTO users (email, name, pass_hash) VALUES (?, 'Test', 'x')").run(email).lastInsertRowid;

test("şifre düz metin olarak saklanmaz, doğru şifre kabul edilir", async () => {
  const ozet = await auth.hashPassword("gizli123");
  assert.ok(!ozet.includes("gizli123"), "özette şifrenin kendisi geçmemeli");
  assert.match(ozet, /^[0-9a-f]{32}:[0-9a-f]{128}$/, "biçim tuz:özet olmalı");
  assert.equal(await auth.verifyPassword("gizli123", ozet), true);
  assert.equal(await auth.verifyPassword("yanlis123", ozet), false);
});

test("aynı şifre iki kez özetlenince tuz yüzünden farklı sonuç çıkar", async () => {
  const a = await auth.hashPassword("ayniSifre");
  const b = await auth.hashPassword("ayniSifre");
  assert.notEqual(a, b);
});

test("oturum çerezi kullanıcıyı tanır, oturum silinince tanımaz", () => {
  const id = kullaniciEkle("oturum@test.com");
  const token = auth.createSession(id);
  const istek = { headers: { cookie: `sid=${token}` } };
  auth.attachUser(istek, {}, () => {});
  assert.equal(istek.user.email, "oturum@test.com");

  auth.destroySession(token);
  const istek2 = { headers: { cookie: `sid=${token}` } };
  auth.attachUser(istek2, {}, () => {});
  assert.equal(istek2.user, null);
});

test("çerez güvenlik ayarları: HttpOnly ve SameSite", () => {
  const cerez = auth.sessionCookie("a".repeat(64));
  assert.match(cerez, /HttpOnly/);
  assert.match(cerez, /SameSite=Lax/);
});

test("giriş gerektiren adres, giriş yoksa 401 döner", () => {
  let kod = null;
  const cevap = { status(c) { kod = c; return this; }, json() { return this; } };
  auth.requireUser({ user: null }, cevap, () => assert.fail("devam etmemeli"));
  assert.equal(kod, 401);
});

test("e-posta bağlantısı tek kullanımlıktır ve veri tabanında sadece özeti tutulur", () => {
  const id = kullaniciEkle("baglanti@test.com");
  const kod = auth.createEmailToken(id, "reset", 1);
  const kayit = db.prepare("SELECT token_hash FROM email_tokens WHERE user_id = ?").get(id);
  assert.notEqual(kayit.token_hash, kod, "bağlantının kendisi saklanmamalı");

  assert.equal(auth.consumeEmailToken(kod, "reset"), id);
  assert.equal(auth.consumeEmailToken(kod, "reset"), null, "ikinci kullanım reddedilmeli");
});

test("yanlış türdeki bağlantı kabul edilmez", () => {
  const id = kullaniciEkle("tur@test.com");
  const kod = auth.createEmailToken(id, "verify", 48);
  assert.equal(auth.consumeEmailToken(kod, "reset"), null);
});

test("aynı IP'den 15 dakikada 10'dan fazla deneme engellenir", () => {
  const anahtar = "giris:1.2.3.4";
  for (let i = 1; i <= 10; i++) assert.equal(auth.tooManyAttempts(anahtar), false, `${i}. deneme serbest`);
  assert.equal(auth.tooManyAttempts(anahtar), true, "11. deneme engellenmeli");
});

test("kullanıcı silinince oturumları da silinir (ON DELETE CASCADE)", () => {
  const id = kullaniciEkle("sil@test.com");
  auth.createSession(id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  const kalan = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(id).n;
  assert.equal(kalan, 0);
});
