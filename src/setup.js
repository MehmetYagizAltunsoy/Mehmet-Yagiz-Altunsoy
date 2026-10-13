// Kurulum: anahtarları ve site bilgilerini sorar, dener, .env dosyasını oluşturur/günceller.
// Tekrar çalıştırılırsa mevcut ayarları korur; sadece değiştirmek istediğini değiştirirsin.
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const root = new URL("../", import.meta.url);
const envPath = new URL(".env", root);
const examplePath = new URL(".env.example", root);
const rl = readline.createInterface({ input: stdin, output: stdout });
rl.on("close", () => process.exit(0));

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8")
  : fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf8") : "";
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
function set(k, v) {
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : env.replace(/\n*$/, "\n") + `${k}=${v}\n`;
  fs.writeFileSync(envPath, env);
}
const clean = (s) => s.trim().replace(/^["']|["']$/g, "");
const hidden = (k) => (k.length > 10 ? k.slice(0, 6) + "…" + k.slice(-4) : "…");

async function testItad(key) {
  try {
    const r = await fetch(`https://api.isthereanydeal.com/games/lookup/v1?key=${encodeURIComponent(key)}&appid=620`);
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  } catch (e) { return { status: 0, body: e.message }; }
}
async function testSteam(key) {
  try {
    const u = new URL("https://api.steampowered.com/IStoreService/GetAppList/v1/");
    u.searchParams.set("key", key); u.searchParams.set("max_results", "1");
    const r = await fetch(u);
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  } catch (e) { return { status: 0, body: e.message }; }
}

async function keyStep({ name, envKey, test, help, optional }) {
  console.log(`\n--- ${name} ---`);
  if (help) console.log(help);
  const cur = get(envKey);
  if (cur && !cur.includes("buraya")) {
    process.stdout.write(`Kayıtlı anahtar (${hidden(cur)}) deneniyor… `);
    const r = await test(cur);
    if (r.status === 200) {
      console.log("✓ çalışıyor.");
      const v = clean(await rl.question("Değiştirmek için yeni anahtarı yapıştır, aynen kalsın diye Enter'a bas: "));
      if (!v) return;
      return tryKey(v);
    }
    console.log(`✗ çalışmıyor (kod ${r.status}).`);
  }
  for (;;) {
    const v = clean(await rl.question(`${name}${optional ? " (geçmek için Enter)" : ""}: `));
    if (!v) { if (optional) { console.log("Geçildi."); return; } continue; }
    if (await tryKey(v)) return;
  }
  async function tryKey(v) {
    if (v.includes("*")) { console.log("✗ Anahtarda yıldız (*) var, bu gizlenmiş hâli. Anahtarı görünür yapıp tekrar kopyala."); return false; }
    if (/\s/.test(v)) { console.log("✗ Anahtarda boşluk var. Sadece anahtarı yapıştır, başına ya da sonuna bir şey yazma."); return false; }
    process.stdout.write("Deneniyor… ");
    const r = await test(v);
    if (r.status === 200) { set(envKey, v); console.log("✓ çalışıyor ve kaydedildi."); return true; }
    console.log(r.status === 0 ? `✗ İnternete bağlanılamadı: ${r.body}` : `✗ kabul edilmedi (kod ${r.status}): ${r.body}`);
    return false;
  }
}

async function textStep(label, envKey, fallback = "") {
  const cur = get(envKey) || fallback;
  const v = clean(await rl.question(`${label}${cur ? ` [şu an: ${cur}]` : ""} (Enter = ${cur ? "aynen kalsın" : "boş kalsın"}): `));
  if (v) set(envKey, v);
  else if (!get(envKey) && fallback) set(envKey, fallback);
}

console.log("\n=== Kurulum ===");
if (!fs.existsSync(envPath)) fs.writeFileSync(envPath, env);

await keyStep({
  name: "IsThereAnyDeal API anahtarı", envKey: "ITAD_API_KEY", test: testItad,
  help: "isthereanydeal.com → Apps → API Keys bölümündeki anahtar. (Yapıştırmak için sağ tık ya da Ctrl + V)",
});
await keyStep({
  name: "Steam Web API anahtarı", envKey: "STEAM_API_KEY", test: testSteam, optional: true,
  help: "Steam'deki neredeyse tüm oyunlar için gerekli. Ücretsiz: https://steamcommunity.com/dev/apikey (alan adına localhost yaz)",
});

console.log("\n--- Site bilgileri ---");
await textStep("Site adı", "SITE_NAME", "Fiyatavı");
await textStep("Yardım sayfasında görünecek e-posta", "SUPPORT_EMAIL");
await textStep("Yardım sayfasında görünecek Instagram kullanıcı adı", "SUPPORT_INSTAGRAM");
console.log("\nKVKK metinlerinde 'veri sorumlusu' olarak görünecek ad (siteyi sen işletiyorsan kendi adın soyadın):");
await textStep("Veri sorumlusu", "CONTROLLER_NAME");
console.log("Maillerdeki bağlantıların doğru çalışması için sitenin adresi (şimdilik http://localhost:3000, yayına alınca alan adın):");
await textStep("Site adresi", "SITE_URL", "http://localhost:3000");


console.log("\n✓ Kurulum bitti. Şimdi şunu yaz:  npm start\n");
rl.close();
