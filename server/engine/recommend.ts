import type {
  EnrichedMatch,
  Recommendation,
  RecommendedGoal,
  DiagnosticSignal,
  ChampionPoolEntry,
  CoachInsight,
  RosterRecommendation,
  Role,
} from "../../shared/types.ts";
import { getTemplate } from "./goals.ts";
import { getIdentity } from "./identities.ts";

const MIN_GAMES = 5;
const WINDOW = 20;

interface DiagConfig {
  key: string;
  templateId: string;
  benchmark: number;
  identities: string[];
  weakNote: string;
}

const DIAGS: DiagConfig[] = [
  { key: "cs10", templateId: "cs10", benchmark: 70, identities: ["lane_bully"], weakNote: "you're leaving gold on the map - farm is a free lead" },
  { key: "gold15", templateId: "gold_diff_15", benchmark: 250, identities: ["lane_bully"], weakNote: "you're not translating lane into a gold lead" },
  { key: "deaths15", templateId: "deaths_before_15", benchmark: 2, identities: ["stonewall"], weakNote: "early deaths are handing the enemy tempo before the game starts" },
  { key: "deaths", templateId: "deaths_per_game", benchmark: 5, identities: ["stonewall"], weakNote: "total deaths are high - you're donating shutdowns" },
  { key: "kp", templateId: "kill_participation", benchmark: 55, identities: ["teamfight_architect"], weakNote: "you're missing the fights that decide games" },
  { key: "objectives", templateId: "objectives", benchmark: 5, identities: ["tempo_goblin"], weakNote: "objective control is thin - the map is slipping" },
  { key: "vision", templateId: "vision_per_min", benchmark: 1.0, identities: ["tempo_goblin"], weakNote: "you're fighting blind - vision is low" },
  { key: "tilt", templateId: "tilt_control", benchmark: 70, identities: ["shotcaller_monk"], weakNote: "too many games end hot - tilt is following you into queue" },
  { key: "flame", templateId: "no_flame_rate", benchmark: 100, identities: ["shotcaller_monk"], weakNote: "chat is costing you focus" },
  { key: "process", templateId: "avg_process", benchmark: 65, identities: [], weakNote: "overall process needs to come up" },
];

const def = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;

function assess(value: number | null, benchmark: number, direction: "higher" | "lower") {
  if (value == null) return { status: "watch" as const, severity: 0 };
  let sev =
    direction === "higher"
      ? (benchmark - value) / benchmark
      : (value - benchmark) / benchmark;
  sev = Math.max(0, Math.min(1, sev));
  const status =
    sev <= 0.05 ? ("good" as const) : sev <= 0.2 ? ("watch" as const) : ("weak" as const);
  return { status, severity: sev };
}

function championStats(ms: EnrichedMatch[]) {
  const map = new Map<
    string,
    {
      champion: string;
      games: number;
      avgProcess: number;
      avgGold15: number | null;
      avgDeaths15: number | null;
      wins: number;
      roles: Role[];
    }
  >();
  const byChampion = new Map<string, EnrichedMatch[]>();
  for (const match of ms) {
    const champion = match.objective.champion;
    if (!champion) continue;
    (byChampion.get(champion) ?? byChampion.set(champion, []).get(champion)!).push(match);
  }
  for (const [champion, games] of byChampion) {
    const process = games.map((g) => g.process.score);
    const gold15 = games.map((g) => g.objective.goldDiffAt15).filter(def);
    const deaths15 = games.map((g) => g.objective.deathsBefore15).filter(def);
    map.set(champion, {
      champion,
      games: games.length,
      avgProcess: Math.round(process.reduce((a, b) => a + b, 0) / process.length),
      avgGold15: gold15.length ? Math.round((gold15.reduce((a, b) => a + b, 0) / gold15.length) * 10) / 10 : null,
      avgDeaths15: deaths15.length ? Math.round((deaths15.reduce((a, b) => a + b, 0) / deaths15.length) * 10) / 10 : null,
      wins: games.filter((g) => g.objective.win).length,
      roles: [...new Set(games.map((g) => g.objective.role).filter(def))],
    });
  }
  return map;
}

function poolEntryForChampion(pool: ChampionPoolEntry[], champion: string) {
  return pool.find((p) => p.champion.toLowerCase() === champion.toLowerCase());
}

function fitRole(entry: ChampionPoolEntry, mainRole: Role | null) {
  if (!mainRole || mainRole === "UNKNOWN") return true;
  const roles = entry.roles ?? [];
  return roles.length === 0 || roles.includes(mainRole);
}

function chooseFocusChampion(
  ms: EnrichedMatch[],
  pool: ChampionPoolEntry[],
  mainRole: Role | null
) {
  const stats = championStats(ms);
  const candidates = pool
    .filter((entry) => fitRole(entry, mainRole))
    .map((entry) => {
      const stat = stats.get(entry.champion);
      const tierScore = entry.tier === "main" ? 3 : entry.tier === "secondary" ? 2 : 1;
      const sampleBonus = stat ? Math.min(1.5, stat.games / 4) : 0;
      const processBonus = stat ? stat.avgProcess / 40 : 0;
      return {
        entry,
        stat,
        score: tierScore + sampleBonus + processBonus,
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0] ?? null;
}

function buildRosterRecommendations(
  ms: EnrichedMatch[],
  pool: ChampionPoolEntry[],
  mainRole: Role | null,
  identityId: string
): RosterRecommendation[] {
  const roster: RosterRecommendation[] = [];
  const focus = chooseFocusChampion(ms, pool, mainRole);
  if (focus) {
    roster.push({
      kind: "commit_existing",
      champion: focus.entry.champion,
      title: `Double down on ${focus.entry.champion}`,
      rationale: focus.stat
        ? `${focus.entry.champion} is your cleanest ${focus.entry.tier} option right now (${focus.stat.avgProcess} process over ${focus.stat.games} games).`
        : `${focus.entry.champion} sits in your ${focus.entry.tier} pool and fits the current plan. Stack reps instead of reopening champ select chaos.`,
      roles: focus.entry.roles ?? (mainRole ? [mainRole] : []),
    });
  }

  const promote = pool.find(
    (entry) =>
      entry.tier !== "main" &&
      fitRole(entry, mainRole) &&
      (poolEntryForChampion(pool, entry.champion)?.roles?.length ?? 0) >= 0
  );
  if (promote) {
    roster.push({
      kind: "promote_pool",
      champion: promote.champion,
      title: `Keep ${promote.champion} in the rotation`,
      rationale: `${promote.champion} stays inside the pool as your change-up instead of reaching for an off-pool impulse pick.`,
      roles: promote.roles ?? (mainRole ? [mainRole] : []),
    });
  }

  const alignedPool = pool.filter((entry) => fitRole(entry, mainRole));
  if (alignedPool.length === 0) {
    roster.push({
      kind: "consider_new",
      champion: null,
      title:
        identityId === "stonewall"
          ? "Add a steadier anchor pick"
          : identityId === "lane_bully"
          ? "Add a lane-pressure backup"
          : "Add one more role-fit comfort pick",
      rationale:
        "Your saved pool does not currently show a clear option for this role/plan, so the coach would consider adding one new fit instead of improvising in ranked.",
      roles: mainRole ? [mainRole] : [],
    });
  }

  return roster.slice(0, 3);
}

function toInsight(signal: DiagnosticSignal): CoachInsight {
  return {
    label: signal.label,
    value: signal.value,
    benchmark: signal.benchmark,
    unit: signal.unit,
    note: signal.note,
  };
}

function buildPlan(
  identityName: string,
  identityId: string,
  goals: RecommendedGoal[],
  diagnostics: DiagnosticSignal[],
  roster: RosterRecommendation[],
  sampleSize: number
) {
  const keepDoing = diagnostics
    .filter((d) => d.status === "good")
    .slice(0, 3)
    .map(toInsight);
  const fixNext = diagnostics
    .filter((d) => d.status !== "good" && d.value != null)
    .sort((a, b) => {
      const as = Math.abs(a.benchmark - (a.value ?? 0));
      const bs = Math.abs(b.benchmark - (b.value ?? 0));
      return bs - as;
    })
    .slice(0, 3)
    .map(toInsight);

  const focusChampion = roster.find((r) => r.champion)?.champion;
  const nameSeed =
    identityId === "stonewall"
      ? "Stability Before LP"
      : identityId === "lane_bully"
      ? "Cash Out the Lane"
      : identityId === "tempo_goblin"
      ? "Play the Map First"
      : identityId === "teamfight_architect"
      ? "Fight Later, Better"
      : "Calm Queue Discipline";

  const theme =
    fixNext[0]?.label === "Gold lead at 15"
      ? "Turn playable lanes into actual leads."
      : fixNext[0]?.label === "Deaths before 15"
      ? "Keep the game boring until your champ gets to play."
      : fixNext[0]?.label === "Tilt control"
      ? "Protect judgment first, LP second."
      : "Keep the good habits and tighten the biggest leaks.";

  const goal =
    goals.length > 0
      ? `${goals[0].title}${focusChampion ? ` while stacking reps on ${focusChampion}` : ""}.`
      : "Play a cleaner block than the last 20 games.";

  return {
    name: `${nameSeed}${focusChampion ? `: ${focusChampion}` : ""}`,
    theme,
    goal,
    targetGames: sampleSize >= 12 ? 30 : 20,
    summary: `${identityName} is the right frame for the next block. Keep ${keepDoing.map((x) => x.label.toLowerCase()).join(", ") || "your current strengths"} stable and attack ${fixNext.map((x) => x.label.toLowerCase()).join(", ") || "the next leak"} first.`,
    keepDoing,
    fixNext,
    roster,
  };
}

export function recommend(
  recent: EnrichedMatch[],
  pool: ChampionPoolEntry[],
  mainRole: Role | null = null
): Recommendation {
  const ms = recent.slice(-WINDOW);
  const enough = ms.length >= MIN_GAMES;

  const diagnostics: DiagnosticSignal[] = [];
  const identityScore = new Map<string, number>();
  const goalCandidates: RecommendedGoal[] = [];

  for (const cfg of DIAGS) {
    const tpl = getTemplate(cfg.templateId)!;
    const { value } = tpl.measure(ms);
    const { status, severity } = assess(value, cfg.benchmark, tpl.direction);

    diagnostics.push({
      key: cfg.key,
      label: tpl.title(),
      value,
      benchmark: cfg.benchmark,
      unit: tpl.unit,
      direction: tpl.direction,
      status,
      note:
        value == null
          ? "not enough data yet"
          : status === "good"
          ? "solid - keep this stable"
          : cfg.weakNote,
    });

    if (value != null && status !== "good") {
      for (const id of cfg.identities) {
        identityScore.set(id, (identityScore.get(id) ?? 0) + severity);
      }
      goalCandidates.push({
        templateId: cfg.templateId,
        category: tpl.category,
        title: tpl.title(),
        description: tpl.describe(cfg.benchmark),
        target: cfg.benchmark,
        unit: tpl.unit,
        direction: tpl.direction,
        rationale: `Currently ${value}${tpl.unit === "%" ? "%" : ` ${tpl.unit}`} - ${cfg.weakNote}.`,
        severity,
        current: value,
      });
    }
  }

  const withFights = ms.filter((m) => m.scorecard.firstDeathCause);
  if (withFights.length >= 3) {
    const firstDead =
      withFights.filter(
        (m) =>
          m.scorecard.firstDeathCause === "teamfight_execution" ||
          m.scorecard.firstDeathCause === "facecheck"
      ).length / withFights.length;
    if (firstDead > 0.3) {
      identityScore.set(
        "teamfight_architect",
        (identityScore.get("teamfight_architect") ?? 0) + firstDead
      );
    }
  }

  let identityId = "stonewall";
  let best = -1;
  for (const [id, score] of identityScore) {
    if (score > best) {
      best = score;
      identityId = id;
    }
  }
  const identity = getIdentity(identityId);

  goalCandidates.sort((a, b) => b.severity - a.severity);
  const goals = goalCandidates.slice(0, 4);

  const focus = chooseFocusChampion(ms, pool, mainRole);
  if (focus) {
    for (const goal of goals) {
      if (goal.category !== "mental" && goal.category !== "champion") {
        goal.champion = focus.entry.champion;
        goal.title = getTemplate(goal.templateId)?.title(focus.entry.champion) ?? goal.title;
        goal.description =
          getTemplate(goal.templateId)?.describe(goal.target, focus.entry.champion) ??
          goal.description;
      }
    }
  }
  if (focus && !goals.some((g) => g.templateId === "champion_focus")) {
    const tpl = getTemplate("champion_focus")!;
    goals.push({
      templateId: "champion_focus",
      category: "champion",
      title: tpl.title(focus.entry.champion),
      description: tpl.describe(10, focus.entry.champion),
      target: 10,
      unit: tpl.unit,
      direction: tpl.direction,
      champion: focus.entry.champion,
      rationale: `Keep the block narrow by stacking reps on ${focus.entry.champion}.`,
      severity: 0.3,
      current: focus.stat?.games ?? null,
    });
  }

  const roster = buildRosterRecommendations(ms, pool, mainRole, identityId);

  if (!enough) {
    const starterIds = ["cs10", "deaths_before_15", "avg_process", "tilt_control"];
    const starterGoals: RecommendedGoal[] = starterIds.map((id) => {
      const tpl = getTemplate(id)!;
      return {
        templateId: id,
        category: tpl.category,
        title: tpl.title(),
        description: tpl.describe(tpl.defaultTarget),
        target: tpl.defaultTarget,
        unit: tpl.unit,
        direction: tpl.direction,
        rationale: "Starter goal - the coach personalizes this after ~5 logged games.",
        severity: 0.5,
        current: null,
      };
    });
    if (focus) {
      const tpl = getTemplate("champion_focus")!;
      starterGoals.push({
        templateId: "champion_focus",
        category: "champion",
        title: tpl.title(focus.entry.champion),
        description: tpl.describe(10, focus.entry.champion),
        target: 10,
        unit: tpl.unit,
        direction: tpl.direction,
        champion: focus.entry.champion,
        rationale: `Commit reps to ${focus.entry.champion}.`,
        severity: 0.3,
        current: focus.stat?.games ?? null,
      });
    }
    return {
      hasEnoughData: false,
      sampleSize: ms.length,
      identityId: "stonewall",
      identityName: getIdentity("stonewall").name,
      identityRationale:
        "Not enough games yet to read your play. Starting you on The Stonewall Climber - stability first is never the wrong opening.",
      goals: starterGoals,
      diagnostics,
      plan: buildPlan(
        getIdentity("stonewall").name,
        "stonewall",
        starterGoals,
        diagnostics,
        roster,
        ms.length
      ),
    };
  }

  const weakest = diagnostics
    .filter((d) => d.status === "weak" && d.value != null)
    .slice(0, 2)
    .map((d) => d.label.toLowerCase());

  const identityRationale =
    best <= 0
      ? `Your recent block looks reasonably balanced over ${ms.length} games. ${identity.name} keeps you consolidating instead of chasing noise.`
      : `Over your last ${ms.length} games, your biggest leaks (${weakest.join(", ") || "a few areas"}) point at ${identity.name}: ${identity.tagline}`;

  return {
    hasEnoughData: true,
    sampleSize: ms.length,
    identityId,
    identityName: identity.name,
    identityRationale,
    goals,
    diagnostics,
    plan: buildPlan(identity.name, identityId, goals, diagnostics, roster, ms.length),
  };
}
