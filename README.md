# Fiyatavı

PC oyunlarının fiyatlarını Steam, Epic Games Store, GOG, Microsoft Store ve diğer yetkili mağazalar arasında karşılaştıran web sitesi. Bir oyunun nerede en ucuz olduğunu gösterir, istek listesindeki oyunların fiyatı düşünce kullanıcıya mail atar.

## Özellikler

- 10 bölgenin gerçek mağaza fiyatları (USD, EUR, GBP, JPY, BRL, CAD, AUD, MXN, CHF, TRY)
- Steam'deki neredeyse tüm oyunlar + en popüler 1000 oyun; listede olmayan oyunlar aramayla eklenir
- Popüler oyunlarda indirimler ve indirimin bitiş tarihi, "Çok satanlar" vitrini ve fragmanlı "Günün oyunu" bandı
- Kategoriler (aksiyon, macera, bulmaca…), mağaza filtresi, sadece indirimdekiler
- Steam oyuncu puanları; çok satan, en çok favorilenen ve en yüksek puanlı sıralamaları
- Seçilen bölgede fiyatı olmayan oyunlarda diğer bölgelerin fiyatları
- Yapay zekâ ile oyun bulma: adını bilmediğin oyunu anlat, bulsun (Ollama)
- "Şu an ücretsiz" oyunlar, benzer oyun önerileri, güncel kurla yaklaşık fiyat karşılıkları

Yol haritası için: [YAPILACAKLAR.md](YAPILACAKLAR.md)
- Son 3 ayın fiyat grafiği, 3 ayın ve tüm zamanların en düşük fiyatı
- Arama, A–Z filtresi, sıralama (popüler, ucuzdan pahalıya, en yüksek indirim, en yeni…)
- Üyelik sistemi (e-posta doğrulama, şifremi unuttum), istek listesi, istek listesine eklemede ve fiyat düşüşünde mail bildirimi
- Hedef fiyat alarmı ("bu oyun X TL'ye inince haber ver") ve "tüm zamanların en düşüğü" rozeti
- Oyun sayfasında Steam'den sistem gereksinimleri
- KVKK aydınlatma metni, gizlilik politikası ve çerez bilgilendirmesi (taslak; yayına almadan önce hukukçuya kontrol ettirilmeli)
- Açılmayan (erişim engelli) mağazaları otomatik tespit edip gizleme
- Türkçe / İngilizce, koyu / açık mod, mobil uyumlu tasarım
- Ayarlar ve Yardım sayfaları, ilk girişte karşılama ekranı

Oyun adları hiçbir dilde çevrilmez, her zaman orijinal hâliyle gösterilir.

## Kullanılan teknolojiler

| Bölüm | Teknoloji |
|---|---|
| Sunucu | [Node.js](https://nodejs.org) 22.13+ ve [Express](https://expressjs.com) |
| Veri tabanı | SQLite (Node'un yerleşik `node:sqlite` modülü) |
| Mail | [Nodemailer](https://nodemailer.com) (SMTP) |
| Ayarlar | [dotenv](https://github.com/motdotla/dotenv) |
| Arayüz | Saf HTML, CSS ve JavaScript (çerçeve yok), tek dosya: `public/index.html` |
| Yazı tipleri | Chakra Petch ve Rubik (Google Fonts) |
| Şifreleme | scrypt (Node `crypto`), HttpOnly oturum çerezi |
| Fiyat verisi | [IsThereAnyDeal API](https://docs.isthereanydeal.com/) |
| Oyun listesi, kapaklar, puanlar, fragmanlar | [Steam Web API](https://steamcommunity.com/dev) ve Steam mağazası |
| Kategoriler ve tahmini satışlar | [SteamSpy](https://steamspy.com/api.php) |
| Yapay zekâ | [Ollama](https://ollama.com) (bilgisayarda çalışan yerel model) |

## Kurulum

1. [Node.js](https://nodejs.org) (LTS sürümü) kur.
2. [IsThereAnyDeal](https://isthereanydeal.com/apps/my/) üzerinden ücretsiz bir API anahtarı al.
3. İsteğe bağlı: Steam'deki tüm oyunlar için [Steam Web API anahtarı](https://steamcommunity.com/dev/apikey) al.
4. Proje klasöründe:

```bash
npm install
npm run kurulum   # anahtarları ve site bilgilerini sorar, .env dosyasını oluşturur
npm start         # http://localhost:3000
```

### Yapay zekâ (isteğe bağlı)

1. [Ollama](https://ollama.com)'yı kur.
2. `ollama pull gemma3:4b` (yaklaşık 3 GB; başka model için `npm run kurulum`).
3. `npm start` — Ollama açıksa arama çubuğunda "Yapay zekâyla bul" düğmesi görünür.

Yapay zekânın önerdiği oyunlar yalnızca gerçekten bulunabiliyorsa gösterilir; uydurulan adlar elenir.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm start` | Siteyi başlatır, fiyatları düzenli olarak günceller |
| `npm run kurulum` | API anahtarlarını ve site ayarlarını girer / değiştirir |
| `npm run kontrol` | Kaç oyunun fiyatı olduğunu, mağazaları ve gizlenen mağazaları gösterir |
| `npm run sync` | Fiyatları elle bir kez günceller |

## Ayarlar (`.env`)

Gizli bilgiler `.env` dosyasında durur ve GitHub'a yüklenmez (`.gitignore`). Örnek için `.env.example` dosyasına bak.

| Ayar | Açıklama |
|---|---|
| `ITAD_API_KEY` | IsThereAnyDeal API anahtarı (zorunlu) |
| `STEAM_API_KEY` | Steam Web API anahtarı (isteğe bağlı) |
| `ITAD_RATE_LIMIT` | IsThereAnyDeal'ın 5 dakikalık istek limiti |
| `CATALOG_SIZE` | Sitedeki popüler oyun sayısı (en fazla 1000) |
| `SYNC_MINUTES` / `TAIL_REFRESH_HOURS` | Popüler / diğer oyunların fiyat güncelleme sıklığı |
| `SITE_NAME`, `SITE_URL` | Site adı ve adresi (maillerde kullanılır) |
| `SUPPORT_EMAIL`, `SUPPORT_INSTAGRAM` | Yardım sayfasındaki iletişim bilgileri |
| `CONTROLLER_NAME` | KVKK metinlerindeki veri sorumlusu |
| `SMTP_*`, `MAIL_FROM` | Mail gönderimi (boşsa mailler terminale yazılır) |
| `SHOPS_HIDE` | Sitede gösterilmeyecek mağazalar (virgülle) |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Yapay zekâ için Ollama adresi ve modeli |

## Proje yapısı

```
fiyatavi/
├── public/index.html   Arayüz (HTML + CSS + JavaScript)
├── src/
│   ├── server.js       Sunucu ve API uç noktaları
│   ├── sync.js         Oyun, fiyat, geçmiş ve kapak güncellemeleri
│   ├── itad.js         IsThereAnyDeal API istemcisi (istek limiti dahil)
│   ├── steam.js        Steam oyun listesi
│   ├── shops.js        Mağaza erişim kontrolü
│   ├── steamspy.js     Kategoriler ve tahmini satışlar
│   ├── steamstore.js   Steam puanları ve fragmanlar
│   ├── ai.js           Yapay zekâ (Ollama) ile oyun bulma
│   ├── rates.js        Güncel döviz kurları
│   ├── db.js           Veri tabanı şeması
│   ├── auth.js         Giriş sistemi ve oturumlar
│   ├── notify.js       İstek listesi ve fiyat düşüş bildirimleri
│   ├── mailer.js       Mail gönderimi
│   ├── accountmail.js  E-posta doğrulama ve şifre sıfırlama mailleri
│   ├── setup.js        Kurulum sihirbazı
│   └── kontrol.js      Durum raporu
├── games.json          Sitede her zaman bulunacak oyunlar
└── .env.example        Örnek ayar dosyası
```

## Veri kaynakları

Fiyat, oyun bilgisi, kapak, puan ve fragman verileri [IsThereAnyDeal](https://isthereanydeal.com), Steam ve [SteamSpy](https://steamspy.com) üzerinden alınır. Oyun adları, kapak görselleri ve markalar sahiplerine aittir. Bu proje Valve, IsThereAnyDeal veya adı geçen mağazalarla bağlantılı değildir.
