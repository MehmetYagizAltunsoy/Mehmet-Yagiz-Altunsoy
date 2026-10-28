#!/usr/bin/env bash
# Sunucudaki siteyi GitHub'daki son sürüme günceller.  Kullanım:  bash /opt/fiyatavi/deploy/guncelle.sh
set -euo pipefail
cd /opt/fiyatavi
sudo -u fiyatavi git pull --ff-only
sudo -u fiyatavi npm install --omit=dev --no-audit --no-fund
sudo cp deploy/fiyatavi.service /etc/systemd/system/fiyatavi.service && sudo systemctl daemon-reload
sudo systemctl restart fiyatavi
sleep 3 && curl -fsS http://127.0.0.1:3000/api/health && echo "  → site çalışıyor"
