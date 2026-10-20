// Hesap mailleri: e-posta doğrulama ve şifre sıfırlama
import { sendMail } from "./mailer.js";
import { layout } from "./mailtemplate.js";

const SITE = () => (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const NAME = () => process.env.SITE_NAME || "Fiyatavı";

const T = {
  tr: {
    verify: {
      subject: () => `${NAME()}: e-posta adresini doğrula`,
      kicker: "Hesabın", title: "E-posta adresini doğrula",
      body: () => [`${NAME()} hesabını tamamlamak için aşağıdaki düğmeye bas. Doğruladıktan sonra istek listendeki oyunların fiyatı düşünce sana mail atabileceğiz.`],
      cta: "E-postamı doğrula",
      note: "Bağlantı 48 saat geçerlidir. Bu hesabı sen açmadıysan bu maili görmezden gelebilirsin.",
    },
    reset: {
      subject: () => `${NAME()}: şifre sıfırlama`,
      kicker: "Hesabın", title: "Şifreni sıfırla",
      body: () => ["Şifreni sıfırlamak için aşağıdaki düğmeye bas ve yeni şifreni belirle."],
      cta: "Yeni şifre belirle",
      note: "Bağlantı 1 saat geçerlidir ve bir kez kullanılabilir. Bu isteği sen yapmadıysan bu maili görmezden gel; şifren değişmez.",
    },
    ctaHint: "Düğme çalışmazsa:",
  },
  en: {
    verify: {
      subject: () => `${NAME()}: verify your email`,
      kicker: "Your account", title: "Verify your email",
      body: () => [`Press the button below to finish setting up your ${NAME()} account. Once verified, we can email you when games on your wishlist get cheaper.`],
      cta: "Verify my email",
      note: "The link is valid for 48 hours. If you didn't create this account, ignore this email.",
    },
    reset: {
      subject: () => `${NAME()}: reset your password`,
      kicker: "Your account", title: "Reset your password",
      body: () => ["Press the button below to choose a new password."],
      cta: "Choose a new password",
      note: "The link is valid for 1 hour and can be used once. If you didn't ask for this, ignore this email; your password stays the same.",
    },
    ctaHint: "If the button doesn't work:",
  },
};

export async function sendAccountMail(kind, user, token) {
  const lang = user.lang === "en" ? "en" : "tr";
  const link = `${SITE()}/?${kind}=${token}`;
  const K = T[lang][kind];
  const subject = K.subject();
  const text = [K.title, "", ...K.body(), "", link, "", K.note, "", NAME()].join("\n");
  const html = layout({
    lang, site: NAME(), siteUrl: SITE(), preheader: K.body()[0],
    kicker: K.kicker, title: K.title, paragraphs: K.body(),
    cta: { href: link, label: K.cta }, ctaHint: T[lang].ctaHint, footer: [K.note],
  });
  try { await sendMail({ to: user.email, subject, text, html }); }
  catch (e) { console.error("Hesap maili gönderilemedi:", e.message); }
}
