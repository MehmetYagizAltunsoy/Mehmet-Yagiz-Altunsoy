// Steam'in resmi oyun listesi — ücretsiz Steam Web API anahtarı gerekir
// https://steamcommunity.com/dev/apikey
export async function* gamePages(key) {
  let last = 0;
  for (;;) {
    const u = new URL("https://api.steampowered.com/IStoreService/GetAppList/v1/");
    u.searchParams.set("key", key);
    u.searchParams.set("include_games", "true");
    u.searchParams.set("include_dlc", "false");
    u.searchParams.set("include_software", "false");
    u.searchParams.set("include_videos", "false");
    u.searchParams.set("include_hardware", "false");
    u.searchParams.set("max_results", "50000");
    if (last) u.searchParams.set("last_appid", String(last));
    const r = await fetch(u);
    if (r.status === 401 || r.status === 403) throw new Error("Steam API anahtarı geçersiz. \"npm run kurulum\" ile yeniden gir.");
    if (!r.ok) throw new Error(`Steam listesi alınamadı (kod ${r.status})`);
    const d = (await r.json()).response ?? {};
    yield d.apps ?? [];
    if (!d.have_more_results || !d.last_appid) break;
    last = d.last_appid;
  }
}

export async function testKey(key) {
  const u = new URL("https://api.steampowered.com/IStoreService/GetAppList/v1/");
  u.searchParams.set("key", key);
  u.searchParams.set("max_results", "1");
  const r = await fetch(u);
  return { status: r.status, body: (await r.text()).slice(0, 200) };
}
