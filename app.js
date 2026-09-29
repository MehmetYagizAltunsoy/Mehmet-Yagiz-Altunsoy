// Fiyatavı — oyun fiyat karşılaştırma
// Veri kaynağı: CheapShark API (https://apidocs.cheapshark.com) — ücretsiz, anahtar gerektirmez.

const API = "https://www.cheapshark.com/api/1.0";
const SITE = "https://www.cheapshark.com";

const $ = (sel) => document.querySelector(sel);
const statusEl = $("#status");
let stores = {};        // storeID -> { name, icon }
let lastResults = [];   // son arama sonuçları (geri dönmek için)

// ---------- Yardımcılar ----------
const money = (v) => "$" + Number(v).toFixed(2);

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

async function getJSON(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error("API hatası: " + res.status);
  return res.json();
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function show(section) {
  $("#results-section").hidden = section !== "results";
  $("#detail-section").hidden = section !== "detail";
}

// ---------- Mağazalar ----------
async function loadStores() {
  try {
    const list = await getJSON("/stores");
    list.forEach((s) => {
      stores[s.storeID] = { name: s.storeName, icon: SITE + s.images.icon, active: s.isActive };
    });
  } catch (e) {
    console.warn("Mağaza listesi alınamadı", e);
  }
}
const storeName = (id) => (stores[id] ? stores[id].name : "Mağaza #" + id);

// ---------- Günün fırsatları ----------
async function loadDeals() {
  const box = $("#deals");
  box.innerHTML = "<p class='status'>Yükleniyor…</p>";
  try {
    const deals = await getJSON("/deals?pageSize=12&sortBy=Deal%20Rating&onSale=1");
    box.innerHTML = deals.map((d) => `
      <article class="card" data-game="${d.gameID}">
        <img src="${d.thumb}" alt="" loading="lazy">
        <div class="card-body">
          <div class="card-title">${escapeHTML(d.title)}</div>
          <div class="store-name">${escapeHTML(storeName(d.storeID))}</div>
          <div class="card-meta">
            <span class="price">${money(d.salePrice)}</span>
            <span class="old-price">${money(d.normalPrice)}</span>
            <span class="badge">-%${Math.round(d.savings)}</span>
          </div>
        </div>
      </article>`).join("");
  } catch (e) {
    box.innerHTML = "<p class='status error'>Fırsatlar yüklenemedi. İnternet bağlantını kontrol et.</p>";
  }
}

// ---------- Arama ----------
async function search(title) {
  setStatus("Aranıyor…");
  show("results");
  $("#results").innerHTML = "";
  try {
    const games = await getJSON("/games?limit=24&title=" + encodeURIComponent(title));
    lastResults = games;
    if (games.length === 0) {
      setStatus(`"${title}" için sonuç bulunamadı.`);
      return;
    }
    setStatus(`${games.length} oyun bulundu. Fiyatları görmek için birine tıkla.`);
    $("#results").innerHTML = games.map((g) => `
      <article class="card" data-game="${g.gameID}">
        <img src="${g.thumb}" alt="" loading="lazy">
        <div class="card-body">
          <div class="card-title">${escapeHTML(g.external)}</div>
          <div class="card-meta">
            <span class="store-name">En ucuz:</span>
            <span class="price">${money(g.cheapest)}</span>
          </div>
        </div>
      </article>`).join("");
  } catch (e) {
    setStatus("Arama sırasında bir hata oluştu. Biraz sonra tekrar dene.", true);
  }
}

// ---------- Oyun detayı: mağaza mağaza fiyatlar ----------
async function showGame(gameID) {
  show("detail");
  const box = $("#detail");
  box.innerHTML = "<p class='status'>Fiyatlar yükleniyor…</p>";
  window.scrollTo({ top: $("#detail-section").offsetTop - 70, behavior: "smooth" });
  try {
    const data = await getJSON("/games?id=" + gameID);
    const deals = [...data.deals].sort((a, b) => a.price - b.price);
    const lowest = data.cheapestPriceEver;
    const lowestDate = lowest ? new Date(lowest.date * 1000).toLocaleDateString("tr-TR") : "-";

    box.innerHTML = `
      <div class="detail-head">
        <img src="${data.info.thumb}" alt="">
        <div>
          <h2>${escapeHTML(data.info.title)}</h2>
          <p>${deals.length} mağazada satılıyor · Tüm zamanların en düşük fiyatı:
             <strong>${lowest ? money(lowest.price) : "-"}</strong> (${lowestDate})</p>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Mağaza</th><th>Fiyat</th><th>Normal fiyat</th><th>İndirim</th><th></th></tr></thead>
        <tbody>
          ${deals.map((d, i) => `
            <tr class="${i === 0 ? "best" : ""}">
              <td><div class="store-cell">
                ${stores[d.storeID] ? `<img src="${stores[d.storeID].icon}" alt="">` : ""}
                ${escapeHTML(storeName(d.storeID))}${i === 0 ? " 🏆" : ""}
              </div></td>
              <td class="price">${money(d.price)}</td>
              <td class="old-price">${money(d.retailPrice)}</td>
              <td>${Number(d.savings) > 0 ? `<span class="badge">-%${Math.round(d.savings)}</span>` : "-"}</td>
              <td><a class="buy" href="${SITE}/redirect?dealID=${d.dealID}" target="_blank" rel="noopener">Mağazaya git</a></td>
            </tr>`).join("")}
        </tbody>
      </table></div>`;
  } catch (e) {
    box.innerHTML = "<p class='status error'>Oyun bilgisi alınamadı.</p>";
  }
}

// ---------- Olaylar ----------
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#search-input").value.trim();
  if (q) search(q);
});

// Kartlara tıklayınca detay aç (hem sonuçlar hem fırsatlar)
document.addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-game]");
  if (card) showGame(card.dataset.game);
});

$("#back-btn").addEventListener("click", () => {
  show(lastResults.length ? "results" : null);
});

// ---------- Başlat ----------
(async function init() {
  await loadStores();
  loadDeals();
})();
