// Testler için ortak hazırlık: her test dosyası kendi geçici veri tabanını kullanır,
// gerçek ganimet.db dosyasına dokunulmaz ve hiçbir test gerçek e-posta göndermez.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function geciciVeriTabani(ad) {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), "fiyatavi-test-"));
  process.env.DB_PATH = path.join(klasor, `${ad}.db`);
  delete process.env.SMTP_HOST;          // mail gönderilmesin, sadece kaydedilsin
  return klasor;
}
