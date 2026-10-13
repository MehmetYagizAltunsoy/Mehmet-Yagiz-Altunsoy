# Fiyatavı — Yapılacaklar

Bu liste projenin yol haritasıdır. Bir madde bittiğinde `[ ]` işaretini `[x]` yap.

## Bitenler (5 Ekim 2026)

- [x] **Canlı döviz kuru:** Fiyat karşılaştırmasında sabit yaklaşık kurlar yerine her gün güncel kur kullanılıyor.
- [x] **Fiyatların yaklaşık karşılığı:** Seçilen para biriminden farklı listelenen fiyatların yanında yaklaşık karşılığı gösteriliyor (ör. Steam Türkiye'nin dolar fiyatlarının yanında "≈ 1.263 ₺").
- [x] **"Şu an ücretsiz" bölümü:** Normalde ücretli olup kısa süreliğine bedava verilen oyunlar ana sayfada ayrı bir bölümde.
- [x] **Benzer oyunlar:** Oyun sayfasının altında, ortak etiketlerine göre benzer oyunlar öneriliyor.

## Bitenler (12 Ekim 2026)

- [x] **Çevrimiçi / çevrimdışı filtresi:** Oyunlar Steam etiketlerine göre çevrimiçi (çok oyunculu, co-op, PvP, MMO) ve çevrimdışı (tek oyunculu) olarak filtrelenebiliyor.
- [x] **Profil sayfası:** Hesap işlemleri ayarlardan ayrıldı; üst çubukta profil resmi, oyun kapaklarından profil resmi seçme, şifre değiştirme, bildirim tercihleri.
- [x] **Ayarlar yeniden düzenlendi:** Sadece site tercihleri; açıklamalı satırlar, aç/kapa anahtarları, tercihleri sıfırlama.

## Sıradakiler

### Düzeltme ve sağlamlaştırma
- [ ] **Hız ölçümü ve önbellek** (orta): 190 bin oyunla yavaşlayan sorguları ölçüp hızlandırmak.
- [ ] **Otomatik testler** (orta): `npm test` ile çalışan kalıcı testler.

### Kullanıcıya değer katacaklar
- [ ] **Yapay zekâ ile oyun bulma** (orta): Kodu hazır ama henüz devrede değil. Ollama kurulup bir model indirilecek, gerçek oyun tarifleriyle denenip Türkçe cevap kalitesi ölçülecek, gerekirse model ya da komut metni değiştirilecek. Kurulana kadar "Yapay zekâyla bul" düğmesi sitede görünmüyor.
- [ ] **Grafikte süre seçimi** (kolay): Fiyat grafiğine "3 ay / 1 yıl / tümü" seçenekleri.
- [ ] **Paylaşılabilir oyun bağlantıları** (orta): Her oyuna kendi adresi (ör. `/oyun/elden-ring`).
- [ ] **Abonelik bilgisi** (orta): "PC Game Pass'te var" gibi bilgiler.
- [ ] **Steam istek listesini içe aktarma** (orta).

### Sitenin büyümesi için
- [ ] **Arama motorlarında görünme / SEO** (büyük): Paylaşılabilir bağlantılarla birlikte yapılmalı.
- [ ] **Telefona uygulama gibi yükleme (PWA) ve anlık bildirim** (orta).
- [ ] **Daha şık, görselli bildirim mailleri** (kolay).

### Yayına alma
- [ ] **Yayın hazırlığı:** Sunucu ve alan adı, HTTPS, üretim ayarları, sunucu çökerse kendiliğinden yeniden başlama.
- [ ] **Otomatik veri tabanı yedeği.**
- [ ] **Kullanım koşulları kontrolü:** IsThereAnyDeal, Steam ve SteamSpy verilerinin kullanım şartları.
- [ ] **KVKK:** Veri sorumlusu bilgisi, yurt dışına aktarım, hukukçu kontrolü.
