import type { ObjectiveData, AdvancedStats, Role, Side } from "../shared/types.ts";
import { selfIdentity } from "./userContext.ts";

// ---------------------------------------------------------------------------
// RIOT API CLIENT
//
// Server-side only — your API key never touches the browser. Turns a match id
// (or "your latest ranked game") into ObjectiveData, including the timeline
// parse that gives CS@10, gold diff, and first-death timing.
// ---------------------------------------------------------------------------

// platform host -> continental cluster for account-v1
const ACCOUNT_CLUSTER: Record<string, string> = {
  na1: "americas", br1: "americas", la1: "americas", la2: "americas",
  oc1: "americas",
  kr: "asia", jp1: "asia",
  euw1: "europe", eun1: "europe", tr1: "europe", ru: "europe",
};

// platform host -> regional route for match-v5 (SEA split out)
const MATCH_ROUTE: Record<string, string> = {
  na1: "americas", br1: "americas", la1: "americas", la2: "americas",
  kr: "asia", jp1: "asia",
  euw1: "europe", eun1: "europe", tr1: "europe", ru: "europe",
  oc1: "sea",
};

const QUEUE_NAMES: Record<number, string> = {
  420: "RANKED_SOLO_5x5",
  440: "RANKED_FLEX_SR",
  400: "NORMAL_DRAFT",
  430: "NORMAL_BLIND",
  480: "SWIFTPLAY",
  490: "NORMAL_QUICKPLAY",
  700: "CLASH",
  450: "ARAM",
  // Non-Rift / rotating modes.
  1700: "ARENA",
  1710: "ARENA",
  1300: "NEXUS_BLITZ",
  1900: "URF",
  900: "ARURF",
  720: "ARAM_CLASH",
  1200: "NEXUS_BLITZ",
  1000: "ARAM_MAYHEM",
  1010: "ARAM_MAYHEM",
};

// Queues that are 2v2v2v2 / free-for-all — placement-based, not a binary team
// win, and with no lanes or shared team objectives.
const ARENA_QUEUES = new Set([1700, 1710]);
// Modes with no lane assignments (skip lane-opponent diffs and the fight tree's
// team-win logic where teams aren't the usual 100/200 split).
const NO_LANE_QUEUES = new Set([450, 1700, 1710, 1000, 1010, 900, 1900, 1300, 1200]);

const POSITION_TO_ROLE: Record<string, Role> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MID",
  BOTTOM: "BOT",
  UTILITY: "SUPPORT",
};

export class RiotError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class RiotClient {
  constructor(
    private apiKey: string,
    private gameName: string,
    private tagLine: string,
    private platform: string
  ) {}

  private get accountCluster() {
    return ACCOUNT_CLUSTER[this.platform] ?? "americas";
  }
  private get matchRoute() {
    return MATCH_ROUTE[this.platform] ?? "americas";
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { "X-Riot-Token": this.apiKey } });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { status?: { message?: string } };
        detail = body.status?.message ?? detail;
      } catch {
        /* ignore */
      }
      const hint =
        res.status === 401 || res.status === 403
          ? " (check your RIOT_API_KEY — dev keys expire every 24h)"
          : res.status === 404
          ? " (not found — check your Riot ID / platform)"
          : res.status === 429
          ? " (rate limited — wait a moment)"
          : "";
      throw new RiotError(res.status, `Riot API ${res.status}: ${detail}${hint}`);
    }
    return res.json() as Promise<T>;
  }

  async getPuuid(): Promise<string> {
    const url = `https://${this.accountCluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
      this.gameName
    )}/${encodeURIComponent(this.tagLine)}`;
    const acc = await this.get<{ puuid: string }>(url);
    return acc.puuid;
  }

  async getRank(puuid: string): Promise<{
    tier?: string;
    division?: string;
    leaguePoints?: number;
    solo?: { tier: string; division: string; leaguePoints: number } | null;
    flex?: { tier: string; division: string; leaguePoints: number } | null;
  }> {
    // league-v4 now serves entries directly by puuid; the old by-summonerId path
    // is deprecated and returns nothing for many accounts.
    const entries = await this.get<
      { queueType: string; tier: string; rank: string; leaguePoints: number }[]
    >(
      `https://${this.platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`
    );
    const mk = (e?: { tier: string; rank: string; leaguePoints: number }) =>
      e ? { tier: e.tier, division: e.rank, leaguePoints: e.leaguePoints } : null;
    const solo = mk(entries.find((e) => e.queueType === "RANKED_SOLO_5x5"));
    const flex = mk(entries.find((e) => e.queueType === "RANKED_FLEX_SR"));
    const primary = solo ?? flex ?? mk(entries[0]);
    return { ...(primary ?? {}), solo, flex };
  }

  // Top champion masteries straight from Riot — the real "main", independent of
  // which games we've captured. championId is the numeric key (map via DDragon).
  async getTopMastery(puuid: string, count = 3): Promise<{ championId: number; level: number; points: number }[]> {
    const rows = await this.get<{ championId: number; championLevel: number; championPoints: number }[]>(
      `https://${this.platform}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`
    );
    return rows.map((r) => ({ championId: r.championId, level: r.championLevel, points: r.championPoints }));
  }

  async getSummonerInfo(puuid: string): Promise<{ level: number | null; profileIconId: number | null }> {
    const s = await this.get<{ summonerLevel?: number; profileIconId?: number }>(
      `https://${this.platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`
    );
    return { level: s.summonerLevel ?? null, profileIconId: s.profileIconId ?? null };
  }

  // startTime (epoch seconds) scopes the pull to a season/window; start paginates.
  async getRecentMatchIds(
    puuid: string,
    count = 10,
    queue?: number,
    startTime?: number,
    start = 0
  ): Promise<string[]> {
    const q = queue ? `&queue=${queue}` : "";
    const st = startTime ? `&startTime=${startTime}` : "";
    return this.get<string[]>(
      `https://${this.matchRoute}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}${q}${st}`
    );
  }

  get platformHost() {
    return this.platform;
  }

  // Full 10-player scoreboard for a match (iTero-style match detail), including
  // each player's build, summoner spells, and rune style ids (icons resolved
  // by the caller against Data Dragon).
  async getMatchScoreboard(matchId: string, myPuuid: string): Promise<{ players: any[]; durationSec: number }> {
    const match = await this.get<any>(
      `https://${this.matchRoute}.api.riotgames.com/lol/match/v5/matches/${matchId}`
    );
    const info = match.info;
    const players = (info.participants ?? []).map((p: any) => {
      const core = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((i: number) => i > 0);
      const styles = p.perks?.styles ?? [];
      const keystone = styles[0]?.selections?.[0]?.perk ?? null;
      const secondaryStyle = styles[1]?.style ?? null;
      return {
        champion: p.championName,
        name: p.riotIdGameName ?? p.summonerName ?? "",
        tagLine: p.riotIdTagline ?? "",
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        assists: p.assists ?? 0,
        damage: p.totalDamageDealtToChampions ?? 0,
        damageTaken: p.totalDamageTaken ?? 0,
        cs: (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
        gold: p.goldEarned ?? 0,
        wards: p.wardsPlaced ?? 0,
        visionScore: p.visionScore ?? 0,
        level: p.champLevel ?? 0,
        role: POSITION_TO_ROLE[p.teamPosition] ?? "UNKNOWN",
        team: p.teamId === 100 ? "BLUE" : "RED",
        win: !!p.win,
        isMe: p.puuid === myPuuid,
        items: core,
        trinket: p.item6 ?? 0,
        spells: [p.summoner1Id ?? 0, p.summoner2Id ?? 0],
        _keystone: keystone,
        _secondaryStyle: secondaryStyle,
      };
    });
    return { players, durationSec: info.gameDuration ?? 0 };
  }

  // Per-minute series for all ten players: gold, xp, and cs. Index-aligned to
  // the participants array we return alongside.
  async getMatchTimeline(matchId: string, myPuuid: string): Promise<{ participants: any[]; frames: any[] }> {
    const match = await this.get<any>(
      `https://${this.matchRoute}.api.riotgames.com/lol/match/v5/matches/${matchId}`
    );
    const pids: string[] = match.metadata.participants;
    const participants = (match.info.participants ?? []).map((p: any) => ({
      champion: p.championName,
      name: p.riotIdGameName ?? p.summonerName ?? "",
      team: p.teamId === 100 ? "BLUE" : "RED",
      isMe: p.puuid === myPuuid,
    }));

    const timeline = await this.get<any>(
      `https://${this.matchRoute}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`
    );
    const rawFrames: any[] = timeline.info?.frames ?? [];
    const order = pids.map((_, i) => String(i + 1)); // participantFrames keys are "1".."10"
    const frames = rawFrames.map((f) => {
      const pf = f.participantFrames ?? {};
      const read = (fn: (x: any) => number) => order.map((k) => fn(pf[k] ?? {}));
      return {
        minute: Math.round((f.timestamp ?? 0) / 60000),
        gold: read((x) => x.totalGold ?? 0),
        xp: read((x) => x.xp ?? 0),
        cs: read((x) => (x.minionsKilled ?? 0) + (x.jungleMinionsKilled ?? 0)),
      };
    });
    return { participants, frames };
  }

  async getObjectiveData(matchId: string, puuid: string): Promise<ObjectiveData> {
    const match = await this.get<any>(
      `https://${this.matchRoute}.api.riotgames.com/lol/match/v5/matches/${matchId}`
    );
    const info = match.info;
    const participants: string[] = match.metadata.participants;
    const idx = participants.indexOf(puuid);
    const me = info.participants[idx];
    const myPid = idx + 1;

    const side: Side = me.teamId === 100 ? "BLUE" : "RED";
    const role: Role = POSITION_TO_ROLE[me.teamPosition] ?? "UNKNOWN";

    const queueId = info.queueId;
    const isArena = ARENA_QUEUES.has(queueId);
    const noLane = NO_LANE_QUEUES.has(queueId);

    // Modes with no lanes have no meaningful lane opponent — skip it, otherwise
    // we'd diff gold against a random enemy.
    const opp =
      !noLane && me.teamPosition
        ? info.participants.find(
            (p: any) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition
          )
        : undefined;
    const oppPid = opp ? info.participants.indexOf(opp) + 1 : null;

    const myTeam = info.teams.find((t: any) => t.teamId === me.teamId);
    const obj = myTeam?.objectives ?? {};
    const ch = me.challenges ?? {};

    // Arena has no binary team win; placement is the outcome (top half = good).
    const placement = isArena ? me.placement ?? me.subteamPlacement ?? null : null;
    const win = isArena && placement != null ? placement <= 4 : me.win;

    const data: ObjectiveData = {
      riotMatchId: matchId,
      playedAt: new Date(
        info.gameStartTimestamp ?? info.gameCreation ?? Date.now()
      ).toISOString(),
      champion: me.championName,
      opponentChampion: opp?.championName ?? null,
      opponentName: opp?.riotIdGameName ?? opp?.summonerName ?? null,
      role,
      side,
      win,
      placement,
      build: {
        items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5].map((i: number) => i ?? 0).filter((_: number, idx: number) => idx < 6),
        trinket: me.item6 ?? 0,
        spells: [me.summoner1Id ?? 0, me.summoner2Id ?? 0],
        keystone: me.perks?.styles?.[0]?.selections?.[0]?.perk ?? null,
        secondaryStyle: me.perks?.styles?.[1]?.style ?? null,
      },
      queue: QUEUE_NAMES[queueId] ?? `QUEUE_${queueId}`,
      durationSec: info.gameDuration,
      kills: me.kills,
      deaths: me.deaths,
      assists: me.assists,
      totalCs: (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0),
      damageToChampions: me.totalDamageDealtToChampions,
      visionScore: me.visionScore,
      soloKills: ch.soloKills,
      teamDamageShare: ch.teamDamagePercentage ?? null,
      killParticipation: ch.killParticipation ?? null,
      dragons: obj.dragon?.kills,
      voidgrubs: obj.horde?.kills,
      heralds: obj.riftHerald?.kills,
      barons: obj.baron?.kills,
      towers: obj.tower?.kills,
      adv: {
        doubleKills: me.doubleKills,
        tripleKills: me.tripleKills,
        quadraKills: me.quadraKills,
        pentaKills: me.pentaKills,
        dmgTaken: me.totalDamageTaken,
        dmgMitigated: me.damageSelfMitigated,
        dmgToTurrets: me.damageDealtToTurrets,
        dmgToObjectives: me.damageDealtToObjectives,
        skillshotsHit: ch.skillshotsHit,
        skillshotsDodged: ch.skillshotsDodged,
        immobilizations: ch.enemyChampionImmobilizations,
        controlWards: ch.controlWardsPlaced ?? me.detectorWardsPlaced,
        wardsKilled: me.wardsKilled,
        wardsPlaced: me.wardsPlaced,
        turretPlates: ch.turretPlatesTaken,
        dragonTakedowns: ch.dragonTakedowns,
        baronTakedowns: ch.baronTakedowns,
        heraldTakedowns: ch.riftHeraldTakedowns,
        grubTakedowns: ch.hordeTakedowns ?? ch.voidMonsterKill,
      },
    };

    // Timeline gives us the early-game truth: CS@10, gold diff, death timing,
    // damage-by-phase, and clustered fight outcomes.
    try {
      const timeline = await this.get<any>(
        `https://${this.matchRoute}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`
      );
      Object.assign(data, parseTimeline(timeline, myPid, oppPid));
      Object.assign(data.adv!, parsePhaseDamage(timeline, myPid));
      // The fight tree relies on the standard 100/200 team split. ARAM and most
      // rotating modes still have that, so only free-for-all Arena is skipped.
      if (!isArena) {
        const teamOf = (pid: number) => (info.participants[pid - 1]?.teamId ?? 0);
        Object.assign(data.adv!, parseFights(timeline, myPid, me.teamId, teamOf));
      }
    } catch {
      // Timeline is best-effort; a missing one just means no early-game deltas.
    }

    return data;
  }
}

function frameAt(frames: any[], targetMs: number): any | null {
  let best: any = null;
  for (const f of frames) {
    if (f.timestamp <= targetMs + 30000) best = f;
    else break;
  }
  return best ?? frames[0] ?? null;
}

function csOf(pf: any): number {
  return (pf?.minionsKilled ?? 0) + (pf?.jungleMinionsKilled ?? 0);
}

function parseTimeline(
  timeline: any,
  myPid: number,
  oppPid: number | null
): Partial<ObjectiveData> {
  const frames: any[] = timeline.info?.frames ?? [];
  const out: Partial<ObjectiveData> = {};

  const f10 = frameAt(frames, 600000);
  const f14 = frameAt(frames, 840000);
  const f15 = frameAt(frames, 900000);

  const mine = (f: any) => f?.participantFrames?.[String(myPid)];
  const theirs = (f: any) => (oppPid ? f?.participantFrames?.[String(oppPid)] : null);

  if (f10) {
    out.csAt10 = csOf(mine(f10));
    if (theirs(f10)) {
      out.goldDiffAt10 = (mine(f10).totalGold ?? 0) - (theirs(f10).totalGold ?? 0);
      out.xpDiffAt10 = (mine(f10).xp ?? 0) - (theirs(f10).xp ?? 0);
    }
  }
  if (f14) out.csAt14 = csOf(mine(f14));
  if (f15 && theirs(f15)) {
    out.goldDiffAt15 = (mine(f15).totalGold ?? 0) - (theirs(f15).totalGold ?? 0);
  }

  // First death + early death counts from CHAMPION_KILL events.
  let deathsBefore10 = 0;
  let deathsBefore15 = 0;
  let firstDeath: number | null = null;
  for (const f of frames) {
    for (const ev of f.events ?? []) {
      if (ev.type === "CHAMPION_KILL" && ev.victimId === myPid) {
        if (firstDeath === null) firstDeath = ev.timestamp;
        if (ev.timestamp < 600000) deathsBefore10++;
        if (ev.timestamp < 900000) deathsBefore15++;
      }
    }
  }
  out.deathsBefore10 = deathsBefore10;
  out.deathsBefore15 = deathsBefore15;
  out.firstDeathSec = firstDeath !== null ? Math.round(firstDeath / 1000) : null;

  return out;
}

// Damage to champions split into early (0–14), mid (14–25), late (25+). The
// timeline's damageStats are cumulative, so we diff the phase boundaries.
function parsePhaseDamage(timeline: any, myPid: number): Partial<AdvancedStats> {
  const frames: any[] = timeline.info?.frames ?? [];
  if (!frames.length) return {};
  const dmgAt = (f: any) => f?.participantFrames?.[String(myPid)]?.damageStats?.totalDamageDoneToChampions ?? null;

  const f14 = frameAt(frames, 840000);
  const f25 = frameAt(frames, 1500000);
  const last = frames[frames.length - 1];

  const at14 = dmgAt(f14);
  const at25 = dmgAt(f25);
  const atEnd = dmgAt(last);
  if (atEnd == null) return {};

  const early = at14 ?? 0;
  const mid = at25 != null ? Math.max(0, at25 - early) : Math.max(0, atEnd - early);
  const late = at25 != null ? Math.max(0, atEnd - at25) : 0;
  return { dmgEarly: early, dmgMid: mid, dmgLate: late };
}

// Cluster CHAMPION_KILL events into fights (bursts of kills close in time),
// classify each by how many distinct champions were involved, and record the
// ones you took part in and whether your team won them.
//   duel      = 2 champions involved (a 1v1)
//   skirmish  = 3–5 involved
//   teamfight = 6+ involved
function parseFights(
  timeline: any,
  myPid: number,
  myTeamId: number,
  teamOf: (pid: number) => number
): Partial<AdvancedStats> {
  const frames: any[] = timeline.info?.frames ?? [];
  const kills: any[] = [];
  for (const f of frames) {
    for (const ev of f.events ?? []) {
      if (ev.type === "CHAMPION_KILL" && ev.killerId > 0 && ev.victimId > 0) kills.push(ev);
    }
  }
  kills.sort((a, b) => a.timestamp - b.timestamp);

  const out = {
    duels: 0, duelWins: 0, skirmishes: 0, skirmishWins: 0, teamfights: 0, teamfightWins: 0,
  };

  const GAP = 15000; // a kill joins the fight if within 15s of the previous one
  let cluster: any[] = [];
  const flush = () => {
    if (!cluster.length) return;
    const involved = new Set<number>();
    let myKills = 0;
    let enemyKills = 0;
    let iWasIn = false;
    for (const ev of cluster) {
      const parts = [ev.killerId, ev.victimId, ...(ev.assistingParticipantIds ?? [])].filter((p: number) => p > 0);
      for (const p of parts) involved.add(p);
      if (parts.includes(myPid)) iWasIn = true;
      if (teamOf(ev.killerId) === myTeamId) myKills++;
      else enemyKills++;
    }
    if (iWasIn) {
      const won = myKills > enemyKills;
      const n = involved.size;
      if (n <= 2) { out.duels++; if (won) out.duelWins++; }
      else if (n <= 5) { out.skirmishes++; if (won) out.skirmishWins++; }
      else { out.teamfights++; if (won) out.teamfightWins++; }
    }
    cluster = [];
  };

  for (const ev of kills) {
    if (cluster.length && ev.timestamp - cluster[cluster.length - 1].timestamp > GAP) flush();
    cluster.push(ev);
  }
  flush();
  return out;
}

// The "self" Riot client. The API key is always the shared server secret; the
// summoner identity is the logged-in user's (selfIdentity falls back to the
// RIOT_* env vars when no user is in context, i.e. local single-user dev).
export function riotFromEnv(): RiotClient | null {
  const key = process.env.RIOT_API_KEY;
  const { gameName, tagLine, platform } = selfIdentity();
  if (!key || !gameName || !tagLine) return null;
  return new RiotClient(key, gameName, tagLine, platform);
}

// A client for an arbitrary account (a searched profile), using our env API key.
export function riotForAccount(gameName: string, tagLine: string, platform: string): RiotClient | null {
  const key = process.env.RIOT_API_KEY;
  if (!key) return null;
  return new RiotClient(key, gameName, tagLine, platform);
}
