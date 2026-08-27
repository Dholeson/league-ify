// ---------------------------------------------------------------------------
// league-ify domain model
//
// Two data planes per game:
//   1. OBJECTIVE  — pulled from the Riot API (or pasted): what happened.
//   2. SELF-REPORT — your 90-second scorecard: what you think happened.
//
// The engine turns both into a SECOND SCOREBOARD that tracks process, not LP.
// ---------------------------------------------------------------------------

export type Role = "TOP" | "JUNGLE" | "MID" | "BOT" | "SUPPORT" | "UNKNOWN";

// ---- Live champ-select / in-game companion --------------------------------
export interface LivePlayer {
  champion: string; // DDragon id ("MonkeyKing")
  role: Role | null;
}
export interface LiveMatchupStat {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
}
export interface LiveMatchup {
  champion: string;
  opponent: string | null; // enemy laner (null in laneless modes / unknown)
  vsGames: number; // games in this exact matchup
  champGames: number; // your total games on this champion
  vsWinRate: number | null;
  champWinRate: number | null;
  stats: LiveMatchupStat[]; // key matchup numbers
  strengths: string[]; // what you do well here
  focus: string[]; // what to focus on this matchup
  note: string; // context when data is thin
}
export interface LiveBuildItem {
  name: string;
  itemId: number | null; // DDragon item id for the icon
  reason: string;
}
// A stage of the build path — what to buy when.
export interface LiveBuildPhase {
  phase: string; // "Opening" | "Core" | "Boots" | "Situational"
  when: string; // timing hint, e.g. "Start" | "First 2–3 items" | "After first item"
  items: LiveBuildItem[];
}
// One labeled way to build the champion (a flex champ has several). Each is a
// complete phased path; the recommended one best fits both team comps.
export interface LiveBuildOption {
  id: string;
  label: string; // "On-hit DPS", "AP burst", "Bruiser"
  blurb: string; // one line: what this build does
  recommended: boolean;
  fit: string; // why it's the pick (or not) given the comps
  phases: LiveBuildPhase[];
}
export interface LiveBuild {
  profile: { ad: number; ap: number; tank: number; cc: number; healing: number };
  teamNeeds: string[]; // gaps in YOUR comp that steer the build (e.g. "no AP on your team")
  summary: string;
  options: LiveBuildOption[]; // 1–3 labeled builds, recommended first
}
export interface LiveDraft {
  yourDamage: string; // "AD-leaning" | "AP-leaning" | "Mixed"
  enemyDamage: string;
  favored: "you" | "enemy" | "even";
  readout: string; // one-line verdict
  yourNotes: string[];
  enemyNotes: string[];
}
export interface LiveCompanionResponse {
  phase: string; // "None" | "Lobby" | "ChampSelect" | "InProgress" | ...
  clientDetected: boolean; // League client found on this machine
  inGame: boolean; // champ-select or live game data present
  source: "live" | "mock";
  mode: string; // "Ranked Solo/Duo" | "ARAM" | "Arena" | ...
  hasLanes: boolean;
  mine: LivePlayer | null;
  allies: LivePlayer[];
  enemies: LivePlayer[];
  enemyLaner: LivePlayer | null;
  matchup: LiveMatchup | null;
  build: LiveBuild | null;
  draft: LiveDraft | null;
}

// The optional LLM "deep read" — an on-demand synthesis layered on top of the
// rules-based companion. Grounded in the same data (your matchup history + the
// comp), but written as a narrative game plan. Costs a token call, so it's
// button-triggered and cached per champ-select signature.
export interface LiveDeepReadPhase {
  phase: string; // "Early game" | "Mid game" | "Late game" | "Opening" (mode-flexible)
  advice: string;
}
export interface LiveDeepRead {
  available: boolean; // false when no API key is configured
  reason?: string; // why unavailable / not yet ready
  generatedAt?: string;
  headline?: string; // the one-sentence identity of this game
  winCondition?: string; // your team's clearest path to winning
  gamePlan?: LiveDeepReadPhase[]; // phase-by-phase plan (mode-aware)
  matchupPlan?: string; // deep read of your lane vs the enemy laner, using your tendencies
  keyThreats?: string[]; // enemy champs/patterns to respect, most dangerous first
  buildNote?: string; // nuanced itemization reasoning tuned to the comp
}

// Post-game recap — the last finished game distilled for the Live page. Reads
// from the stored match (same source as the full match detail), so "view full
// match" and this card never drift.
export interface LiveRecapGoal {
  title: string;
  unit: string;
  direction: "higher" | "lower";
  kind: "avg" | "count"; // avg = per-game metric (CS@10, KP); count = cumulative tally (games, wins)
  target: number;
  gameValue: number | null; // avg: this game's metric · count: how many this game added (0/1)
  metThisGame: boolean; // avg: cleared the per-game bar · count: this game counted toward the goal
  runningBefore: number | null; // block value before this game (average, or running total)
  runningAfter: number | null; // block value after this game
  moved: "up" | "down" | "flat"; // did the block value move in the good direction
}
// One line of the deeper post-game readout — a strength to keep or a fix for
// next game, with the score/number behind it.
export interface LiveRecapPoint {
  label: string; // "Death discipline", "Objectives", …
  detail: string; // the coaching line
  value?: string; // optional metric ("2 deaths<15", "58% KP")
}
export interface LiveRecap {
  available: boolean;
  reason?: string;
  matchId?: string; // internal id → /match/:id for the full breakdown
  champion?: string; // DDragon id
  role?: string;
  mode?: string;
  win?: boolean | null;
  placement?: number | null; // Arena finish (1 = won)
  durationSec?: number | null;
  kills?: number; deaths?: number; assists?: number;
  kda?: number | null;
  cs?: number | null;
  csPerMin?: number | null;
  damage?: number | null; // damage to champions
  damageShare?: number | null; // 0..1
  kp?: number | null; // kill participation 0..1
  vision?: number | null;
  processScore?: number | null;
  verdict?: Verdict;
  xp?: number; // total XP this game earned
  highlights?: MatchTag[]; // op.gg-style at-a-glance tags
  didWell?: LiveRecapPoint[]; // what to keep doing
  workOn?: LiveRecapPoint[]; // what to fix next game
  goals?: LiveRecapGoal[]; // how this game moved each active block goal
  playedAt?: string;
}

// A role *preference* — the roles a player queues for, plus "ANY" (autofill/fill).
export type RolePref = Role | "ANY";
export type Side = "BLUE" | "RED" | "UNKNOWN";
export type PoolTier = "main" | "secondary" | "lab";

// Self-reported grade for the game (your gut call, before you see the number).
export type SelfGrade = "A" | "B" | "C" | "D" | "F";

// Where a champ sits for a given season. Ranked games on a "lab" champ get
// the "no culinary innovation in ranked" nudge.
export interface ChampionPoolEntry {
  champion: string;
  tier: PoolTier;
  roles?: Role[];
}

// The archetype you're trying to become this block. Weights steer the process
// score and which quests surface. See engine/identities.ts for the roster.
export interface Identity {
  id: string;
  name: string;
  tagline: string;
  // Weights over process sub-metrics. Need not sum to 1 — the engine
  // renormalizes over whichever sub-metrics have data for a given game.
  weights: ProcessWeights;
  // Quest ids this identity emphasizes.
  focusQuests: string[];
}

export interface ProcessWeights {
  earlyStability: number;
  deathDiscipline: number;
  objectiveMacro: number;
  teamfight: number;
  mental: number;
  review: number;
}

// A ranked campaign block. Not a bag of games — a season with a thesis.
// Which queue a block tracks. A block only counts games of its type — an ARAM
// block ignores your ranked games, and vice-versa. Undefined = "any" (legacy).
export type BlockType = "ranked" | "normal" | "aram" | "any";

export interface Season {
  id: string;
  name: string;
  theme: string; // one-line thesis for the block
  goal: string; // the single focused development goal
  identityId: string;
  targetGames: number; // 20 or 30 by default
  blockType?: BlockType; // queue this block tracks (undefined = any)
  focusChampion?: string | null; // subject champion, for the block's imagery
  // Champion pool lives on the Profile now (it's stable across blocks), not here.
  championPool?: ChampionPoolEntry[]; // legacy / optional block override
  startedAt: string; // ISO
  endedAt: string | null;
  status: "active" | "complete";
  retro: SeasonRetro | null;
}

export interface SeasonRetro {
  writtenAt: string;
  // "Patch notes for myself" — freeform, but prompted.
  whatWorked: string;
  whatBroke: string;
  keepDoing: string;
  stopDoing: string;
  nextBlockFocus: string;
}

// Categories for classifying the moment a game went wrong.
export type DeathCause =
  | "laning_mistake"
  | "greedy_recall"
  | "facecheck"
  | "objective_setup"
  | "overextension"
  | "shutdown_donation"
  | "teamfight_execution"
  | "sidelane_greed"
  | "mechanical_misplay"
  | "unavoidable_team_collapse";

// The self-report half of a game — the part that must survive a tilting loss.
export interface Scorecard {
  grade: SelfGrade;
  tiltBefore: number; // 0 calm .. 5 molten
  tiltAfter: number; // 0 .. 5
  biggestMistake: string;
  firstDeathCause: DeathCause | null;
  bestDecision: string;
  oneAdjustment: string; // the single thing to change next game
  doomedCollapse: boolean; // was the loss genuinely out of your hands?
  flamed: boolean; // did you type something you shouldn't have?
  mutedAppropriately: boolean;
  reviewed: boolean; // did you actually watch/think about the game?
}

// Objective data. Everything is optional because the API may be off, a match
// may be un-fetchable, or you may be logging from memory on mobile.
export interface ObjectiveData {
  champion?: string;
  role?: Role;
  side?: Side;
  win?: boolean;
  queue?: string; // "RANKED_SOLO_5x5" etc.
  durationSec?: number;

  // Rank snapshot at log time (from league-v4). LP delta is derived by diffing
  // against the previous logged snapshot.
  tier?: string; // "GOLD"
  division?: string; // "II"
  leaguePoints?: number;
  lpDelta?: number | null;

  kills?: number;
  deaths?: number;
  assists?: number;

  csAt10?: number;
  csAt14?: number;
  totalCs?: number; // final CS, for CS/min goals
  goldDiffAt10?: number | null;
  goldDiffAt15?: number | null;
  xpDiffAt10?: number | null;

  deathsBefore10?: number;
  deathsBefore15?: number;
  firstDeathSec?: number | null; // timestamp of your first death

  damageToChampions?: number;
  teamDamageShare?: number | null; // 0..1
  killParticipation?: number | null; // 0..1
  visionScore?: number;
  soloKills?: number;

  // Team objective counts (context, not individual credit).
  dragons?: number;
  voidgrubs?: number;
  heralds?: number;
  barons?: number;
  towers?: number;

  // Macro depth (from the timeline).
  opponentChampion?: string | null; // your direct lane opponent
  deathsBeforeObjective?: number; // deaths within 30s before an enemy elite monster

  // The DPM-Lens deep tree — richer per-game stats from the match `challenges`
  // block + timeline event/frame parsing. Optional: only present on games
  // ingested after this pipeline shipped (older games need a re-sync).
  adv?: AdvancedStats;

  // Non-Rift modes (Arena etc.): final placement (1 = won). Win is derived from
  // it because those modes have no binary team win.
  placement?: number | null;

  // Your build for the compact match rows (item ids, trinket, summoner spells,
  // rune keystone + secondary style). Captured at ingest; DDragon resolves icons.
  build?: {
    items: number[]; // up to 6 core item ids (0 = empty slot)
    trinket: number;
    spells: number[]; // [summoner1Id, summoner2Id]
    keystone: number | null;
    secondaryStyle: number | null;
  };
  opponentName?: string | null; // lane opponent's Riot game name

  playedAt?: string; // ISO game start (from Riot), for career ordering
  riotMatchId?: string; // to dedupe against auto-pull
}

// Deep per-game stats behind the DPM-Lens tree. All optional — a mode or a
// missing timeline simply leaves fields undefined, and the stat board shows "—".
export interface AdvancedStats {
  // Multi-kills.
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;

  // Damage profile (to champions unless noted).
  dmgTaken?: number;
  dmgMitigated?: number; // self-mitigated (shields/armor/resists)
  dmgToTurrets?: number;
  dmgToObjectives?: number;
  dmgEarly?: number; // champ damage 0–14 min (timeline)
  dmgMid?: number; // 14–25 min
  dmgLate?: number; // 25+ min

  // Mechanics (from `challenges`).
  skillshotsHit?: number;
  skillshotsDodged?: number;
  immobilizations?: number; // enemies you rooted/stunned/etc.

  // Vision detail.
  controlWards?: number;
  wardsKilled?: number;
  wardsPlaced?: number;

  // Objective participation (takedowns = kill or assist on the monster).
  turretPlates?: number;
  dragonTakedowns?: number;
  baronTakedowns?: number;
  heraldTakedowns?: number;
  grubTakedowns?: number;

  // Fight outcomes, classified by size from clustered CHAMPION_KILL events.
  // "wins" = your team scored more kills than the enemy in that fight.
  duels?: number;
  duelWins?: number;
  skirmishes?: number;
  skirmishWins?: number;
  teamfights?: number;
  teamfightWins?: number;
}

// A game = objective plane (always) + optional self-report + provenance.
// Auto-ingested Riot games carry a neutral scorecard and no self-report.
export interface Match {
  id: string;
  seasonId: string | null; // null = career game not tied to a block
  playedAt: string; // ISO, kickoff or log time
  loggedAt: string;
  source: "riot" | "manual" | "hybrid";
  objective: ObjectiveData;
  scorecard: Scorecard;
}

// ---- Derived (computed by the engine, never stored) ----------------------

export type Verdict =
  | "clean_win" // won and played well
  | "bad_win" // won but played badly — a warning, not a trophy
  | "good_loss" // lost but played well — this is XP, not failure
  | "deserved_loss" // lost and played badly
  | "standard"; // everything else

export interface ProcessBreakdown {
  score: number; // 0..100, identity-weighted
  subMetrics: Partial<Record<keyof ProcessWeights, number>>; // each 0..1
  usedWeights: Partial<ProcessWeights>; // renormalized weights actually applied
}

export interface EnrichedMatch extends Match {
  process: ProcessBreakdown;
  verdict: Verdict;
  xpAwarded: XpAward[];
  flags: MatchFlag[]; // nudges attached to this specific game
  tags: MatchTag[]; // op.gg-style at-a-glance labels
  // Per-game stat line vs a rank benchmark — only populated on the detail view.
  comparison?: StatComparison[];
  comparisonRank?: string;
  highlights?: MatchHighlight[]; // standout callouts for the top bar
}

// A standout, scoreboard-relative callout for a single game — e.g. "Most kills",
// "Top damage on your team". Shown as chips in the match hero.
export interface MatchHighlight {
  label: string;
  tone: "good" | "bad" | "neutral";
  hint: string;
}

// Short, glanceable labels per game (e.g. "Stomp", "Comeback", "Fed early").
export interface MatchTag {
  label: string;
  tone: "good" | "bad" | "neutral";
  hint: string; // why it fired — shown on hover / in detail
}

export interface XpAward {
  reason: string;
  amount: number;
}

export interface MatchFlag {
  kind: "warn" | "reward" | "info";
  code: string;
  message: string;
}

// ---- Session / guardrail engine ------------------------------------------

export interface SessionGuardrail {
  code: string;
  severity: "info" | "caution" | "stop";
  title: string;
  message: string;
}

export interface SessionSummary {
  id: string;
  startedAt: string;
  endedAt: string;
  matchIds: string[];
  games: number;
  wins: number;
  losses: number;
  netLp: number;
  avgProcess: number;
  currentLossStreak: number;
  peakTilt: number;
  guardrails: SessionGuardrail[];
  healthScore: number; // 0..100: was this a clean session regardless of LP?
}

// ---- Progression ----------------------------------------------------------

export interface Quest {
  id: string;
  title: string;
  description: string;
  scope: "game" | "daily" | "season";
  xp: number;
}

export interface QuestProgress {
  quest: Quest;
  current: number;
  target: number;
  complete: boolean;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  earnedAt?: string;
  progressLabel?: string;
}

export interface LevelState {
  totalXp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  title: string;
  nextLevel: number | null;
  nextTitle: string | null;
  currentThreshold: number;
  nextThreshold: number | null;
  xpReady: boolean;
  promotionReady: boolean;
  promotionQuests: PromotionQuestProgress[];
}

// ---- Profile (stable across blocks) ---------------------------------------

// Your champion pool doesn't change block to block — it's who you are, not what
// this block is about. So it lives on the profile, not the season.
export interface FavoriteProfile {
  gameName: string;
  tagLine: string;
  platform: string;
}

export interface Profile {
  mainRole: Role | null; // engine mirror of primaryRole (never "ANY")
  primaryRole?: RolePref | null;
  secondaryRole?: RolePref | null;
  championPool: ChampionPoolEntry[];
  favorites?: FavoriteProfile[]; // starred profiles for the switcher
  preferredRank?: string | null; // rank the "vs average" comparisons use
  updatedAt: string | null;
}

// Compact identity for the topbar profile menu / summoner header.
export interface ProfileHeader {
  gameName: string | null;
  tagLine: string | null;
  platform: string | null;
  level: number | null; // summoner (account) level
  profileIconId: number | null;
  tier: string | null;
  division: string | null;
  leaguePoints: number | null;
  topChampion: string | null;
  masteryLevel: number; // total champion-mastery level
  isSelf: boolean;
}

// Static champion data from Riot's Data Dragon (public, no API key needed).
export interface Champion {
  id: string; // "MonkeyKing"
  key: string; // numeric key as string
  name: string; // "Wukong"
  title: string;
  tags: string[]; // ["Fighter","Tank"]
  roles: Role[]; // common lane positions, for filtering the full roster
  imageUrl: string;
}

// ---- Goals ----------------------------------------------------------------

export type GoalCategory =
  | "farm"
  | "survival"
  | "objectives"
  | "aggression"
  | "vision"
  | "champion"
  | "mental"
  | "tempo"
  | "process"
  | "achievement"; // count-based, failable goals ("win 3 from behind")

// A measurable, tracked development goal. Templates (engine/goals.ts) define how
// each is measured; an instance stores the chosen target + optional champion.
export interface Goal {
  id: string;
  seasonId: string | null; // null = profile-level, spans blocks
  templateId: string;
  title: string;
  description: string;
  category: GoalCategory;
  target: number;
  unit: string;
  direction: "higher" | "lower"; // is a bigger or smaller value better?
  champion?: string | null;
  baseline?: number | null; // the player's value when the goal was set
  createdAt: string;
  status: "active" | "achieved" | "archived";
}

export interface GoalProgress {
  goal: Goal;
  current: number | null; // measured value (null if no data yet)
  target: number;
  baseline: number | null; // starting value, for a baseline→target fill bar
  pct: number; // 0..100 toward target
  fillPct: number; // 0..100 from baseline → target (progress across the gap)
  met: boolean;
  sampleSize: number;
  detail: string; // e.g. "avg over 12 games"
  whatCounts: string | null; // the per-game criteria that define passing
}

// The floating Objectives panel: the active block + its goals + profile level,
// available on every page (like the League client's Objectives modal).
export interface ObjectivesResponse {
  block: { id: string; name: string; focusChampion: string | null; targetGames: number; theme: string } | null;
  gamesLogged: number;
  goals: GoalProgress[];
  level: { level: number; levelPct: number; xpIntoLevel: number; xpForNext: number };
}

export interface PromotionQuestProgress {
  id: string;
  title: string;
  description: string;
  rationale: string;
  current: number | null;
  target: number;
  unit: string;
  direction: "higher" | "lower";
  pct: number;
  complete: boolean;
  sampleSize: number;
  detail: string;
}

export interface RollingQuest {
  id: string;
  familyKey: string;
  champion: string | null;
  title: string;
  description: string;
  current: number | null;
  target: number;
  unit: string;
  direction: "higher" | "lower";
  pct: number;
  complete: boolean;
  rationale: string;
  stage: number;
}

// ---- Recommendations (the coach) ------------------------------------------

export interface DiagnosticSignal {
  key: string;
  label: string;
  value: number | null;
  benchmark: number;
  unit: string;
  direction: "higher" | "lower";
  status: "good" | "watch" | "weak";
  note: string;
}

export interface RecommendedGoal {
  templateId: string;
  category: GoalCategory;
  title: string;
  description: string;
  target: number;
  unit: string;
  direction: "higher" | "lower";
  champion?: string | null;
  rationale: string;
  severity: number; // 0..1, how much this needs work
  current: number | null;
}

export interface CoachInsight {
  label: string;
  value: number | null;
  benchmark: number;
  unit: string;
  note: string;
}

export interface RosterRecommendation {
  kind: "commit_existing" | "promote_pool" | "consider_new";
  champion: string | null;
  title: string;
  rationale: string;
  roles: Role[];
}

export interface CoachPlan {
  name: string;
  theme: string;
  goal: string;
  targetGames: number;
  summary: string;
  keepDoing: CoachInsight[];
  fixNext: CoachInsight[];
  roster: RosterRecommendation[];
}

export interface Recommendation {
  hasEnoughData: boolean;
  sampleSize: number;
  identityId: string;
  identityName: string;
  identityRationale: string;
  goals: RecommendedGoal[];
  diagnostics: DiagnosticSignal[];
  plan: CoachPlan;
}

// ---- Progress / timelines (career-wide, cross-block) ----------------------

export interface MetricMeta {
  key: string;
  label: string;
  unit: string;
  direction: "higher" | "lower";
}

export interface MetricSeriesPoint {
  index: number; // global game number across the whole career
  date: string;
  blockId: string;
  blockName: string;
  win: boolean | null;
  values: Record<string, number | null>; // metricKey -> raw per-game value
}

export interface BlockSummary {
  id: string;
  name: string;
  identityName: string;
  status: "active" | "complete";
  startedAt: string;
  endedAt: string | null;
  games: number;
  wins: number;
  winRate: number;
  netLp: number;
  avgProcess: number;
  metrics: Record<string, number | null>; // averaged per-metric
}

export interface DayActivity {
  date: string; // YYYY-MM-DD (local)
  games: number;
  avgProcess: number;
  reviewedRate: number; // 0..1
}

export interface StreakStat {
  key: string;
  label: string;
  current: number; // raw trailing streak
  protected: number; // streak with shield forgiveness applied
  shields: number; // forgiveness charges available
  longest: number;
  nextMilestone: number; // for goal-gradient "X to go"
  unit: string;
}

// A node on the development path (goal-gradient milestone ladder).
export interface LevelMilestone {
  level: number;
  title: string;
  xpThreshold: number; // cumulative XP to reach this node
  reached: boolean;
  current: boolean;
}

// "You vs. Past You" — SDT relatedness without a toxic leaderboard.
export interface ComparisonRow {
  key: string;
  label: string;
  unit: string;
  direction: "higher" | "lower";
  now: number | null;
  then: number | null;
  delta: number | null;
  improved: boolean | null;
}

export interface RadarPoint {
  metric: string;
  label: string;
  current: number; // 0..100, this block
  career: number; // 0..100, all-time
}

// A game aligned to a Career-Trend data point (index) — powers the recent-games
// grid beside the trend and the click-a-point → open-that-game panel.
export interface TrendMatch {
  index: number;
  matchId: string;
  champion: string | null;
  queue: string | null;
  win: boolean | null;
  kills: number;
  deaths: number;
  assists: number;
  process: number;
  verdict: Verdict;
  playedAt: string;
}

export interface ProgressResponse {
  hasData: boolean;
  totalGames: number;
  metrics: MetricMeta[];
  series: MetricSeriesPoint[];
  matches: TrendMatch[];
  insights: Insight[];
  blocks: BlockSummary[];
  calendar: DayActivity[];
  streaks: StreakStat[];
  radar: RadarPoint[];
  lpTimeline: {
    index: number;
    date: string;
    cumulativeLp: number;
    leaguePoints: number | null;
  }[];
  personalBests: { label: string; value: string; when: string; matchId: string }[];
  levelPath: LevelMilestone[];
  pastComparison: ComparisonRow[];
  pastComparisonWindow: number;
}

// ---- Champion mastery -----------------------------------------------------

export interface MatchupStat {
  opponent: string;
  games: number;
  wins: number;
  winRate: number;
  avgGoldDiff15: number | null;
  avgProcess: number; // your average performance score vs this opponent
}

// One of the player's stats measured against the rank-average benchmark, used
// to sort into "doing well" (better than average) vs "needs work".
export interface StatComparison {
  key: string;
  label: string;
  value: number | null;
  benchmark: number;
  unit: string;
  direction: "higher" | "lower";
  better: boolean; // is the value better than the benchmark?
  pct: number; // 0..100 bar of value relative to benchmark (capped)
}

export interface ChampionDetail {
  champion: string;
  role: Role;
  availableRoles: Role[]; // roles this champ has been played in (for the role toggle)
  activeRole: Role | null; // the role this view is sliced to (null = all roles)
  track: ChampionTrack;
  tier: PoolTier | null;
  games: number;
  wins: number;
  winRate: number;
  netLp: number;
  avgProcess: number;
  kda: { k: number; d: number; a: number; ratio: number };
  avgCs10: number | null;
  avgDeathsBefore15: number | null;
  avgFirstDeathSec: number | null;
  avgGoldDiff15: number | null;
  trend: { index: number; date: string; process: number; cs10: number | null; win: boolean | null }[];
  matchups: MatchupStat[];
  suggestedGoals: RecommendedGoal[];
  // one-sheet extras
  playstyle: { label: string; tone: "good" | "neutral" | "bad"; hint: string }[]; // data-driven playstyle tags (hint explains what earned it)
  strengths: string[]; // what the player does well on this champ
  improvements: string[]; // what to work on
  comparison: StatComparison[]; // per-stat vs rank average
  comparisonRank: string; // the rank the averages are drawn from
  phases: { phase: string; label: string; value: string; score: number; hint: string }[]; // early/mid/late
  recentMatches: EnrichedMatch[]; // this champ's games, newest first
}

// ---- Full-match scoreboard (iTero-style match detail) ---------------------

export interface ScoreboardPlayer {
  champion: string;
  name: string;
  tagLine: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  damageTaken: number;
  cs: number;
  gold: number;
  wards: number;
  visionScore: number;
  level: number;
  role: Role;
  team: "BLUE" | "RED";
  win: boolean;
  isMe: boolean;
  items: number[]; // item0..item5 (0s dropped) — core build, minus the trinket
  trinket: number; // item6, the trinket/ward slot (0 if empty)
  spells: number[]; // [summoner1Id, summoner2Id]
  keystoneIcon: string | null; // full URL to the keystone rune icon
  secondaryStyleIcon: string | null; // full URL to the secondary path icon
}

export interface MatchScoreboard {
  found: boolean;
  players: ScoreboardPlayer[];
  durationSec: number;
  version: string; // Data Dragon version, for building item/spell asset URLs
  platform: string; // platform of the match — where a clicked player lives
  error: string | null;
}

// Per-minute series for all ten players — powers the over-time graphs.
export interface TimelineParticipant {
  champion: string;
  name: string;
  team: "BLUE" | "RED";
  isMe: boolean;
}
export interface TimelineFrame {
  minute: number;
  gold: number[]; // index-aligned to participants
  xp: number[];
  cs: number[];
}
export interface MatchTimeline {
  found: boolean;
  participants: TimelineParticipant[];
  frames: TimelineFrame[];
  version: string; // Data Dragon version, for champion icons in the toggles
  error: string | null;
}

// ---- Achievements ---------------------------------------------------------
export interface Achievement {
  id: string;
  name: string;
  description: string; // what earns it
  category: string; // "Combat" | "Farming" | "Objectives" | ...
  icon: string; // tabler icon name
  unit: string;
  value: number; // current cumulative / record value
  tiers: number[]; // ascending thresholds
  tierNames: string[]; // "Bronze".."Challenger" per threshold
  tier: number; // count of thresholds cleared (0 = not started)
  nextTarget: number | null; // next threshold to hit (null = maxed)
  pct: number; // progress toward the next tier (0-100; 100 if maxed)
  started: boolean; // value > 0
  xp: number; // XP this achievement currently contributes to Profile Level
  nextTierXp: number; // XP the next tier would add (0 if maxed)
}
export interface AchievementsResponse {
  found: boolean;
  total: number;
  unlocked: number; // achievements at tier >= 1
  maxed: number; // achievements at top tier
  categories: string[];
  achievements: Achievement[];
  // Account "mastery rank" — achievement tiers feed XP into a single level.
  level: number;
  xp: number; // total XP earned
  xpIntoLevel: number; // XP earned toward the current level
  xpForNext: number; // XP the current level needs to reach the next
  levelPct: number; // 0-100 progress to the next level
}

// ---- Notifications --------------------------------------------------------
// A thing you accomplished, detected by diffing career state after games read
// in: an achievement tier-up, a profile level-up, or a goal completion.
export interface NotificationItem {
  id: string;
  type: "achievement" | "level" | "goal";
  title: string; // "Achievement leveled up"
  body: string; // "Hard Carry — reached Gold"
  icon: string; // tabler icon name
  accent?: string; // optional color hint (tier color, gold for level, etc.)
  link?: string; // deep-link to the exact item, e.g. /achievements?focus=<id>
  createdAt: string; // ISO
  read: boolean;
}
export interface NotificationsResponse {
  items: NotificationItem[];
  unread: number;
}

// ---- DPM-Lens-style stats page -------------------------------------------
export interface StatLadderPoint {
  rank: string; // "Gold"
  value: number;
  isYou?: boolean; // your value slots between ranks (marker)
}
export interface StatTile {
  key: string;
  label: string;
  value: number | null;
  unit: string; // "", "%", "g", "s"…
  benchmark: number;
  direction: "higher" | "lower";
  better: boolean;
  pct: number; // 0-100 position vs benchmark (bar fill)
  ladder: StatLadderPoint[] | null; // per-rank ladder when we have cohort data
  hint: string;
}
export interface StatDomain {
  key: string;
  label: string;
  icon: string; // tabler icon name
  score: number; // 0-100, avg of child tiles vs benchmark
  weakest: boolean; // the "skill to improve" domain
  tiles: StatTile[];
}
export interface StatsResponse {
  found: boolean;
  composite: number; // 0-100 headline score
  rank: string; // comparison rank label ("Gold", "ARAM avg")
  games: number;
  queue: string;
  role: string | null;
  roles: string[]; // roles present in the data, for the role filter
  domains: StatDomain[];
}

// LLM-graded build + draft breakdown for a single game.
export interface DraftEval {
  score: number; // 0-100, how strong this team's composition is
  label: string; // one/two-word verdict, e.g. "Well-rounded", "No frontline"
  notes: string[]; // 2-4 short observations
}
export interface MatchAnalysis {
  found: boolean;
  champion: string | null;
  buildScore: number; // 0-100, how good your item build was for this game
  buildVerdict: string; // short verdict, e.g. "Standard & adapted"
  buildNotes: string[]; // what was good / missing (incl. vs the enemy comp)
  myTeam: DraftEval;
  enemyTeam: DraftEval;
  matchup: string; // one line: which draft is favored and why
  generatedBy: "llm" | "fallback";
  error: string | null;
}

export interface NextGameBriefing {
  champion: string | null;
  rationale: string;
  role: Role | null;
  poolTier: PoolTier | null;
  recommendedBan: { champion: string | null; reason: string | null };
  matchupFocus: { champion: string | null; reason: string | null };
  mastery: {
    games: number;
    winRate: number;
    avgProcess: number;
    avgCs10: number | null;
    avgGoldDiff15: number | null;
    avgDeathsBefore15: number | null;
    avgFirstDeathSec: number | null;
    netLp: number;
  } | null;
  buildNotes: { label: string; note: string }[];
  objectiveChecklist: string[];
}

// ---- Retro auto-draft -----------------------------------------------------

export interface RetroDraft {
  whatWorked: string;
  whatBroke: string;
  keepDoing: string;
  stopDoing: string;
  nextBlockFocus: string;
}

// ---- Tuning (the knobs) ---------------------------------------------------

export interface Tuning {
  verdictGood: number;
  verdictBad: number;
  benchmarks: Record<string, number>;
}

// ---- Config ---------------------------------------------------------------

export interface AppConfig {
  riotConfigured: boolean;
  gameName: string | null;
  tagLine: string | null;
  platform: string | null;
  activeSeasonId: string | null;
  demoMode: boolean;
  // Session grouping: a gap larger than this starts a new session.
  sessionGapMinutes: number;
}

// ---- Dashboard aggregate (computed, returned to the web app) --------------

export interface TrendPoint {
  index: number; // game number within scope
  playedAt: string;
  cumulativeLp: number;
  process: number;
  processAvg: number; // trailing moving average
  win: boolean | null;
  verdict: Verdict;
  champion: string | null;
}

export interface ChampionStat {
  champion: string;
  tier: PoolTier | null;
  games: number;
  wins: number;
  winRate: number;
  avgProcess: number;
  netLp: number;
  personalTier: "S" | "A" | "B" | "C" | "D"; // how well THIS champ performs for you
  form: "up" | "down" | "flat"; // recent process trend on this champ
  kda: number; // (k+a)/max(1,d)
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgCs: number; // total CS per game
  csPerMin: number;
  masteryLevel: number; // champion-track level (replaces app levels)
  masteryRank: string; // "Adept", "Virtuoso", …
  role: Role;
}

export interface SplitStat {
  key: string;
  games: number;
  wins: number;
  winRate: number;
  avgProcess: number;
  netLp: number;
}

export interface DeathCauseStat {
  cause: DeathCause;
  count: number;
}

export interface DashboardResponse {
  season: Season | null;
  identity: Identity | null;
  pullRemaining?: number; // games queued but not yet fetched (drives the pull banner)
  focusChampion: { champion: string | null; rationale: string | null };
  briefing: NextGameBriefing | null;
  gamesLogged: number;
  target: number;
  level: LevelState;
  record: { wins: number; losses: number; netLp: number };
  verdictCounts: Record<Verdict, number>;
  avgProcess: number;
  trend: TrendPoint[];
  champions: ChampionStat[];
  roles: SplitStat[];
  sides: SplitStat[];
  deathCauses: DeathCauseStat[];
  quests: QuestProgress[];
  weeklyQuests: QuestProgress[];
  badges: Badge[];
  sessions: SessionSummary[];
  currentSession: SessionSummary | null;
  borrowedLp: {
    borrowed: boolean;
    lpSlope: number;
    processSlope: number;
    window: number;
    message: string | null;
  };
  goodBlock: { goodBlock: boolean; processSlope: number; message: string | null };
  goals: GoalProgress[];
  rollingQuests: RollingQuest[];
  recommendation: Recommendation;
  recentMatches: EnrichedMatch[];
  insights: Insight[];
  profile: ProfileSummary;
  statBoard: StatCard[];
}

// ---- Tracker-style profile + stat board (PRD glance cards) ----------------

export interface ProfileSummary {
  gameName: string | null;
  tagLine: string | null;
  platform: string | null;
  tier: string | null;
  division: string | null;
  leaguePoints: number | null;
  rankQueue: string; // which queue the shown rank is for: "Solo/Duo" | "Flex"
  masteryLevel: number; // total champion-mastery level across the pool
  masteryTitle: string; // e.g. "Renekton Adept" — your most-mastered champ
  topChampion: string | null;
  wins: number;
  losses: number;
  winRate: number;
  games: number;
}

// A single "glance" stat card: value vs a baseline, with a directional arrow.
// The atomic unit the PRD builds the composable board out of.
export interface StatCard {
  id: string;
  label: string;
  unit: string;
  value: number | null;
  valueFmt: string;
  baseline: number | null; // prior-window value (the baseline it's compared to)
  delta: number | null; // value - baseline
  direction: "higher" | "lower"; // which way is better
  better: boolean | null; // is the current value better than the baseline?
  hint: string;
  href: string | null;
  series: number[]; // per-game values over the recent window, for a sparkline
}

// ---- The coach: your next-game plan --------------------------------------

// One concrete, measurable thing to do in the NEXT game.
export interface CoachDirective {
  title: string; // "Farm to 70 CS by 10 minutes"
  why: string; // rationale, citing the data
  metricLabel: string; // which stat this maps to, e.g. "CS@10"
  target: string; // "70+" / "≤2" / "60%"
  tone: "good" | "bad" | "neutral";
}

export interface NextGamePlan {
  headline: string; // the one-line "here's what's next"
  directives: CoachDirective[]; // 1–3 goals for the next game
  championCall: {
    champion: string | null;
    role: string | null;
    line: string; // one-liner on why this pick
  };
  mentalNote: string; // tilt / session / queue-discipline guidance
  generatedBy: "llm" | "heuristic";
  generatedAt: string;
  basedOnGames: number;
}

// A data-driven observation about how you actually win/lose. Clickthroughs to
// the page where the user can dig in.
export interface Insight {
  id: string;
  tone: "good" | "bad" | "neutral";
  icon: string; // tabler icon name
  title: string; // the headline stat
  detail: string; // the so-what
  href: string | null; // route to drill in, e.g. "/progress"
}

// ---- Champion progression (replaces app levels) ---------------------------
//
// Leveling is per-champion now: each champ has a set of Eternals-style tiered
// milestones. Clearing tiers raises that champion's mastery level and rank. The
// player levels up the champions they actually play, not an abstract account.

export interface ChampionMilestone {
  id: string;
  label: string; // "Solo kills", "Flawless openings"
  unit: string;
  tiers: [number, number, number]; // the three tier thresholds
  value: number; // current value (cumulative or best, per milestone)
  tierIndex: number; // 0..3 tiers cleared
  nextTarget: number | null; // next threshold, null when maxed
  pct: number; // 0..100 toward the next tier
  detail: string; // human-readable current state
  tone: "good" | "neutral";
}

export interface ChampionTrack {
  champion: string;
  role: Role;
  games: number;
  level: number; // sum of tiers cleared across milestones
  maxLevel: number; // 3 * milestone count
  rank: string; // derived title (Initiate … Virtuoso)
  pct: number; // level / maxLevel * 100
  milestones: ChampionMilestone[];
  nextUp: ChampionMilestone | null; // closest milestone to its next tier
}

// ---- Champion context (LLM-generated meta, cached per patch) ---------------

export interface ChampionMeta {
  champion: string;
  role: string;
  tier: string; // patch tier: "S", "A", "B", …
  difficulty: string; // "Low" | "Medium" | "High"
  summary: string; // one-line playstyle
  strengths: string[];
  weaknesses: string[];
  powerSpikes: string[];
  goodInto: string[]; // favorable matchups
  strugglesInto: string[]; // hard matchups
  synergies: string[]; // duos / supports / comp fit
  winConditions: string[];
  // How-to-play tips (optional — present on metas generated after tips shipped).
  combos?: string[]; // ability combos, short
  positioning?: string; // one line on teamfight positioning
  playRatings?: { aspect: string; rating: number }[]; // 1–5 on push / teamfight / objectives / picks
  patch: string;
  generatedBy: "llm" | "fallback";
  generatedAt: string;
}

// ---- Block review (stacked games + obvious progression) -------------------

export interface BlockProgressPoint {
  index: number; // game number within the block
  playedAt: string;
  process: number;
  processAvg: number; // trailing average
  win: boolean | null;
  champion: string | null;
}

// A stat's block average vs the games before the block started — the "what got
// better this block" readout.
export interface BlockStatGain {
  key: string;
  label: string;
  unit: string;
  before: number | null;
  after: number;
  delta: number;
  better: boolean;
}

export interface BlockReview {
  season: Season;
  isActive: boolean;
  games: number;
  target: number;
  wins: number;
  losses: number;
  winRate: number;
  netLp: number;
  avgProcess: number;
  startProcess: number | null; // avg of first third
  recentProcess: number | null; // avg of last third
  goals: GoalProgress[];
  progression: BlockProgressPoint[];
  champions: ChampionStat[];
  matches: EnrichedMatch[];
  statGains: BlockStatGain[];
}

// ---- Coach-drafted block (from a pitch) -----------------------------------

export interface BlockGoalSpec {
  templateId: string;
  target?: number;
  champion?: string | null;
  baseline?: number | null;
}

// A drafted goal with everything needed to show it richly (sentence + criteria
// + a baseline→target bar) and to create it.
export interface ProposedGoal {
  templateId: string;
  title: string;
  description: string; // full sentence
  whatCounts: string | null; // the per-game criteria
  category: GoalCategory;
  unit: string;
  direction: "higher" | "lower";
  target: number;
  baseline: number | null;
  champion: string | null;
}

export interface BlockPlanProposal {
  name: string;
  theme: string;
  goal: string;
  rationale: string; // the coach's read on why these goals, citing baselines
  blockType: BlockType;
  targetGames: number;
  focusChampion: string | null;
  identityId: string;
  focus: string;
  goals: ProposedGoal[];
}

// ---- Block quick-cards (the Blocks page grid) -----------------------------

export type BlockImageryKind =
  | "champion"
  | "objectives"
  | "vision"
  | "survival"
  | "farm"
  | "carry"
  | "general";

export interface BlockGoalLeft {
  title: string;
  current: number | null;
  target: number;
  direction: "higher" | "lower";
  unit: string;
  pct: number;
  met: boolean;
}

export interface BlockCardSummary {
  season: Season;
  isActive: boolean;
  games: number;
  target: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProcess: number;
  goalsMet: number;
  goalsTotal: number;
  goals: BlockGoalLeft[];
  imagery: { kind: BlockImageryKind; champion: string | null };
}

// ---- Summoner search (read-only lookup of any Riot ID) --------------------

export interface SummonerProfile {
  gameName: string;
  tagLine: string;
  platform: string;
  found: boolean;
  level: number | null;
  profileIconId: number | null;
  tier: string | null;
  division: string | null;
  leaguePoints: number | null;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  aramMode: boolean; // most of their recent games are ARAM
  statBoard: StatCard[];
  champions: ChampionStat[];
  recentMatches: EnrichedMatch[];
  rateLimited: boolean;
  error: string | null;
}
