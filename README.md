# Fiyatavı

Türk oyuncular için PC oyun fiyat karşılaştırma sitesi. Steam, Epic Games Store, GOG, Microsoft Store ve diğer yetkili mağazalardaki fiyatları TL olarak karşılaştırır; bir oyunun nerede en ucuz olduğunu gösterir, istek listesindeki oyunların fiyatı düşünce kullanıcıya mail atar. Fiyatlar Türkiye mağazalarından TL olarak gösterilir; arayüz Türkçe açılır, İngilizce de seçilebilir.

## Özellikler

- Türkiye mağazalarının gerçek fiyatları (TL)
- Steam'deki neredeyse tüm oyunlar + en popüler 1000 oyun; listede olmayan oyunlar aramayla eklenir
- Popüler oyunlarda indirimler ve indirimin bitiş tarihi, "Çok satanlar" vitrini ve fragmanlı "Günün oyunu" bandı
- Kategoriler (aksiyon, macera, bulmaca…), mağaza filtresi, sadece indirimdekiler
- Steam oyuncu puanları; çok satan, en çok favorilenen ve en yüksek puanlı sıralamaları
- Her oyunun paylaşılabilir adresi (ör. `/oyun/elden-ring`) ve "Linki kopyala" düğmesi
- "Şu an ücretsiz" oyunlar, benzer oyun önerileri, güncel kurla yaklaşık fiyat karşılıkları
- Fiyat geçmişi grafiği (3 ay / 6 ay / 1 yıl / tümü), dönemin ve tüm zamanların en düşük fiyatı
- "Şimdi al mı, bekle mi?" önerisi: fiyat geçmişine bakarak almak için iyi zaman olup olmadığını söyler
- En fazla 3 oyunu yan yana karşılaştırma (fiyat, en düşük fiyat, puan, öneri)
- Ana sayfada "Bu hafta biten indirimler" (geri sayımlı)
- Arama, A–Z filtresi, sıralama (popüler, ucuzdan pahalıya, en yüksek indirim, en yeni…)
- Üyelik sistemi (e-posta doğrulama, şifremi unuttum), istek listesi, istek listesine eklemede ve fiyat düşüşünde mail bildirimi
- Tasarımlı HTML mailler ve haftalık özet maili (istek listesindeki oyunların haftalık fiyat durumu)
- Yönetim sekmesi: kullanıcı, oyun, mail ve sistem istatistikleri (sadece yöneticiler görür)
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

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm start` | Siteyi başlatır, fiyatları düzenli olarak günceller |
| `npm run kurulum` | API anahtarlarını ve site ayarlarını girer / değiştirir |
| `npm run kontrol` | Kaç oyunun fiyatı olduğunu, mağazaları ve gizlenen mağazaları gösterir |
| `npm run sync` | Fiyatları elle bir kez günceller |
| `npm test` | Otomatik testleri çalıştırır (güvenlik, fiyat bildirimleri, haftalık özet, veri tabanı şeması) |
| `npm run mailtest` | Mail ayarlarını dener, kendine örnek bir mail gönderir |

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
| `ADMIN_EMAILS` | Yönetim sekmesini görebilecek e-postalar (virgülle; boşsa `SUPPORT_EMAIL`) |

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
│   ├── rates.js        Güncel döviz kurları
│   ├── db.js           Veri tabanı şeması
│   ├── auth.js         Giriş sistemi ve oturumlar
│   ├── notify.js       İstek listesi ve fiyat düşüş bildirimleri
│   ├── mailer.js       Mail gönderimi
│   ├── accountmail.js  E-posta doğrulama ve şifre sıfırlama mailleri
│   ├── mailtemplate.js HTML mail şablonu
│   ├── mailtest.js     Mail ayarı denemesi
│   ├── setup.js        Kurulum sihirbazı
│   └── kontrol.js      Durum raporu
├── test/               Otomatik testler (npm test)
├── veritabani/         ER diyagramına uygun SQL şeması (fiyatavi.sql) ve şema görseli
├── games.json          Sitede her zaman bulunacak oyunlar
└── .env.example        Örnek ayar dosyası
```

## Veri kaynakları

Fiyat, oyun bilgisi, kapak, puan ve fragman verileri [IsThereAnyDeal](https://isthereanydeal.com), Steam ve [SteamSpy](https://steamspy.com) üzerinden alınır. Oyun adları, kapak görselleri ve markalar sahiplerine aittir. Bu proje Valve, IsThereAnyDeal veya adı geçen mağazalarla bağlantılı değildir.

## Yayına alma

Siteyi ücretsiz bir sunucuda (Oracle Cloud Always Free) HTTPS ile yayınlamak için adım adım rehber: [YAYINLAMA.md](YAYINLAMA.md). Kurulum ve güncelleme betikleri `deploy/` klasöründe.
