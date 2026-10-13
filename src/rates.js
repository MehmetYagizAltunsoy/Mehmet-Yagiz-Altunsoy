// Güncel döviz kurları: günde bir çekilir. Alınamazsa veri tabanındaki son kurlar, o da yoksa yaklaşık sabit kurlar kullanılır.
import { db, USD_RATE } from "./db.js";

const CODES = ["USD", "EUR", "GBP", "JPY", "BRL", "CAD", "AUD", "MXN", "CHF", "TRY"];
const metaGet = (k) => db.prepare("SELECT value FROM meta WHERE key = ?").get(k)?.value;
const metaSet = (k, v) => db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(k, v);

// 1 USD = ? birim
let perUsd = Object.fromEntries(CODES.map((c) => [c, 1 / USD_RATE[c]]));
let updatedAt = null;

function apply(rates, at) {
  for (const c of CODES) if (rates[c] > 0) { perUsd[c] = rates[c]; USD_RATE[c] = 1 / rates[c]; }
  updatedAt = at;
}
try { const saved = JSON.parse(metaGet("rates") || "null"); if (saved) apply(saved.rates, saved.at); } catch {}

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

export async function refreshRates() {
  if (updatedAt && Date.now() - Date.parse(updatedAt) < 20 * 3_600_000) return;
  let rates = null;
  try { rates = (await fetchJson(`https://api.frankfurter.app/latest?from=USD&to=${CODES.filter((c) => c !== "USD").join(",")}`)).rates; }
  catch (e) {
    try { rates = (await fetchJson("https://open.er-api.com/v6/latest/USD")).rates; }
    catch (e2) { console.warn("  döviz kurları alınamadı, son bilinen kurlar kullanılıyor:", e2.message); return; }
  }
  rates = { ...rates, USD: 1 };
  const at = new Date().toISOString();
  apply(rates, at);
  metaSet("rates", JSON.stringify({ rates: perUsd, at }));
  console.log(`  döviz kurları güncellendi (1 USD = ${perUsd.TRY.toFixed(2)} TRY)`);
}

export const currentRates = () => ({ perUsd, updatedAt });
