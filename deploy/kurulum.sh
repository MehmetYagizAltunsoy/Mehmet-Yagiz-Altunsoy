#!/usr/bin/env bash
# Fiyatavı sunucu kurulumu (Ubuntu 22.04 / 24.04, Oracle Cloud Always Free dahil).
# Kullanım (sunucuda):  bash kurulum.sh fiyatavi.duckdns.org
# Yaptıkları: Node.js 22, git ve Caddy'yi kurar; projeyi GitHub'dan indirir; siteyi her açılışta
# kendiliğinden başlayan bir servis yapar; Caddy ile HTTPS (ücretsiz sertifika) ayarlar.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

ALAN="${1:-}"
REPO="https://github.com/MehmetYagizAltunsoy/mehmet-yagiz-altunsoy.git"
DIZIN="/opt/fiyatavi"
KULLANICI="fiyatavi"

if [ -z "$ALAN" ]; then
  echo "Alan adını yaz:  bash kurulum.sh fiyatavi.duckdns.org"; exit 1
fi

echo "==> 1/6 Paketler"
sudo apt-get update -q
sudo -E apt-get install -y -q git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

echo "==> 2/6 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -q nodejs
fi
node -v

echo "==> 3/6 Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -q && sudo apt-get install -y -q caddy
fi

echo "==> 4/6 Proje"
id -u "$KULLANICI" >/dev/null 2>&1 || sudo useradd --system --create-home --home-dir "$DIZIN" --shell /usr/sbin/nologin "$KULLANICI"
if [ -d "$DIZIN/.git" ]; then
  sudo -u "$KULLANICI" git -C "$DIZIN" pull --ff-only
else
  sudo rm -rf "$DIZIN.tmp" && sudo git clone "$REPO" "$DIZIN.tmp"
  sudo cp -a "$DIZIN.tmp/." "$DIZIN/" && sudo rm -rf "$DIZIN.tmp"
  sudo chown -R "$KULLANICI:$KULLANICI" "$DIZIN"
fi
cd "$DIZIN"
sudo -u "$KULLANICI" npm install --omit=dev --no-audit --no-fund
if [ ! -f "$DIZIN/.env" ]; then
  sudo -u "$KULLANICI" cp .env.example .env
  sudo sed -i "s|^SITE_URL=.*|SITE_URL=https://$ALAN|" .env
  grep -q '^NODE_ENV=' .env || echo "NODE_ENV=production" | sudo tee -a .env >/dev/null
  sudo chmod 600 .env
  echo "   .env oluşturuldu: anahtarları ve mail ayarlarını doldurman gerekiyor (rehberde 5. adım)."
fi

echo "==> 5/6 Servis (site her açılışta kendiliğinden başlar, çökerse yeniden başlar)"
sudo cp deploy/fiyatavi.service /etc/systemd/system/fiyatavi.service
sudo systemctl daemon-reload
sudo systemctl enable fiyatavi

echo "==> 6/6 HTTPS ve güvenlik duvarı"
sed "s|ALAN_ADI|$ALAN|" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
# Oracle'ın Ubuntu kalıbı 80 ve 443'ü varsayılan olarak kapatır; açıp kalıcı yap
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport "$p" -j ACCEPT
done
sudo netfilter-persistent save >/dev/null 2>&1 || true
sudo systemctl reload caddy || sudo systemctl restart caddy

echo
echo "Kurulum bitti."
echo "Sıradaki: sudo nano $DIZIN/.env  →  anahtarları doldur  →  sudo systemctl start fiyatavi"
echo "Durum:    sudo systemctl status fiyatavi    Kayıtlar: sudo journalctl -u fiyatavi -f"
