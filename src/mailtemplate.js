// HTML e-posta şablonu.
// Mail programları (Gmail, Outlook, telefon uygulamaları) modern CSS'i desteklemediği için
// düzen tablolarla, stiller de her etiketin içine (inline) yazılarak kurulur.

const C = {
  bg: "#F3F2FA", card: "#FFFFFF", text: "#1B1D36", muted: "#5E6082", line: "#E4E2F0",
  accent: "#FFC93C", accentText: "#1B1D36", good: "#0F8A8F", goodBg: "#E3F5F5",
};
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Oyun görseli: mailde yatay Steam başlık görseli en iyi durur; yoksa resmi kapak
export function gameImage(g) {
  if (g?.appid) return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/header.jpg`;
  return g?.boxart || null;
}

const button = (href, label) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px">
    <tr><td style="border-radius:10px;background:${C.accent}">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font:600 16px ${FONT};color:${C.accentText};text-decoration:none;border-radius:10px">${esc(label)}</a>
    </td></tr>
  </table>`;

// Fiyat kutusu: şimdiki fiyat, (varsa) eski fiyatın üstü çizili, indirim etiketi ve mağaza
function priceBox({ label, now, old, cut, shop, extra }) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};border-radius:12px;margin:18px 0">
    <tr><td style="padding:16px 18px;font-family:${FONT}">
      <div style="font-size:13px;color:${C.muted};margin-bottom:4px">${esc(label)}</div>
      <div>
        <span style="font-size:28px;font-weight:700;color:${C.text}">${esc(now)}</span>
        ${old ? `<span style="font-size:15px;color:${C.muted};text-decoration:line-through;margin-left:8px">${esc(old)}</span>` : ""}
        ${cut ? `<span style="display:inline-block;margin-left:8px;padding:3px 8px;border-radius:6px;background:${C.accent};color:${C.accentText};font-size:13px;font-weight:700">-%${esc(cut)}</span>` : ""}
      </div>
      ${shop ? `<div style="font-size:14px;color:${C.muted};margin-top:6px">${esc(shop)}</div>` : ""}
      ${extra ? `<div style="font-size:14px;color:${C.good};background:${C.goodBg};border-radius:8px;padding:8px 10px;margin-top:10px">${esc(extra)}</div>` : ""}
    </td></tr>
  </table>`;
}

// Haftalık özet: istek listesindeki her oyun için bir satır (küçük görsel, ad, fiyat, geçen haftaya göre değişim)
export function gameRows(items) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 18px">
  ${items.map((it) => `<tr><td style="padding:10px 0;border-top:1px solid ${C.line}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="96" style="padding-right:12px;vertical-align:top">${it.image
        ? `<a href="${esc(it.url)}"><img src="${esc(it.image)}" alt="" width="96" style="display:block;width:96px;height:auto;border-radius:6px;border:0"></a>`
        : `<div style="width:96px;height:45px;border-radius:6px;background:${C.bg}"></div>`}</td>
      <td style="font-family:${FONT};vertical-align:top">
        <a href="${esc(it.url)}" style="font-size:15px;font-weight:600;color:${C.text};text-decoration:none">${esc(it.title)}</a>
        <div style="margin-top:4px;font-size:15px;color:${C.text}">
          ${it.price ? `<b>${esc(it.price)}</b>` : `<span style="color:${C.muted}">${esc(it.noPrice)}</span>`}
          ${it.cut ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:5px;background:${C.accent};font-size:12px;font-weight:700">-%${esc(it.cut)}</span>` : ""}
          ${it.atl ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:5px;background:${C.goodBg};color:${C.good};font-size:12px;font-weight:700">${esc(it.atl)}</span>` : ""}
        </div>
        ${it.change ? `<div style="margin-top:3px;font-size:13px;color:${it.changeColor === "down" ? C.good : it.changeColor === "up" ? "#C8324F" : C.muted}">${esc(it.change)}</div>` : ""}
      </td></tr></table>
  </td></tr>`).join("")}
  </table>`;
}

/**
 * Ortak çerçeve.
 * @param {object} o
 *  site, siteUrl  – site adı ve adresi (logo bağlantısı)
 *  preheader      – gelen kutusunda konunun yanında görünen kısa önizleme metni
 *  image, imageAlt
 *  kicker, title  – küçük üst başlık ve büyük başlık
 *  paragraphs     – metin paragrafları (dizi)
 *  price          – priceBox parametreleri (isteğe bağlı)
 *  blocks         – hazır HTML parçası (ör. gameRows ile üretilen oyun listesi)
 *  cta            – { href, label } düğme (isteğe bağlı)
 *  footer         – alt bilgi satırları (dizi)
 */
export function layout(o) {
  return `<!doctype html>
<html lang="${o.lang || "tr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
 <tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
   <tr><td style="padding:0 4px 14px;font:700 20px ${FONT};color:${C.text}">
     <a href="${esc(o.siteUrl)}" style="color:${C.text};text-decoration:none">
       <span style="display:inline-block;width:26px;height:26px;border-radius:7px;background:${C.accent};vertical-align:-6px;margin-right:8px;text-align:center;font-size:15px;line-height:26px">◎</span>${esc(o.site)}
     </a>
   </td></tr>
   <tr><td style="background:${C.card};border-radius:16px;overflow:hidden;border:1px solid ${C.line}">
     ${o.image ? (() => {
       // görsel bir bağlantı içinde: tıklanınca oyun açılır, Gmail de üstüne "indir" düğmesi koymaz
       const img = `<img src="${esc(o.image)}" alt="${esc(o.imageAlt || "")}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0">`;
       const href = o.imageHref || o.cta?.href;
       return href ? `<a href="${esc(href)}" style="display:block;text-decoration:none">${img}</a>` : img;
     })() : ""}
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:24px 26px 26px;font-family:${FONT};color:${C.text}">
        ${o.kicker ? `<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.good};margin-bottom:6px">${esc(o.kicker)}</div>` : ""}
        <h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;font-weight:700;color:${C.text}">${esc(o.title)}</h1>
        ${(o.paragraphs || []).map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${C.text}">${esc(p)}</p>`).join("")}
        ${o.price ? priceBox(o.price) : ""}
        ${o.blocks || ""}
        ${o.cta ? button(o.cta.href, o.cta.label) : ""}
        ${o.cta ? `<p style="margin:14px 0 0;font-size:12px;color:${C.muted};word-break:break-all">${esc(o.ctaHint || "")} <a href="${esc(o.cta.href)}" style="color:${C.muted}">${esc(o.cta.href)}</a></p>` : ""}
      </td></tr>
     </table>
   </td></tr>
   <tr><td style="padding:16px 8px 0;font:12px/1.5 ${FONT};color:${C.muted};text-align:center">
     ${(o.footer || []).map(esc).join("<br>")}
   </td></tr>
  </table>
 </td></tr>
</table>
</body></html>`;
}
