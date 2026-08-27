import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import https from "node:https";
import { execFile } from "node:child_process";
import type { Role } from "../shared/types.ts";

// ---------------------------------------------------------------------------
// LOCAL LEAGUE READER
//
// Two local sources, both on the machine running League (our Express server can
// reach them; a browser can't):
//   • LCU API  — the client. Auth from the `lockfile`. Gives champ select.
//   • Live Client Data API (127.0.0.1:2999) — the running game. Exact roles.
//
// Everything degrades to null when League isn't running, so the companion just
// shows a "waiting" state instead of erroring.
// ---------------------------------------------------------------------------

const LEAGUE_DIRS = [
  process.env.LEAGUE_PATH,
  "C:/Riot Games/League of Legends",
  "C:/Program Files/Riot Games/League of Legends",
  "/Applications/League of Legends.app/Contents/LoL",
].filter((x): x is string => !!x);

interface LcuAuth { port: number; password: string }

function readLockfile(): LcuAuth | null {
  for (const dir of LEAGUE_DIRS) {
    const lf = resolve(dir, "lockfile");
    if (!existsSync(lf)) continue;
    try {
      const parts = readFileSync(lf, "utf8").trim().split(":"); // name:pid:port:password:protocol
      if (parts.length >= 5) return { port: Number(parts[2]), password: parts[3] };
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Install-location-independent discovery: read the LeagueClientUx process's own
// command line, which carries --app-port and --remoting-auth-token. This works
// no matter where League is installed, so detection doesn't depend on our
// hardcoded LEAGUE_DIRS list. Windows via PowerShell; macOS via ps.
function lcuFromProcess(): Promise<LcuAuth | null> {
  return new Promise((res) => {
    const parse = (out: string): LcuAuth | null => {
      const port = out.match(/--app-port[=\s]+"?(\d+)"?/);
      const token = out.match(/--remoting-auth-token[=\s]+"?([\w-]+)"?/);
      if (port && token) return { port: Number(port[1]), password: token[1] };
      return null;
    };
    const done = (out: string | null) => res(out ? parse(out) : null);
    try {
      if (process.platform === "win32") {
        execFile(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command",
            "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine"],
          { timeout: 3000, windowsHide: true, maxBuffer: 1 << 20 },
          (err, stdout) => done(err ? null : stdout)
        );
      } else if (process.platform === "darwin") {
        execFile("sh", ["-c", "ps -A -o args | grep -m1 'LeagueClientUx' | grep -v grep"],
          { timeout: 3000, maxBuffer: 1 << 20 }, (err, stdout) => done(err ? null : stdout));
      } else {
        res(null);
      }
    } catch {
      res(null);
    }
  });
}

// Cached auth from process discovery, so we don't spawn a subprocess on every
// 4s poll. Only used when the lockfile isn't in a known dir; invalidated when a
// call fails (client closed/restarted).
let cachedAuth: LcuAuth | null = null;

async function getLcuAuth(): Promise<LcuAuth | null> {
  const lock = readLockfile(); // cheap file read; covers standard installs
  if (lock) return lock;
  if (cachedAuth) return cachedAuth;
  cachedAuth = await lcuFromProcess(); // custom install path — ask the process
  return cachedAuth;
}

// GET a local HTTPS endpoint with the self-signed cert accepted. Resolves null
// on any failure (client closed, timeout, non-2xx) so callers stay simple.
function localGet<T>(opts: { port: number; path: string; auth?: string }): Promise<T | null> {
  return new Promise((res) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port: opts.port,
        path: opts.path,
        method: "GET",
        headers: opts.auth ? { Authorization: `Basic ${opts.auth}` } : {},
        rejectUnauthorized: false, // local self-signed cert
      },
      (r) => {
        let body = "";
        r.on("data", (c) => (body += c));
        r.on("end", () => {
          if (r.statusCode && r.statusCode >= 200 && r.statusCode < 300) {
            try { res(JSON.parse(body) as T); } catch { res(null); }
          } else res(null);
        });
      }
    );
    req.on("error", () => res(null));
    req.setTimeout(1500, () => { req.destroy(); res(null); });
    req.end();
  });
}

const POS: Record<string, Role> = { top: "TOP", jungle: "JUNGLE", middle: "MID", bottom: "BOT", utility: "SUPPORT", "": "UNKNOWN" };
const roleOf = (p?: string): Role | null => (p ? POS[p.toLowerCase()] ?? null : null);

export interface RawLiveState {
  clientDetected: boolean;
  phase: string; // "None" | "ChampSelect" | "InProgress" | ...
  queueId: number | null;
  gameMode: string | null; // from the in-game API ("CLASSIC" | "ARAM" | "CHERRY" | ...)
  source: "champselect" | "ingame" | null;
  // champion keys are DDragon *numeric* ids (championId); the caller maps them.
  mineKey: number | null;
  myRole: Role | null;
  allies: { key: number; role: Role | null }[];
  enemies: { key: number; role: Role | null }[];
  // in-game only: exact champion NAMES + roles for both teams (already resolved)
  ingame?: {
    mine: { champion: string; role: Role | null } | null;
    allies: { champion: string; role: Role | null }[];
    enemies: { champion: string; role: Role | null }[];
  };
}

// Read whatever is live: a running game (exact roles) takes priority over champ
// select. Returns clientDetected:false when no League client is found at all.
export async function readLiveState(): Promise<RawLiveState> {
  const empty: RawLiveState = {
    clientDetected: false, phase: "None", queueId: null, gameMode: null, source: null,
    mineKey: null, myRole: null, allies: [], enemies: [],
  };

  // 1) A running game — the Live Client Data API has exact positions.
  const game = await localGet<any>({ port: 2999, path: "/liveclientdata/allgamedata" });
  if (game && Array.isArray(game.allPlayers)) {
    const meName = game.activePlayer?.summonerName ?? game.activePlayer?.riotIdGameName ?? "";
    const players = game.allPlayers.map((p: any) => ({
      champion: p.rawChampionName ? String(p.rawChampionName).replace("game_character_displayname_", "") : p.championName,
      role: roleOf(p.position),
      team: p.team, // "ORDER" | "CHAOS"
      isMe: (p.summonerName ?? p.riotIdGameName ?? "") === meName,
    }));
    const me = players.find((p: any) => p.isMe) ?? null;
    const myTeam = me?.team;
    const allies = players.filter((p: any) => p.team === myTeam && !p.isMe);
    const enemies = players.filter((p: any) => p.team !== myTeam);
    return {
      clientDetected: true, phase: "InProgress", queueId: game.gameData?.queueId ?? null,
      gameMode: game.gameData?.gameMode ?? null, source: "ingame",
      mineKey: null, myRole: me?.role ?? null, allies: [], enemies: [],
      ingame: {
        mine: me ? { champion: me.champion, role: me.role } : null,
        allies: allies.map((p: any) => ({ champion: p.champion, role: p.role })),
        enemies: enemies.map((p: any) => ({ champion: p.champion, role: p.role })),
      },
    };
  }

  // 2) Champ select via the LCU (client) API.
  const lock = await getLcuAuth();
  if (!lock) return empty; // no League client found on this machine
  const auth = Buffer.from(`riot:${lock.password}`).toString("base64");
  const phaseRaw = await localGet<string>({ port: lock.port, path: "/lol-gameflow/v1/gameflow-phase", auth });
  if (phaseRaw == null) {
    // Reached no client with this auth — it's stale (client closed/restarted) or
    // wasn't really running. Drop the cache so the next poll re-discovers.
    cachedAuth = null;
    return empty;
  }
  const phase = phaseRaw;
  const flow = await localGet<any>({ port: lock.port, path: "/lol-gameflow/v1/session", auth });
  const queueId = flow?.gameData?.queue?.id ?? null;

  if (phase !== "ChampSelect") {
    return { ...empty, clientDetected: true, phase, queueId };
  }
  const session = await localGet<any>({ port: lock.port, path: "/lol-champ-select/v1/session", auth });
  if (!session) return { ...empty, clientDetected: true, phase, queueId };

  const myCell = session.localPlayerCellId;
  const me = (session.myTeam ?? []).find((p: any) => p.cellId === myCell) ?? null;
  const mapTeam = (t: any[], skipCell?: number) =>
    (t ?? [])
      .filter((p: any) => p.championId > 0 && p.cellId !== skipCell)
      .map((p: any) => ({ key: p.championId as number, role: roleOf(p.assignedPosition) }));
  return {
    clientDetected: true, phase, queueId, gameMode: null, source: "champselect",
    mineKey: me && me.championId > 0 ? me.championId : null,
    myRole: roleOf(me?.assignedPosition),
    allies: mapTeam(session.myTeam, myCell),
    enemies: mapTeam(session.theirTeam),
  };
}
