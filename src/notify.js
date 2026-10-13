import { db } from "./db.js";
import { sendMail } from "./mailer.js";

const SITE = process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`;
const NAME = process.env.SITE_NAME || "Fiyatavı";
const qLow = db.prepare("SELECT shop, price, currency, cut FROM lows WHERE game_id = ? AND country = ?");
const setLast = db.prepare("UPDATE wishlist SET last_price = ? WHERE user_id = ? AND game_id = ?");
const setHit = db.prepare("UPDATE wishlist SET target_hit = ? WHERE user_id = ? AND game_id = ?");
const log = db.prepare("INSERT INTO notifications (user_id, game_id, kind, text) VALUES (?, ?, ?, ?)");

const money = (v, c, lang) => {
  try { return new Intl.NumberFormat(lang === "en" ? "en-US" : "tr-TR", { style: "currency", currency: c }).format(v); }
  catch { return `${v} ${c}`; }
};

const T = {
  tr: {
    added: (g, p, s) => [`${g} istek listene eklendi`,
      `${g} istek listene eklendi.\n\nŞu an en ucuz ${p} fiyatla ${s} üzerinde. Fiyatı düştüğünde sana mail atacağız.\n\n${NAME}\n${SITE}`],
    addedNoPrice: (g) => [`${g} istek listene eklendi`,
      `${g} istek listene eklendi. Bölgende fiyat bulunduğunda ve fiyat düştüğünde sana mail atacağız.\n\n${SITE}`],
    target: (g, t, p, s) => [`${g} hedef fiyatına indi: ${p}`,
      `İstek listendeki ${g} oyunu belirlediğin hedef fiyata ulaştı.\n\nHedefin: ${t}\nŞimdi: ${p} (${s})\n\n${NAME}\n${SITE}`],
    drop: (g, old, p, s) => [`${g} ucuzladı: ${p}`,
      `İstek listendeki ${g} oyununun fiyatı düştü.\n\nÖnceki fiyat: ${old}\nŞimdi: ${p} (${s})\n\nBu mailleri ${NAME} ayarlarından kapatabilirsin.\n${SITE}`],
  },
  en: {
    added: (g, p, s) => [`${g} added to your wishlist`,
      `${g} was added to your wishlist.\n\nIt's currently cheapest at ${p} on ${s}. We'll email you when the price drops.\n\n${SITE}`],
    addedNoPrice: (g) => [`${g} added to your wishlist`,
      `${g} was added to your wishlist. We'll email you once it's priced in your region and when it drops.\n\n${SITE}`],
    target: (g, t, p, s) => [`${g} hit your target price: ${p}`,
      `A game on your wishlist reached the target price you set: ${g}.\n\nYour target: ${t}\nNow: ${p} (${s})\n\n${NAME}\n${SITE}`],
    drop: (g, old, p, s) => [`${g} price drop: ${p}`,
      `A game on your wishlist got cheaper: ${g}.\n\nBefore: ${old}\nNow: ${p} (${s})\n\n${SITE}`],
  },
};

async function deliver(user, gameId, kind, [subject, text]) {
  if (!user.verified) return;   // doğrulanmamış adreslere mail gönderilmez
  log.run(user.id, gameId, kind, subject);
  try { await sendMail({ to: user.email, subject, text }); }
  catch (e) { console.error("Mail gönderilemedi:", e.message); }
}

// İstek listesine eklenince
export async function notifyAdded(user, game) {
  const lang = user.lang === "en" ? "en" : "tr";
  const lo = qLow.get(game.id, user.country);
  setLast.run(lo?.price ?? null, user.id, game.id);
  const msg = lo ? T[lang].added(game.title, money(lo.price, lo.currency, lang), lo.shop) : T[lang].addedNoPrice(game.title);
  await deliver({ ...user, verified: !!user.email_verified }, game.id, "added", msg);
}

// Her fiyat güncellemesinden sonra: istek listesindeki oyunlar ucuzladı mı?
export async function checkPriceDrops() {
  const rows = db.prepare(`SELECT w.user_id, w.game_id, w.last_price, w.target_price, w.target_currency, w.target_hit,
      u.email, u.email_verified, u.country, u.lang, u.notify_drops, u.min_cut, g.title
    FROM wishlist w JOIN users u ON u.id = w.user_id JOIN games g ON g.id = w.game_id`).all();
  let sent = 0;
  for (const r of rows) {
    const lo = qLow.get(r.game_id, r.country);
    if (!lo) continue;
    const lang = r.lang === "en" ? "en" : "tr";
    const who = { id: r.user_id, email: r.email, verified: !!r.email_verified };
    // hedef fiyat alarmı: hedef konmuşsa genel düşüş maili yerine sadece hedefe inince haber ver
    if (r.target_price != null) {
      if (lo.currency === r.target_currency) {
        if (lo.price <= r.target_price + 1e-9 && !r.target_hit) {
          await deliver(who, r.game_id, "target", T[lang].target(r.title, money(r.target_price, lo.currency, lang), money(lo.price, lo.currency, lang), lo.shop));
          setHit.run(1, r.user_id, r.game_id); sent++;
        } else if (lo.price > r.target_price && r.target_hit) setHit.run(0, r.user_id, r.game_id);
      }
      if (lo.price !== r.last_price) setLast.run(lo.price, r.user_id, r.game_id);
      continue;
    }
    if (lo.price === r.last_price) continue;
    if (r.last_price != null && lo.price < r.last_price - 0.005 && r.notify_drops && (lo.cut ?? 0) >= (r.min_cut ?? 0)) {
      await deliver(who, r.game_id, "drop",
        T[lang].drop(r.title, money(r.last_price, lo.currency, lang), money(lo.price, lo.currency, lang), lo.shop));
      sent++;
    }
    setLast.run(lo.price, r.user_id, r.game_id); // fiyat yükseldiyse de yeni taban olarak kaydet
  }
  if (sent) console.log(`  ${sent} fiyat düşüşü bildirimi gönderildi`);
}
