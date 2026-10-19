// SteamSpy: kategori (etiket) başına oyun listesi, oyuncu değerlendirmeleri ve tahmini satış sayıları.
// Ücretsiz ve anahtarsız; saniyede en fazla 1 istek kabul ediyor.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sitedeki kategoriler: anahtar = Steam etiketi (değiştirme), tr/en = gösterilen ad
export const CATEGORIES = [
  ["Action", "Aksiyon", "Action"], ["Adventure", "Macera", "Adventure"], ["Puzzle", "Bulmaca", "Puzzle"],
  ["RPG", "Rol yapma", "RPG"], ["Strategy", "Strateji", "Strategy"], ["Simulation", "Simülasyon", "Simulation"],
  ["FPS", "Nişancı", "Shooter"], ["Horror", "Korku", "Horror"], ["Open World", "Açık dünya", "Open world"],
  ["Survival", "Hayatta kalma", "Survival"], ["Racing", "Yarış", "Racing"], ["Sports", "Spor", "Sports"],
  ["Multiplayer", "Çok oyunculu", "Multiplayer"], ["Platformer", "Platform", "Platformer"],
  ["Casual", "Rahat", "Casual"], ["Indie", "Bağımsız", "Indie"],
];

// SteamSpy'dan çekilecek etiketler: sitedeki kategoriler
export const FETCH_TAGS = CATEGORIES.map((c) => c[0]);

// "1,000,000 .. 2,000,000" → 1500000
export function parseOwners(s) {
  const n = String(s || "").split("..").map((x) => Number(x.replace(/[^\d]/g, ""))).filter((x) => !Number.isNaN(x));
  return n.length === 2 ? Math.round((n[0] + n[1]) / 2) : n[0] ?? null;
}

let last = 0;
export async function fetchTag(tag) {
  const wait = 2000 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const r = await fetch(`https://steamspy.com/api.php?request=tag&tag=${encodeURIComponent(tag)}`, { signal: AbortSignal.timeout(240_000) });
  if (!r.ok) throw new Error(`SteamSpy ${tag} → ${r.status}`);
  const d = await r.json();
  return Object.values(d ?? {}).filter((a) => a && a.appid);
}
