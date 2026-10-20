// E-posta denemesi: .env'deki SMTP ayarlarıyla bir deneme maili gönderir.
// Kullanım:  npm run mailtest            → SMTP_USER adresine gönderir
//            npm run mailtest -- adres@ornek.com  → verilen adrese gönderir
import "dotenv/config";
import nodemailer from "nodemailer";
import { layout, gameImage } from "./mailtemplate.js";

const { SMTP_HOST, SMTP_PORT, SMTP_USER, MAIL_FROM } = process.env;
const SMTP_PASS = String(process.env.SMTP_PASS || "").replace(/\s+/g, "");   // boşluklu kopyalanan şifreyi düzelt
const to = process.argv[2] || SMTP_USER;
const port = Number(SMTP_PORT || 587);
const site = (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");

console.log("\nE-posta ayarları (.env):");
console.log(`  SMTP_HOST : ${SMTP_HOST || "(boş)"}`);
console.log(`  SMTP_PORT : ${port}`);
console.log(`  SMTP_USER : ${SMTP_USER || "(boş)"}`);
console.log(`  SMTP_PASS : ${SMTP_PASS ? "dolu (" + SMTP_PASS.length + " karakter)" : "(boş)"}`);
console.log(`  Gönderen  : ${MAIL_FROM || SMTP_USER || "(boş)"}`);
console.log(`  Alıcı     : ${to || "(boş)"}\n`);

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.log("✗ SMTP ayarları eksik. \"npm run kurulum\" yazıp mail ayarlarını gir ya da .env dosyasını doldur.");
  console.log("  Gmail için: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_PASS = Google \"uygulama şifresi\" (normal şifre çalışmaz).\n");
  process.exit(1);
}
if (!to) { console.log("✗ Alıcı adresi yok. Şöyle yaz:  npm run mailtest -- adresin@gmail.com\n"); process.exit(1); }

const transport = nodemailer.createTransport({
  host: SMTP_HOST, port, secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

try {
  console.log("1) Mail sunucusuna bağlanılıyor…");
  await transport.verify();
  console.log("   ✓ Bağlantı ve giriş başarılı.");
  console.log("2) Deneme maili gönderiliyor…");
  const info = await transport.sendMail({
    from: MAIL_FROM || SMTP_USER, to,
    subject: "Fiyatavı – e-posta denemesi",
    text: `Bu bir deneme mailidir.\n\nBunu görüyorsan Fiyatavı'nın mail ayarları çalışıyor: fiyat düşüşü, hedef fiyat, e-posta doğrulama ve şifre sıfırlama mailleri de gidecektir.\n\nGönderim zamanı: ${new Date().toLocaleString("tr-TR")}`,
    // örnek bir "fiyat düştü" maili: tasarımın gelen kutusunda nasıl göründüğünü gösterir
    html: layout({
      site: process.env.SITE_NAME || "Fiyatavı", siteUrl: site, preheader: "Deneme: mail ayarların çalışıyor",
      image: gameImage({ appid: 292030 }), imageAlt: "The Witcher 3: Wild Hunt",
      kicker: "Deneme maili", title: "Mail ayarların çalışıyor",
      paragraphs: ["Bu bir deneme. Fiyat düşüşü, hedef fiyat, doğrulama ve şifre sıfırlama mailleri bu görünümle gelecek. Aşağıdaki kutu örnektir."],
      price: { label: "Yeni fiyat", now: "₺1.733,81", old: "₺2.476,87", cut: 30, shop: "Steam", extra: "Önceki fiyat: ₺2.476,87" },
      cta: { href: site, label: "Siteyi aç" }, ctaHint: "Düğme çalışmazsa:",
      footer: [`Gönderim zamanı: ${new Date().toLocaleString("tr-TR")}`],
    }),
  });
  console.log(`   ✓ Gönderildi (${info.messageId}).`);
  console.log(`\nŞimdi ${to} gelen kutusuna bak. Birkaç dakikada gelmezse Spam / Gereksiz klasörünü de kontrol et.\n`);
} catch (e) {
  console.log(`   ✗ Hata: ${e.message}\n`);
  if (e.code === "EAUTH" || /535|Username and Password|BadCredentials/i.test(e.message)) {
    console.log("   Sebep: kullanıcı adı ya da şifre kabul edilmedi.");
    console.log("   Gmail kullanıyorsan normal şifren çalışmaz; Google hesabında 2 adımlı doğrulamayı açıp");
    console.log("   \"Uygulama şifreleri\" bölümünden 16 haneli bir şifre al ve SMTP_PASS'e onu yaz (boşluksuz).\n");
  } else if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ENOTFOUND"].includes(e.code)) {
    console.log("   Sebep: mail sunucusuna bağlanılamadı. SMTP_HOST ve SMTP_PORT'u kontrol et");
    console.log("   (Gmail: smtp.gmail.com, 465). Okul/yurt ağı mail portlarını engelliyor olabilir; telefondan internet paylaşıp tekrar dene.\n");
  }
  process.exit(1);
}
