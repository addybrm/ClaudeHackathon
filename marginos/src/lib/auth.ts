import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { query } from "@/lib/db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
export const SESSION_COOKIE = "mos_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { ...SCRYPT, N: Number(n) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string, businessId: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await query(`insert into sessions (token_hash, user_id, business_id, expires_at) values ($1,$2,$3,$4)`, [tokenHash(token), userId, businessId, expires.toISOString()]);
  await query(`update app_users set last_sign_in_at = now() where id = $1`, [userId]);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production" && process.env.MARGINOS_INSECURE_COOKIES !== "1", sameSite: "lax", path: "/", expires });
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await query(`delete from sessions where token_hash = $1`, [tokenHash(t)]);
  jar.delete(SESSION_COOKIE);
}

export interface SessionUser { id: string; email: string; name: string; businessId: string | null; tokenHash: string }

export async function currentUser(): Promise<SessionUser | null> {
  let t: string | undefined;
  try {
    t = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return null; // outside a request (tests, scripts)
  }
  if (!t) return null;
  const h = tokenHash(t);
  const rows = await query<{ id: string; email: string; name: string; business_id: string | null }>(
    `select u.id, u.email, u.name, s.business_id from sessions s join app_users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`,
    [h],
  );
  const r = rows[0];
  return r ? { id: r.id, email: r.email, name: r.name, businessId: r.business_id, tokenHash: h } : null;
}

export async function switchBusiness(user: SessionUser, businessId: string) {
  const ok = await query(`select 1 from memberships where user_id = $1 and business_id = $2`, [user.id, businessId]);
  if (!ok.length) throw new Error("You don't have access to that restaurant.");
  await query(`update sessions set business_id = $2 where token_hash = $1`, [user.tokenHash, businessId]);
}

export async function userBusinesses(userId: string) {
  return query<{ id: string; name: string; is_demo: boolean; role: string }>(
    `select b.id, b.name, b.is_demo, m.role from memberships m join businesses b on b.id = m.business_id where m.user_id = $1 order by b.is_demo, b.created_at`,
    [userId],
  );
}

// Simple in-memory sign-in throttle: 8 failed attempts per email+IP per 15 minutes.
const attempts = new Map<string, { n: number; until: number }>();
export function throttled(key: string) {
  const a = attempts.get(key);
  return !!a && a.n >= 8 && a.until > Date.now();
}
export function recordFailure(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + 15 * 60000 });
  else a.n++;
}
export function clearFailures(key: string) {
  attempts.delete(key);
}
