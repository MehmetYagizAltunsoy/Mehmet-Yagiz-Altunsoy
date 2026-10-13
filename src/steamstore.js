// Steam mağazasının herkese açık uç noktaları: oyuncu değerlendirmeleri ve fragmanlar
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Fiyatavi/1.0", "Accept-Language": "en" };

// { pos, neg, desc } — Steam'deki tüm dillerdeki değerlendirmeler
export async function reviews(appid) {
  const r = await fetch(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=1&filter=summary`,
    { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Steam değerlendirmeleri ${appid} → ${r.status}`);
  const q = (await r.json())?.query_summary;
  if (!q) return null;
  return { pos: q.total_positive ?? 0, neg: q.total_negative ?? 0 };
}

// Steam'in gereksinim HTML'ini düz satırlara çevir: [{ k: "İşletim sistemi", v: "Windows 10" }, ...]
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", reg: "®", trade: "™", copy: "©" };
export function parseReq(html) {
  if (!html || typeof html !== "string") return [];
  const text = html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/li>/gi, "\n").replace(/<li[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (m, e) => ENT[e] ?? (e[0] === "#" ? String.fromCharCode(Number(e.slice(1))) : m));
  return text.split("\n").map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !/^(minimum|recommended|en az|önerilen)\s*:?$/i.test(l))
    .map((l) => { const i = l.indexOf(":"); return i > 0 && i < 40 ? { k: l.slice(0, i).trim(), v: l.slice(i + 1).trim() } : { k: "", v: l }; })
    .filter((x) => x.v || x.k)
    .slice(0, 14);
}

// Oyunun resmî fragmanı ve sistem gereksinimleri
async function appdetails(appid, cc) {
  const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english${cc ? `&cc=${cc}` : ""}`,
    { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Steam ayrıntıları ${appid} → ${r.status}`);
  return (await r.json())?.[appid]?.data ?? null;
}
export async function details(appid) {
  // bazı oyunlar Türkiye'den bakınca "bu bölgede yok" görünüyor; o zaman ABD mağazasından dene
  const d = (await appdetails(appid)) ?? (await appdetails(appid, "us"));
  if (!d) return { video: null, poster: null, shots: [], reqMin: [], reqRec: [], empty: true };
  const movies = d.movies ?? [];
  const m = movies.find((x) => x.highlight) ?? movies[0];
  // Steam artık çoğu oyunda doğrudan MP4/WebM vermiyor, sadece akış biçimi (HLS) veriyor
  const direct = m?.mp4?.["480"] ?? m?.mp4?.max ?? m?.webm?.["480"] ?? m?.webm?.max ?? null;
  const video = direct ?? m?.hls_h264 ?? null;
  const pc = Array.isArray(d.pc_requirements) ? {} : d.pc_requirements ?? {};
  return {
    shots: (d.screenshots ?? []).slice(0, 6).map((x) => x.path_full).filter(Boolean),
    video: video?.replace(/^http:/, "https:") ?? null,
    poster: d.screenshots?.[0]?.path_full ?? m?.thumbnail ?? d.header_image ?? null,
    reqMin: parseReq(pc.minimum), reqRec: parseReq(pc.recommended),
  };
}

// (eski) sadece fragman
export async function trailer(appid) {
  const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`,
    { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return null;
  const d = (await r.json())?.[appid]?.data;
  if (!d) return null;
  const movies = d.movies ?? [];
  const m = movies.find((x) => x.highlight) ?? movies[0];
  const video = m?.mp4?.["480"] ?? m?.mp4?.max ?? m?.webm?.["480"] ?? m?.webm?.max ?? null;
  const poster = d.screenshots?.[0]?.path_full ?? m?.thumbnail ?? d.header_image ?? null;
  if (!video && !poster) return null;
  return { video: video?.replace(/^http:/, "https:") ?? null, poster };
}
