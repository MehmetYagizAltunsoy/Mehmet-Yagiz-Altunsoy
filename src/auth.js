import crypto from "node:crypto";
import { db } from "./db.js";

const scrypt = (pw, salt) => new Promise((ok, fail) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${(await scrypt(pw, salt)).toString("hex")}`;
}
export async function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(":");
  const k = await scrypt(pw, Buffer.from(salt, "hex"));
  return crypto.timingSafeEqual(k, Buffer.from(hash, "hex"));
}

const DAYS = 30;
export const SESSION_MAX_AGE = DAYS * 86400;

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))")
    .run(token, userId, `+${DAYS} days`);
  return token;
}
export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
export function cleanupSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  db.prepare("DELETE FROM email_tokens WHERE expires_at <= datetime('now')").run();
}
export function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

const qSession = db.prepare(`SELECT u.id, u.email, u.name, u.country, u.lang, u.notify_drops, u.min_cut, u.email_verified, u.avatar
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ? AND s.expires_at > datetime('now')`);

export function attachUser(req, _res, next) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || "");
  req.sid = m ? m[1] : null;
  const u = req.sid ? qSession.get(req.sid) : null;
  req.user = u ? { ...u } : null;
  next();
}
export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ code: "login" });
  next();
}

// E-posta doğrulama ve şifre sıfırlama bağlantıları: veri tabanında sadece özeti tutulur
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
export function createEmailToken(userId, kind, hours) {
  const raw = crypto.randomBytes(32).toString("hex");
  db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND kind = ?").run(userId, kind);
  db.prepare("INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, datetime('now', ?))")
    .run(sha(raw), userId, kind, `+${hours} hours`);
  return raw;
}
export function consumeEmailToken(raw, kind) {
  if (!/^[a-f0-9]{64}$/.test(String(raw))) return null;
  const row = db.prepare("SELECT user_id FROM email_tokens WHERE token_hash = ? AND kind = ? AND expires_at > datetime('now')").get(sha(raw), kind);
  db.prepare("DELETE FROM email_tokens WHERE token_hash = ?").run(sha(raw));
  return row?.user_id ?? null;
}
export function destroyUserSessions(userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// Kaba kuvvet denemelerine karşı: 15 dakikada en fazla 10 deneme
const attempts = new Map();
export function tooManyAttempts(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60_000);
  list.push(now);
  attempts.set(key, list);
  return list.length > 10;
}
