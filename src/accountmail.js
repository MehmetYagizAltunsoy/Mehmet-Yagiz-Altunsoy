// Hesap mailleri: e-posta doğrulama ve şifre sıfırlama
import { sendMail } from "./mailer.js";

const SITE = () => (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const NAME = () => process.env.SITE_NAME || "Fiyatavı";

const T = {
  tr: {
    verify: (link) => [`${NAME()}: e-posta adresini doğrula`,
      `Merhaba,\n\n${NAME()} hesabını tamamlamak için e-posta adresini doğrula:\n${link}\n\nBağlantı 48 saat geçerlidir. Bu hesabı sen açmadıysan bu maili görmezden gelebilirsin.\n\n${NAME()}`],
    reset: (link) => [`${NAME()}: şifre sıfırlama`,
      `Merhaba,\n\nŞifreni sıfırlamak için bu bağlantıyı aç:\n${link}\n\nBağlantı 1 saat geçerlidir ve bir kez kullanılabilir. Bu isteği sen yapmadıysan bu maili görmezden gel; şifren değişmez.\n\n${NAME()}`],
  },
  en: {
    verify: (link) => [`${NAME()}: verify your email`,
      `Hi,\n\nTo finish setting up your ${NAME()} account, verify your email:\n${link}\n\nThe link is valid for 48 hours. If you didn't create this account, ignore this email.\n\n${NAME()}`],
    reset: (link) => [`${NAME()}: reset your password`,
      `Hi,\n\nOpen this link to reset your password:\n${link}\n\nThe link is valid for 1 hour and can be used once. If you didn't ask for this, ignore this email; your password stays the same.\n\n${NAME()}`],
  },
};

export async function sendAccountMail(kind, user, token) {
  const lang = user.lang === "en" ? "en" : "tr";
  const link = `${SITE()}/?${kind}=${token}`;
  const [subject, text] = T[lang][kind](link);
  try { await sendMail({ to: user.email, subject, text }); }
  catch (e) { console.error("Hesap maili gönderilemedi:", e.message); }
}
