// IsThereAnyDeal API istemcisi — https://docs.isthereanydeal.com/
const BASE = "https://api.isthereanydeal.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Limit: 5 dakikada ITAD_RATE_LIMIT istek (varsayılan 100). Güvenli payla bunun %90'ını kullanır.
const LIMIT = Math.max(1, Math.floor(Number(process.env.ITAD_RATE_LIMIT || 100) * 0.9));
const WINDOW = 5 * 60_000;
const sent = [];
let queue = Promise.resolve();

function throttle() {
  // İstekleri sıraya koyar; pencere doluysa en eski istek pencereden çıkana kadar bekler
  const turn = queue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] >= WINDOW) sent.shift();
      if (sent.length < LIMIT) { sent.push(now); return; }
      const wait = WINDOW - (now - sent[0]) + 250;
      console.log(`  API limiti: ${Math.ceil(wait / 1000)} sn bekleniyor…`);
      await sleep(wait);
    }
  });
  queue = turn.catch(() => {});
  return turn;
}

async function call(path, { query = {}, body } = {}, attempt = 1) {
  await throttle();
  const url = new URL(BASE + path);
  url.searchParams.set("key", process.env.ITAD_API_KEY);
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 4) {
    const retry = Number(res.headers.get("retry-after")) || 60;
    console.log(`  API limiti aşıldı, ${retry} sn sonra tekrar denenecek…`);
    await sleep(retry * 1000);
    return call(path, { query, body }, attempt + 1);
  }
  if (res.status >= 500 && attempt < 4) {
    await sleep(2000 * attempt);
    return call(path, { query, body }, attempt + 1);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`API anahtarı kabul edilmedi (kod ${res.status}): ${(await res.text()).slice(0, 200)}\n  Anahtarı yeniden girmek için sunucuyu durdurup "npm run kurulum" yaz.`);
  }
  if (!res.ok) throw new Error(`ITAD ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export const lookup = ({ appid, title }) => call("/games/lookup/v1", { query: { appid, title } });
export const info = (id) => call("/games/info/v2", { query: { id } });
export const prices = (ids, country) => call("/games/prices/v3", { query: { country }, body: ids });
export const history = (id, country, since) => call("/games/history/v2", { query: { id, country, since } });
export const mostPopular = (offset = 0, limit = 100) => call("/stats/most-popular/v1", { query: { offset, limit } });
// Steam numaralarını IsThereAnyDeal kimliklerine toplu çevirir: { "app/620": "id" | null }
export const lookupSteam = (appids) => call("/lookup/id/shop/61/v1", { body: appids.map((a) => `app/${a}`) });
// IsThereAnyDeal kimliklerinden Steam numaralarına: { "<id>": ["app/620", ...] }
export const steamIdsOf = (ids) => call("/lookup/shop/61/id/v1", { body: ids });
export const mostWaitlisted = (offset = 0, limit = 100) => call("/stats/most-waitlisted/v1", { query: { offset, limit } });
export const mostCollected = (offset = 0, limit = 100) => call("/stats/most-collected/v1", { query: { offset, limit } });
export const search = (title, results = 20) => call("/games/search/v1", { query: { title, results } });

// Son 5 dakikada kullanılan istek sayısı (arka plan işleri limiti kullanıcılara bırakmak için bakar)
export const RATE_LIMIT = LIMIT;
export function usage() {
  const now = Date.now();
  return sent.filter((t) => now - t < WINDOW).length;
}
