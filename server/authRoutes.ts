// Account endpoints: signup, login, logout, and session resolution. These talk
// to D1 directly (the lu_users / lu_sessions tables), not through the document
// store, so they run before the per-user tenant is installed. The Worker
// (server/worker.ts) dispatches /api/auth/* here and turns an AuthResult into a
// Response, attaching any Set-Cookie.

import {
  hashPassword,
  verifyPassword,
  newSessionId,
  hashUserAgent,
  sessionCookie,
  clearSessionCookie,
  SESSION_TTL_SECONDS,
  MIN_PASSWORD_LENGTH,
} from "./auth.ts";
import type { D1Database } from "./storage/d1Store.ts";
import type { CurrentUser } from "./userContext.ts";

export interface AuthResult {
  status: number;
  body: unknown;
  setCookie?: string;
}

interface AuthOpts {
  ua: string | null;
  secure: boolean;
}

const now = () => Math.floor(Date.now() / 1000);

// Failed-login throttle (per account; IP throttling alone is evadable).
const MAX_FAILED = 8;
const LOCK_SECONDS = 15 * 60;
const LOGIN_MIN_MS = 250;

const PLATFORMS = new Set([
  "na1", "euw1", "eun1", "kr", "br1", "la1", "la2", "oc1", "tr1", "ru", "jp1", "ph2", "sg2", "th2", "tw2", "vn2",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length >= 3 && e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

function cleanRiot(body: any): { gameName: string; tagLine: string; platform: string } | null {
  const gameName = typeof body?.riotGameName === "string" ? body.riotGameName.trim() : "";
  const tagLine = typeof body?.riotTagLine === "string" ? body.riotTagLine.trim().replace(/^#/, "") : "";
  const platform = typeof body?.platform === "string" ? body.platform.trim().toLowerCase() : "";
  if (gameName.length < 1 || gameName.length > 32) return null;
  if (tagLine.length < 2 || tagLine.length > 8) return null;
  if (!PLATFORMS.has(platform)) return null;
  return { gameName, tagLine, platform };
}

function userView(row: {
  id: number; email: string; display_name: string;
  riot_game_name: string | null; riot_tag_line: string | null; riot_platform: string | null;
}): CurrentUser {
  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    gameName: row.riot_game_name,
    tagLine: row.riot_tag_line,
    platform: row.riot_platform,
  };
}

async function createSession(db: D1Database, userId: number, ua: string | null): Promise<string> {
  const id = newSessionId();
  const t = now();
  await db
    .prepare(
      `INSERT INTO lu_sessions (id, user_id, created_at, expires_at, last_seen_at, ua_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, userId, t, t + SESSION_TTL_SECONDS, t, await hashUserAgent(ua))
    .run();
  return id;
}

export async function signup(db: D1Database, body: any, opts: AuthOpts): Promise<AuthResult> {
  const email = cleanEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const riot = cleanRiot(body);

  if (!email) return { status: 400, body: { error: "A valid email is required." } };
  if (password.normalize("NFC").length < MIN_PASSWORD_LENGTH)
    return { status: 400, body: { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` } };
  if (!riot)
    return { status: 400, body: { error: "A valid Riot ID (game name, tag, and region) is required." } };

  const existing = await db.prepare("SELECT id FROM lu_users WHERE email = ?").bind(email).first<{ id: number }>();
  if (existing) return { status: 409, body: { error: "An account with that email already exists." } };

  const hash = await hashPassword(password);
  const t = now();
  const row = await db
    .prepare(
      `INSERT INTO lu_users
         (email, password_hash, display_name, riot_game_name, riot_tag_line, riot_platform, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, email, display_name, riot_game_name, riot_tag_line, riot_platform`
    )
    .bind(email, hash, riot.gameName, riot.gameName, riot.tagLine, riot.platform, t, t)
    .first<{
      id: number; email: string; display_name: string;
      riot_game_name: string | null; riot_tag_line: string | null; riot_platform: string | null;
    }>();

  if (!row) return { status: 500, body: { error: "Could not create the account." } };

  const sessionId = await createSession(db, row.id, opts.ua);
  return {
    status: 201,
    body: { user: userView(row) },
    setCookie: sessionCookie(sessionId, opts.secure),
  };
}

export async function login(db: D1Database, body: any, opts: AuthOpts): Promise<AuthResult> {
  const started = Date.now();
  const pad = async (r: AuthResult): Promise<AuthResult> => {
    const remaining = LOGIN_MIN_MS - (Date.now() - started);
    if (remaining > 0) await new Promise((res) => setTimeout(res, remaining));
    return r;
  };

  const email = cleanEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";

  const row = email
    ? await db
        .prepare(
          `SELECT id, email, password_hash, display_name, active, failed_attempts, locked_until,
                  riot_game_name, riot_tag_line, riot_platform
           FROM lu_users WHERE email = ?`
        )
        .bind(email)
        .first<{
          id: number; email: string; password_hash: string; display_name: string;
          active: number; failed_attempts: number; locked_until: number;
          riot_game_name: string | null; riot_tag_line: string | null; riot_platform: string | null;
        }>()
    : null;

  // Run the hash even when there is no user, so response time cannot enumerate
  // emails. A placeholder hash keeps the PBKDF2 cost identical.
  const stored = row?.password_hash ?? "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const passOk = await verifyPassword(password || " ", stored);

  const t = now();
  if (!row || row.active !== 1) return pad({ status: 401, body: { error: "Incorrect email or password." } });
  if (row.locked_until > t) return pad({ status: 429, body: { error: "Too many attempts. Try again later." } });

  if (!passOk) {
    const failed = row.failed_attempts + 1;
    const lockedUntil = failed >= MAX_FAILED ? t + LOCK_SECONDS : 0;
    await db
      .prepare("UPDATE lu_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?")
      .bind(failed >= MAX_FAILED ? 0 : failed, lockedUntil, t, row.id)
      .run();
    return pad({ status: 401, body: { error: "Incorrect email or password." } });
  }

  await db
    .prepare("UPDATE lu_users SET failed_attempts = 0, locked_until = 0, last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(t, t, row.id)
    .run();

  const sessionId = await createSession(db, row.id, opts.ua);
  return pad({
    status: 200,
    body: { user: userView(row) },
    setCookie: sessionCookie(sessionId, opts.secure),
  });
}

export async function logout(db: D1Database, sessionId: string | null, opts: AuthOpts): Promise<AuthResult> {
  if (sessionId) {
    await db.prepare("UPDATE lu_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now(), sessionId).run();
  }
  return { status: 200, body: { ok: true }, setCookie: clearSessionCookie(opts.secure) };
}

/** Resolve a session cookie to the logged-in user, or null. */
export async function resolveSession(db: D1Database, sessionId: string | null): Promise<CurrentUser | null> {
  if (!sessionId) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.riot_game_name, u.riot_tag_line, u.riot_platform
       FROM lu_sessions s JOIN lu_users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.active = 1`
    )
    .bind(sessionId, now())
    .first<{
      id: number; email: string; display_name: string;
      riot_game_name: string | null; riot_tag_line: string | null; riot_platform: string | null;
    }>();
  return row ? userView(row) : null;
}
