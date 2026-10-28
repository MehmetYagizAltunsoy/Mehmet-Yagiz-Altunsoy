# Fiyatavı'yı yayına alma

Bu rehber siteyi ücretsiz ve 7/24 açık bir sunucuda yayınlamayı anlatır:

- **Sunucu:** Oracle Cloud "Always Free". Ücretsiz bir Linux bilgisayar.
- **Adres:** DuckDNS ile ücretsiz bir alan adı, örneğin `fiyatavi.duckdns.org`.
- **HTTPS:** Caddy kilit simgeli bağlantıyı kendisi ayarlar.

Site çalışırken veri tabanını her gün `yedek/` klasörüne yedekler ve son 7 günü tutar.

## 1. Oracle Cloud hesabı

1. https://www.oracle.com/cloud/free/ → **Start for free**.
2. **Home region** olarak **Germany Central (Frankfurt)** ya da **Netherlands Northwest (Amsterdam)** seç. Türkiye'ye yakın bölgeler bunlar. Bölge sonradan değiştirilemez.
3. Kart bilgisi istenir. Bu sadece kimlik doğrulaması içindir, ücretsiz kaynaklardan para alınmaz.

> İpucu: Hesap açıldıktan sonra **Upgrade to Pay As You Go** yapılabilir. Always Free kaynaklar yine ücretsiz kalır, ama Oracle boşta duran makineyi kapatmaz. Bunu yaparsan **Budgets** bölümünden 1 $'lık bir bütçe uyarısı da kur. Böylece yanlışlıkla ücretli bir şey açarsan haberin olur.

## 2. Sunucuyu oluştur

1. Menüden **Compute → Instances → Create instance**.
2. **Image:** Canonical Ubuntu 24.04.
3. **Shape:** Ampere (VM.Standard.A1.Flex), 2 OCPU ve 12 GB bellek. Bu fazlasıyla yeter.
   - "Out of capacity" hatası alırsan birkaç saat sonra tekrar dene.
   - Ya da AMD **VM.Standard.E2.1.Micro** seç. O da ücretsiz ama daha yavaş.
4. **Add SSH keys → Generate a key pair for me**. İki dosyayı da indir ve sakla. Sunucuya bu anahtarla bağlanacaksın.
5. **Create**. Sunucu açılınca sayfadaki **Public IP address** değerini not et.
6. Aynı sayfada **Subnet**'e tıkla, sonra **Security Lists → Default Security List → Add Ingress Rules**:
   - Source CIDR: `0.0.0.0/0`
   - Destination port: `80,443`

## 3. Ücretsiz alan adı (DuckDNS)

1. https://www.duckdns.org → GitHub hesabınla giriş yap.
2. Bir ad seç, örneğin `fiyatavi`. **current ip** kutusuna Oracle'daki Public IP'yi yaz ve **update ip**'ye bas.
3. Artık adresin `fiyatavi.duckdns.org`.

İleride `fiyatavi.com` gibi gerçek bir alan adı alırsan sadece DNS kaydını değiştirip kurulumu o adla tekrar çalıştırman yeterli.

## 4. Sunucuya bağlan ve kur

Windows'ta PowerShell aç. İndirdiğin anahtar dosyasının yolunu ve IP'yi kendine göre değiştir:

```
ssh -i C:\Users\SENIN_ADIN\Downloads\ssh-key.key ubuntu@PUBLIC_IP
```

Sunucuya bağlanınca:

```
curl -fsSLO https://raw.githubusercontent.com/MehmetYagizAltunsoy/mehmet-yagiz-altunsoy/main/deploy/kurulum.sh
bash kurulum.sh fiyatavi.duckdns.org
```

Kurulum 3–5 dakika sürer. Node.js, Caddy ve projeyi kurar.

## 5. Ayarları doldur

```
sudo nano /opt/fiyatavi/.env
```

Doldurulacak satırlar:

| Satır | Ne yazılacak |
|---|---|
| `ITAD_API_KEY` | IsThereAnyDeal anahtarın |
| `STEAM_API_KEY` | Steam anahtarın. Anahtar sayfasında alan adı olarak `fiyatavi.duckdns.org` yaz |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Gmail ayarları. Sunucu için **yeni** bir uygulama şifresi al |
| `SUPPORT_EMAIL` | Sitede görünecek iletişim adresi |
| `CONTROLLER_NAME` | KVKK metnindeki veri sorumlusu, yani kendi adın soyadın |
| `ADMIN_EMAILS` | Yönetim sekmesini görecek e-posta (seninki) |
| `SITE_URL`, `NODE_ENV` | Kurulum bunları kendisi yazdı, dokunma |

Kaydetmek için `Ctrl+O`, Enter, sonra çıkmak için `Ctrl+X`.

Siteyi başlat:

```
sudo systemctl start fiyatavi
sudo journalctl -u fiyatavi -f        # kayıtları canlı izle, çıkmak için Ctrl+C
```

Tarayıcıda `https://fiyatavi.duckdns.org` adresini aç. İlk açılışta oyun listesi ve fiyatlar birkaç dakikada dolar.

> Bilgisayarındaki veri tabanını taşımak istersen (hesaplar ve fiyat geçmişi), siteyi durdurup `ganimet.db` dosyasını kopyala:
> `sudo systemctl stop fiyatavi`, sonra kendi bilgisayarından
> `scp -i ANAHTAR ganimet.db ubuntu@PUBLIC_IP:/tmp/`, sonra sunucuda
> `sudo mv /tmp/ganimet.db /opt/fiyatavi/ && sudo chown fiyatavi: /opt/fiyatavi/ganimet.db && sudo systemctl start fiyatavi`

## Güncelleme

GitHub'a yeni sürüm yükledikten sonra sunucuda şunu çalıştır:

```
bash /opt/fiyatavi/deploy/guncelle.sh
```

## Sık kullanılan komutlar

| Ne | Komut |
|---|---|
| Durum | `sudo systemctl status fiyatavi` |
| Yeniden başlat | `sudo systemctl restart fiyatavi` |
| Kayıtlar | `sudo journalctl -u fiyatavi -n 100` |
| Yedekler | `ls /opt/fiyatavi/yedek` |
| Sağlık kontrolü | `curl https://fiyatavi.duckdns.org/api/health` |
