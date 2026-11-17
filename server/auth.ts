// Password hashing + session cookies for league-ify's accounts.
//
// Ported from the dhole.dev site's lib/auth.js (its single-admin auth), keeping
// the parts that are account-agnostic: PBKDF2-SHA256 hashing, constant-time
// compare, and secure cookies, all on WebCrypto so the same code runs in workerd
// and in Node 18+. What's dropped: the stateless HMAC token and the env-based
// single operator. Sessions here are DB rows (see lu_sessions) keyed by an
// opaque random id — this file just mints and reads that id in a cookie.

const PBKDF2_PREFIX = "pbkdf2-sha256";
const PBKDF2_HASH = "SHA-256";
// workerd rejects PBKDF2 above 100000 iterations; it is the ceiling, not a
// preference. The count is embedded in each hash so it can change later without
// invalidating existing hashes.
const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export const MIN_PASSWORD_LENGTH = 8;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// __Host- forces Secure + Path=/ + no Domain, so no sibling host can plant a
// look-alike cookie. A browser drops a __Host- cookie that is not Secure, which
// breaks plain-http local dev — so over http we fall back to an ordinary name.
const SECURE_COOKIE = "__Host-lu_session";
const DEV_COOKIE = "lu_session";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(str: string): Uint8Array | null {
  if (typeof str !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return null;
  try {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function toB64url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** Constant-time compare; never returns early. */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const span = Math.max(a.length, b.length, 1);
  const an = a.length || 1;
  const bn = b.length || 1;
  for (let i = 0; i < span; i++) diff |= (a[i % an] ?? 0) ^ (b[i % bn] ?? 0);
  return diff === 0;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: PBKDF2_HASH }, key, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

/** Self-describing hash: "pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>". */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.normalize("NFC").length < MIN_PASSWORD_LENGTH) {
    throw new TypeError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/** Never throws; any malformed input is simply "not a match". */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (typeof password !== "string" || typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 4) return false;
    const [prefix, iterationsRaw, saltB64, hashB64] = parts;
    if (prefix !== PBKDF2_PREFIX) return false;
    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
    const salt = fromB64(saltB64);
    if (!salt || salt.length !== SALT_BYTES) return false;
    const expected = fromB64(hashB64);
    if (!expected || expected.length !== KEY_BYTES) return false;
    const actual = await deriveBits(password, salt, iterations);
    return safeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** An opaque 32-byte session id, base64url. Unguessable; validated by DB lookup. */
export function newSessionId(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** First 16 hex of sha256(userAgent); diagnostics only, no PII stored raw. */
export async function hashUserAgent(ua: string | null | undefined): Promise<string> {
  if (!ua) return "";
  const digest = await crypto.subtle.digest("SHA-256", utf8(ua));
  return toHex(new Uint8Array(digest)).slice(0, 16);
}

// --- cookies ---------------------------------------------------------------

export function sessionCookie(id: string, secure: boolean, maxAge = SESSION_TTL_SECONDS): string {
  const name = secure ? SECURE_COOKIE : DEV_COOKIE;
  const sec = secure ? "; Secure" : "";
  return `${name}=${id}; HttpOnly${sec}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(secure: boolean): string {
  const name = secure ? SECURE_COOKIE : DEV_COOKIE;
  const sec = secure ? "; Secure" : "";
  return `${name}=; HttpOnly${sec}; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Reads whichever session cookie is present (secure or dev name). */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const found: Record<string, string> = {};
  for (const part of header.split(";")) {
    const raw = part.trim();
    const eq = raw.indexOf("=");
    if (eq < 1) continue;
    found[raw.slice(0, eq)] = raw.slice(eq + 1);
  }
  return found[SECURE_COOKIE] ?? found[DEV_COOKIE] ?? null;
}

export function requestIsSecure(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
