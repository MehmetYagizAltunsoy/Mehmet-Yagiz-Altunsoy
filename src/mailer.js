import nodemailer from "nodemailer";

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      // Gmail uygulama şifresi 4'lü gruplar halinde boşluklu kopyalanır; boşluklar silinir
      auth: { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS || "").replace(/\s+/g, "") },
    })
  : null;

// SMTP ayarlanmamışsa mail gönderilmez, terminale yazdırılır (geliştirme için)
export async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    console.log(`\n[mail — SMTP ayarlı değil, gönderilmedi]\n  Kime: ${to}\n  Konu: ${subject}\n  ${text.replace(/\n/g, "\n  ")}\n`);
    return false;
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });   // html: güzel görünüm, text: HTML göstermeyen programlar için
  return true;
}
