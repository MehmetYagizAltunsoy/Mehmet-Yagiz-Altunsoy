// Yapay zekâ ile oyun bulma: kullanıcının anlattığı oyunu yerel Ollama modeline sorar.
// Ollama: https://ollama.com — bilgisayarda çalışır, internet ya da ücret gerektirmez.
const BASE = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL || "gemma3:4b";
let available = false;

export async function checkAI() {
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const names = ((await r.json()).models ?? []).map((m) => m.name);
    const want = MODEL.includes(":") ? MODEL : `${MODEL}:latest`;
    const was = available;
    available = names.includes(want);
    if (!available && names.length !== undefined && !was) console.warn(`  yapay zekâ: Ollama açık ama "${MODEL}" modeli yüklü değil. Yüklemek için: ollama pull ${MODEL}`);
    if (available && !was) console.log(`  yapay zekâ hazır (${MODEL})`);
  } catch {
    available = false;
  }
  return available;
}
export const aiAvailable = () => available;
export const aiModel = () => MODEL;

const SYSTEM = (lang) => `You identify PC video games from vague descriptions. The user remembers a game but not its name.
Reply ONLY with JSON in this exact shape:
{"games":[{"title":"<official title exactly as sold on Steam>","why":"<one short sentence in ${lang === "en" ? "English" : "Turkish"} explaining the match>"}]}
Give up to 5 real, existing games, most likely first. Never invent games. If the description is too vague, give your best guesses anyway.`;

export async function suggestGames(text, lang) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: MODEL, stream: false, format: "json", options: { temperature: 0.2 },
      messages: [{ role: "system", content: SYSTEM(lang) }, { role: "user", content: String(text).slice(0, 800) }],
    }),
  });
  if (!r.ok) throw new Error(`Ollama → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  let parsed = {};
  try { parsed = JSON.parse((await r.json()).message?.content || "{}"); } catch {}
  const list = Array.isArray(parsed) ? parsed : parsed.games ?? [];
  return list.filter((g) => g && typeof g.title === "string" && g.title.trim())
    .slice(0, 5).map((g) => ({ title: g.title.trim().slice(0, 120), why: String(g.why || "").slice(0, 240) }));
}
