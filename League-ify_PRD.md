# League-ify — Product Requirements Document

**A stats-digestion app for League of Legends**
Draft v0.2 · Owner: dhole · Date: 2026-07-05

---

## 0. The one-paragraph version

League-ify turns the firehose of League match data into something you can actually *digest*. Every tracker on the market — DPM.LOL, OP.GG, LoL Rewind, iTero, and the Halo equivalents (Spartan Record, Halo Data Hive, Tracker.gg, Waypoint) — organizes stats into a fixed tree of tabs and panels that you navigate by clicking. League-ify inverts that. There is **one composable board**. You pick the stats you care about, promote any one of them to a large "focus" panel, and the app automatically surrounds it with the smaller panels that give it meaning — its breakdown, its comparison to your rank, its trend over time, its correlated stats. No tab-drilling. The tree still exists underneath as data; it's just no longer the interface.

---

## 1. Why this exists

### 1.1 The problem with existing trackers

The reference apps are all excellent at *collecting* data and mediocre at *digesting* it. Two failure modes recur:

**Fixed navigation.** DPM.LOL's "DPM Lens" is the clearest example. It has a COMPARE / MY PROGRESS toggle, a timeframe filter, a queue filter, seven top-level tabs (Overview, Fighting, Laning Phase, Objectives, Vision, Survivability, Adaptability, Team Impact), and *inside each tab* a column of sub-panels (Duels, Skirmishes, Teamfights, Mechanics…) each of which opens a stat grid with a rank-comparison chart. To answer "how's my early game across farming, first-bloods, and deaths," you traverse three separate tabs and lose the first two the moment you open the third. The information architecture is optimized for the shape of the data, not the shape of a question.

**Density without hierarchy.** At the other extreme, Halo Data Hive, LoL Rewind, and iTero dump *everything* onto one enormous scroll — dozens (iTero: literally 100+) of stats stacked vertically. Nothing is prioritized, nothing is comparable side-by-side unless the designer happened to place them together, and there's no way to say "these six numbers are what I care about; show me those." iTero partly redeems this with an excellent **drill-in** (Section 4.5) — but you still start from an undifferentiated wall of numbers.

Neither model lets the player *compose their own view*. That's the gap.

### 1.2 The insight from the references

Reviewing all of them side by side, the actual atomic unit across every app is the same thing: **a stat, shown against a baseline, optionally broken down by a dimension.** DPM shows KP vs rank-average as a bar ladder. OP.GG shows win rate vs "recent 13 games." LoL Rewind shows win rate *conditioned on* "when my team has champion X." Halo Data Hive shows damage/game as a trend line vs a rolling average. These look like different features. They are the same feature with different baselines and dimensions. If we model the stat as a first-class object with metadata — what it measures, what baselines it supports, what it breaks down by, and what it rolls up into — then every screen in every reference app becomes a *composition* rather than a hand-built page.

That realization is the whole product.

### 1.3 "Digestion," specifically

The name matters. This is not a stats *browser*; it's a stats *digester*. Two implications:

1. **Composability** (interactive): the board described above.
2. **Summarization** (passive): the app should be able to hand you the notable stuff without you asking — a post-game card, an end-of-session recap, a weekly digest — by automatically picking the stats that moved the most against their baselines.

---

## 2. Goals & non-goals

### 2.1 Goals

- Let a player assemble a **personal board** of the stats they care about, with no fixed tabs to navigate.
- Support a **focus + satellites** interaction: promote one stat to a big panel and auto-surface its supporting mini-panels.
- Unify every comparison the reference apps make (**vs rank, vs past self, vs team, vs pro/OTP, vs friend, conditional**) under a single switchable "baseline" control.
- Cover the **full breadth of League stats** the references track — not just DPM's tree, but OP.GG's ranked/synergy data, Rewind's conditional win rates, and DPM.LOL's vanity records.
- Auto-generate **digests** (post-game / session / weekly) that summarize what changed.
- Surface **actionable insight** ("your weakest area vs your rank is X; here's the evidence").

### 2.2 Non-goals (for now)

- Real-time in-game overlay / live coaching during a match. (Live-game *preview* is in scope; live *coaching* is not.)
- Being an official Riot product or using anything beyond the public Riot API + derived data. We inherit the same "not endorsed by Riot" posture as DPM/OP.GG.
- Team/scrim analytics for orgs (the Halo Data Hive "Community Series / Team Comparison" use case). Interesting later; out of MVP.
- Betting, matchmaking, or account-boosting features.

### 2.3 Explicitly *not* DPM-centric

The DPM Lens taxonomy is the richest single source of *what League stats are worth tracking*, so we mine it heavily for the metric catalog (Section 7). But it is **one input, not the skeleton**. The board model, the comparison abstraction, and the digest layer come from stepping back across all the references. Where this doc uses DPM's category names, treat them as a starting vocabulary for the metric registry, not as the app's navigation.

---

## 3. Users & jobs-to-be-done

### 3.1 Primary persona — "the improver"

A ranked player (Iron→Diamond) who wants to climb and suspects their data knows why they aren't. They don't want a data-science project; they want the two or three things to fix. Job: *"Tell me what's holding me back and let me watch it move."*

### 3.2 Secondary persona — "the tinkerer"

A systems-minded player who enjoys the data itself, wants to slice it their own way, and finds fixed dashboards infuriating because they can never see the two numbers they want next to each other. Job: *"Let me build the exact view I keep in my head."*

### 3.3 Tertiary persona — "the vibes / vanity player"

Mostly-ARAM / normals player who isn't grinding rank but loves the fun records — snowballs hit, poros fed, pentakills, longest game, "who I keep dying to." Job: *"Show me the fun story of how I play."* (Served by DPM.LOL's ARAM/records surface and the challenges layer.)

These three map onto three default board presets (Section 6.6).

---

## 4. Core concept: the composable board

### 4.1 The unit: a Stat Card

Everything on the board is a **Stat Card**. A card renders one stat at one of three sizes:

- **Small (glance):** the value + a directional arrow (green up / red down) showing whether you're above or below the current baseline. This is the DPM sub-stat tile (e.g. "KP 47.10 ▲").
- **Medium (compare):** the value plus one comparison visual — a rank ladder, a team bar, or a sparkline trend.
- **Large (focus):** the value plus a full comparison view *and* auto-generated **satellite** cards around it (see 4.3).

Any card can be resized. Promoting a card to Large is the interaction that replaces "clicking into a tab."

### 4.2 The Quick Stats board

The board is a responsive grid the user composes: add cards, remove cards, drag to reorder, resize. This is the direct answer to *"customize which ones to include in some kind of quick stats panel."* State persists per user (and per board — a user can have several).

### 4.3 Focus + satellites (the key mechanic)

When a card is promoted to **Large / focus**, League-ify auto-populates **satellite mini-cards** around it, derived from the focused stat's metadata relationships:

- **Children** — the stats that roll up into it. Focus "Fighting" (a category score) → satellites are KP, DMG/m, Duels win rate, Teamfight win rate, Mechanics, etc. Focus "Farming" → CS@5/@10/@15, Gold missed@5/@10/@15.
- **Comparisons** — the same stat rendered against each available baseline (rank ladder, team bar, your-trend line). This is DPM's "any stat visually compared to each rank" chart, but generated, not per-stat hand-built.
- **Correlates / conditionals** — related stats and Rewind-style conditional cuts ("your KP when behind," "win rate after this stat is high").

The result is exactly the user's described layout — *"the big panel you choose has the little panels that represent the data shown alongside it"* — but the little panels are computed from relationships rather than authored per screen. Focus is reassignable in one click: promote any satellite and the constellation recomposes around it.

> **Design north star:** DPM's Overview already draws a radial "constellation" of stat icons around a central score (68.6). Today it's decorative. League-ify makes that constellation the actual, interactive, reconfigurable interface.

### 4.4 What this replaces

| Reference pattern | League-ify equivalent |
|---|---|
| DPM tabs (Fighting, Vision, …) | Category **score cards** you can pin; focusing one reveals its children as satellites |
| DPM sub-panels (Duels, Skirmishes…) | Child stat cards; no separate click-through |
| DPM rank-ladder chart | The "vs rank" **baseline** on any card |
| OP.GG recent-games donut | A "vs recent N games" baseline + a win-rate donut card |
| LoL Rewind conditional tables | **Conditional stat** cards (Section 7.6) |
| Halo Data Hive trend charts | The "vs past self / progression" **baseline** as a trend card |
| Tracker.gg lifetime grid | A default preset board of small cards |
| iTero stat drill-in | Promoting a card to **focus** (Section 4.5) |

### 4.5 Validation: iTero's drill-in is focus + satellites

iTero independently arrived at most of this model, which is the best evidence it's the right one. When you click any of its 100+ stats, it opens a detail view that is — in League-ify's vocabulary — a **focus card with a fixed satellite set**:

- A **50-game rolling-average line chart**: your per-game *Account Average* line vs an *Elo Average* line. → In our model this is the **"vs past self (progression)"** baseline *and* the **"vs rank"** baseline rendered on the same trend card.
- Three summary tiles: **Account Average**, **Elo Average**, **Percentile**. → Percentile is a first-class comparison *output* we should adopt everywhere (Section 5): not just "above/below rank," but *where* in the distribution you land.
- Below it, an **OP.GG-style match table** — matchup, W/L, queue, length, date, summoners, runes, items, KDA, CSM, GPM, and **the selected stat pinned on the far right**. → This is our match list (FR-17) filtered to the focused stat, i.e. "show me the games behind this number."

iTero's whole app is essentially one giant version of the mechanic we're generalizing: a flat catalog + a strong drill-in. League-ify keeps the strong drill-in, throws away the flat catalog as the *primary* surface, and lets the user pin the numbers they actually care about into a board. The catalog still exists — as the searchable stat library (Section 7 / Appendix A), one of several ways to add a card, not the front door.

**Adopt from iTero specifically:** Percentile as a standard comparison output; the "selected stat pinned to the match table" view as the default drill-in for any focus card; the Elo-Average line as the concrete implementation of the rank baseline on trend charts.

---

## 5. The comparison model (baselines)

Every comparison in every reference app is the same operation — *this stat, against some reference set* — so League-ify treats **baseline** as a switchable property of a card, not a separate page. DPM buries this in a COMPARE/MY-PROGRESS toggle plus a "vs Grandmaster / vs Pros or OTPs" dropdown. We generalize it into one control available on every card:

| Baseline | Source pattern | Renders as |
|---|---|---|
| **vs Rank average** | DPM's Iron→Challenger ladder; iTero's "Elo Average" line | Bar ladder or trend line with your value marked; green/red arrow vs *your current* rank |
| **vs Past self (progression)** | Halo Data Hive trend charts, LoL Rewind by-patch | Trend line with rolling average; delta between "first games" and "recent games" |
| **vs Team** | DPM "all visual comparisons are bars compared to team" | Horizontal bar, your share vs teammates |
| **vs Pro / OTP** | DPM "VS Pros or OTPs" field | Ladder/marker against a chosen pro's or one-trick's averages |
| **vs Friend** | OP.GG "recently played with," Halo "Compare" | Side-by-side card, you vs a named account |
| **vs Recent N games** | OP.GG recent-13 donut | Value over a sliding window vs lifetime |
| **Conditional** | LoL Rewind "when my team has X, we win Y%" | Segmented value across a condition (Section 7.6) |

**Requirement:** a stat's metadata declares which baselines it supports (not all stats support all baselines — a vanity record like "poros fed" has no rank ladder). The card's baseline switcher only offers valid ones.

**Comparison outputs.** Whatever the baseline, a card can express the comparison three ways (adopted from iTero's summary tiles): the raw **Account Average**, the **baseline value** (e.g. Elo Average), and the **Percentile** — where you fall in the distribution, either within your current rank or across the whole ladder. Percentile is the most legible single number for the Improver persona and should be available on every card that supports the rank baseline.

**Global filters** apply across the whole board, so setting one re-renders every card at once — you never re-set it per panel the way DPM makes you. The full set, unioning DPM and iTero:

- **Queue** — Ranked Solo, Ranked Flex, Draft/Normal, ARAM, Arena.
- **Role** — Top, Jungle, Mid, Bot/ADC, Support.
- **Champion.**
- **Timeframe / season / patch.**
- **Game stage** — iTero's minute buckets **0–7 / 7–14 / 14–21 / 21–28 / 28+**. A finer-grained version of DPM's early/mid/late; lets any stat be sliced by game phase, not just the ones that ship pre-split.
- **Game state** — iTero's **Overall / Ahead / Even / Behind** (your gold/XP position vs the enemy laner or team). This is a cross-cutting *conditional* filter: "show all my stats, but only from games where I was behind" generalizes DPM's siloed "When Behind" panel into a lens over the entire board.
- **Stat-category tag** — filter the stat library by iTero's tags: **Resource, Combat, Objective, Vision** (League-ify extends with **Team/Macro, Behavioral, Derived**). Used for searching/adding cards, not for board layout.

Plus free-text **search by stat name** (iTero) as the primary way to find and add a card from the catalog.

---

## 6. Feature areas

### 6.1 Player profile & identity

Riot ID (name#tag) + region lookup, à la OP.GG/DPM. Account linking ("Link with your Riot account"), profile claim, favorite/pin accounts, "last updated / up to date" freshness indicator with manual refresh. Level, icon, current rank & LP per queue, peak rank (Tracker.gg "Peak Rating"), season history.

### 6.2 The board (Section 4) — the centerpiece

Composable Quick Stats board; add/remove/resize/reorder cards; focus + satellites; multiple saved boards; presets (6.6).

### 6.3 Match history & the single match

A clean, scannable match list (OP.GG / Tracker.gg / DPM.LOL overview): per-match KDA, KDA ratio, CS, champion, queue, result, duration, timestamp, items, summoners, and **performance badges** (OP.GG's MVP / Unstoppable / Double-Triple-Quadra-Penta / "Struggle" / "Lucky/Unlucky", DPM's per-game "DPM Score"). Group by day/session (DPM.LOL groups "04 Jul #3," "03 Jul #1"…). Expand a match into a detail view (scoreboard, damage, timeline, objectives) — the one place a "drill in" genuinely makes sense.

### 6.4 Progression & trends

Time-series for any stat (Halo Data Hive "Progression Charts," LoL Rewind "by patch"): rolling averages, streak markers, consistency bands, "first games vs recent games" deltas (the fatigue/variance idea from DPM's Adaptability). Rank/LP-over-time graph.

### 6.5 Insight & "skill to improve"

An insight engine that ranks your stats by delta-from-baseline and surfaces the biggest gaps as insight cards — a generalization of DPM's "SKILL TO IMPROVE" flag on the weakest category. Feeds both the board (a pinnable "Focus areas" card) and the digests (6.7). Also surfaces behavioral patterns from the Adaptability data: tilt after loss streaks, session fatigue, time-of-day win rate.

### 6.6 Presets & customization

Ship default boards mapped to the personas: **Climber** (weakest areas, rank comparisons, laning + deaths), **Tinkerer** (empty canvas + full card catalog + conditional builder), **Vibes** (fun records, ARAM, challenges). Per-role presets (a jungler's default board ≠ a support's). Users clone and edit presets into their own boards. Theming/appearance.

### 6.7 Digests & notifications ("digestion")

Auto-composed summaries: **post-game** (what stood out this game vs your averages), **session-end** (fatigue/variance recap — directly enabled by the Adaptability metrics), **weekly** (biggest movers, rank progress, a fun record or two). Delivered in-app and optionally scheduled/pushed. This is where the app earns "digestion" as a verb.

### 6.8 Goals & challenges

A light gamification layer modeled on Waypoint's daily/weekly challenges and Halo's battle-pass XP: user- or system-set goals ("get CS@10 above the Gold average," "reduce solo deaths"), streaks, and progress bars. Turns insights into trackable objectives.

### 6.9 Fun records & vanity stats

The DPM.LOL ARAM/records surface: most kills/deaths/assists, most damage, longest game, best KDA game, skillshots hit, gold earned, heal-from-map, summoners casted, items bought, pentakills, plus quirky per-mode counters (porosnax, snowballs, poro explosions). Games-by-day activity heatmap. These are first-class stats with the "vanity" flag (no rank baseline), and they anchor the Vibes preset and weekly digest.

### 6.10 Social & synergy

OP.GG "recently played with" and DPM.LOL duo W/L; LoL Rewind's relational tables ("my {champ}'s popping off / trolling me," teammate and matchup win rates). Friends list, head-to-head compare (Halo "Compare"), duo synergy stats.

---

## 7. The metric registry (what we track)

This is the keystone data asset: a registry where **every stat is a first-class object** with metadata. The DPM Lens tree is the richest source for the League metric list, so it's captured in full below — but note it's living here as *catalog*, not as navigation.

### 7.1 Stat definition schema

Each stat carries:

- `id`, `display_name`, `description`, `unit` (%, per-min, count, gold, mm:ss…)
- `domain` (Fighting, Laning, Objectives, Vision, Survivability, Adaptability, Team Impact, Meta/Vanity, Social)
- `category_tag` (iTero-style: Resource / Combat / Objective / Vision / Team-Macro / Behavioral / Derived) — used for library filtering & search
- `riot_source` — the underlying Riot API field(s) or derivation this maps to (Section 10 / Appendix A)
- `phase` (early / mid / late / whole-game) and `game_stage_sliceable` (can this be cut by the 0–7/7–14/14–21/21–28/28+ buckets?)
- `game_state_sliceable` (can this be cut by Ahead / Even / Behind?)
- `rollup_parent` (which score it feeds) and `is_score` (aggregate?) + `children`
- `baselines_supported` (subset of Section 5) and `percentile_available` (bool)
- `dimensions` it can break down by (champion, role, queue, patch, teammate, opponent, time-of-day…)
- `direction` (higher-is-better / lower-is-better — deaths and gold-missed invert the arrow)
- `flags` (vanity, conditional, derived)

### 7.2 Scores (aggregates)

Each domain has a 0–100 **score** = weighted aggregate of its children, benchmarked to rank percentile (DPM shows Vision 93, Fighting 78, Adaptability 70, Laning 69, Survivability 67, Team Impact 63, Objectives 38, and a composite 68.6). Scores are pinnable cards; focusing one reveals its children as satellites (4.3). Weighting is configurable and versioned.

### 7.3 Fighting

**General:** Kill Participation, DMG/min, DMG taken, DMG/min early/mid/late, Triples, Quadras, Pentakills. **Duels (1v1):** total, win rate, % of fights, gold adv/disadv, epics killed/lost, turrets killed/lost. **Skirmishes (2v2/2v3):** win rate, % of fights, won/lost split by golds/monsters/turrets. **Teamfights (3+):** total, win rate, % of fights, won/lost by golds/monsters/towers. **Mechanics:** skillshots dodged/min, damage/kill, damage/gold, trade efficiency.

### 7.4 Laning phase

**Farming:** CS@5/@10/@15, gold missed@5/@10/@15. **First To:** first-blood contribution % + timing, first-blood-victim % + timing, first-turret contribution + timing, first-to-level-2 %, first-to-level-6 %. **Items & Golds:** 1st-item timing, 1st-item impact, team % gold, golds from K+A/CS/plates @15. **Lane Dominance:** lane trade efficiency, and @15 diffs for K+A, gold, XP, CS, ward.

### 7.5 Objectives · Vision · Survivability · Adaptability · Team Impact

- **Objectives:** Barons (killed, first, enemy killed, power-play golds/kills/turrets), Dragons (killed/game, enemy/game, soul WR, elder WR), Rift Heralds (killed %, enemy killed %, turrets taken with rift, rift "danced" count), Void Grubs (grubs/game, presence %, WR at 0/1/2/3 grubs), Turrets (killed/game, lost/game, participation %, plates/game).
- **Vision:** Vision Score/min, team ward %, blue wards placed, wards placed early/mid/late; Control Wards (placed, sold, x2 bought, gold spent); Wards Destroyed (destroyed/game, control destroyed/game, blue destroyed/game, team ward-kill %).
- **Survivability:** General Deaths (deaths/game, % time dead, deaths from ganks/dives, deaths early/mid/late, time between deaths), Teamfight Deaths (TF deaths/game, % of all deaths, death order/placement), Solo Deaths (solo/game + early/mid/late), Deaths Impact (gold diff / epics lost / turrets lost after deaths).
- **Adaptability:** Fatigue (deaths increase, solo-deaths increase, WR/vision/KP/objective-presence variance across a session), Champion Pool (unique champs, champs 5+, roles 5+), Routine (games/day, games/week, same-length sessions, hours-break), Patterns (WR by morning/afternoon/night, after 3/5/7 games, 1st game, after win/loss streak), When Behind (KP, TF WR, time-left, comeback %).
- **Team Impact:** Kills Contribution (team damage %, KP early/mid/late), Objectives Contribution (first-turret contribution, turret participation, first-elite-monster %, elite-monster participation).

### 7.6 Conditional stats (LoL Rewind class)

A distinct stat type: a value **segmented by a condition**. From Rewind: champion win rate by patch; "when my team has {champ}, we win X%"; "when my teammates play {champ}"; "when playing against {champ}"; "when I play {champ} vs {opponent}"; "my {champ} is popping off / trolling me" (over/under-performance deltas); "I like killing {champ}" / "I keep getting killed by {champ}." These power the conditional baseline (Section 5) and the Tinkerer preset's condition builder.

### 7.7 Meta / vanity / activity (DPM.LOL records class)

Records (most kills/deaths/assists/damage/damage-taken, longest match, best CS, CC time), lifetime counters (gold earned, heal-from-map, skillshots hit, enemy fountain kills, survived-at-1HP, summoners casted, items bought, pentakills), mode-specific (porosnax, snowballs hit, poro explosions), and **games-by-day heatmap**. Flagged `vanity` (no rank baseline).

### 7.8 Ranked & profile stats (OP.GG/Tracker.gg class)

Tier + LP per queue, LP history, peak rank, season records, win/loss + streaks, recent-N-games win rate, champion mastery points, per-role games & WR, "preferred role" distribution.

---

## 8. Data model (entities)

- **Player** — Riot ID, region, linked/claimed status, favorites.
- **Match** — raw match record + participants; the ingestion unit.
- **StatDefinition** — the registry entry (Section 7.1). The keystone.
- **StatValue** — a computed value of a StatDefinition for a scope (single match, or an aggregate over a window/queue/champion/role). Cached and versioned by the metric engine.
- **Baseline** — a reference dataset for comparison (rank cohort averages, a pro's aggregates, a friend's account, the player's own past window, a conditional segment). Section 5.
- **Board** — a user's saved layout; has many **Cards**.
- **Card** — references a StatDefinition (or score) + size + chosen baseline + local overrides; knows how to compute its satellites.
- **Insight** — a ranked delta-from-baseline finding; may reference a StatDefinition and evidence.
- **Goal / Challenge** — target on a StatValue with progress + streak state.
- **Digest** — a generated summary (post-game/session/weekly) = an ordered set of Insight + Card snapshots.

**Metric engine:** the service that ingests Matches, computes StatValues against the StatDefinition registry, refreshes Baselines (rank cohorts recomputed on a cadence), and exposes it all to the board. Registry-driven so a new stat = a new definition, not new UI.

---

## 9. Functional requirements (catalog)

Priority: **P0** = MVP, **P1** = fast-follow, **P2** = later.

**Profile & data**
- FR-1 (P0) Look up any player by Riot ID + region; show level, ranks, peak, freshness, manual refresh.
- FR-2 (P0) Ingest match history via Riot API; compute StatValues through the metric engine.
- FR-3 (P1) Account linking / profile claim; favorite accounts.
- FR-4 (P0) Board-level global filters: queue, timeframe/season/patch, champion, role — re-render all cards on change.

**Board & cards**
- FR-5 (P0) Composable board: add, remove, drag-reorder, resize cards; persist per user.
- FR-6 (P0) Three card sizes (glance / compare / focus) with the renders in Section 4.1.
- FR-7 (P0) Focus + satellites: promoting a card to focus auto-generates children, comparison, and correlate satellites from stat metadata.
- FR-8 (P0) Promote any satellite to focus; constellation recomposes.
- FR-9 (P1) Multiple saved boards per user; clone/rename/delete.
- FR-10 (P0) Directional arrows (green/red) honoring each stat's higher/lower-is-better direction, vs the active baseline.

**Comparison**
- FR-11 (P0) Per-card baseline switcher offering only the stat's supported baselines.
- FR-12 (P0) vs Rank ladder (Iron→Challenger), marker at player value, arrow vs current rank.
- FR-13 (P0) vs Team bar comparison.
- FR-14 (P1) vs Past-self trend (progression) with rolling average + first-vs-recent delta.
- FR-15 (P1) vs Pro/OTP and vs Friend.
- FR-16 (P2) Conditional baseline (segmented by champ/opponent/teammate/patch/time).

**Match history**
- FR-17 (P0) Scannable match list with KDA, CS, items, summoners, result, duration, queue, timestamp; grouped by day/session.
- FR-18 (P1) Performance badges (MVP, Unstoppable, multikills, Struggle, Lucky/Unlucky, per-game score).
- FR-19 (P1) Match detail view (scoreboard, damage, objectives, timeline).

**Progression, insight, digests**
- FR-20 (P1) Time-series card for any stat; streaks, consistency bands, first-vs-recent deltas.
- FR-21 (P1) Rank/LP-over-time graph.
- FR-22 (P1) Insight engine: rank stats by delta-from-baseline; "focus areas" card.
- FR-23 (P2) Behavioral-pattern insights (tilt, fatigue, time-of-day).
- FR-24 (P1) Post-game digest.
- FR-25 (P2) Session-end and weekly digests; optional scheduled delivery.

**Presets, goals, fun, social**
- FR-26 (P0) Persona presets (Climber / Tinkerer / Vibes) + per-role defaults; clone to edit.
- FR-27 (P2) Goals/challenges with progress + streaks.
- FR-28 (P1) Fun records & vanity stats surface; games-by-day heatmap.
- FR-29 (P2) Friends, head-to-head compare, duo synergy, conditional/relational tables.

---

## 10. Non-functional requirements

- **NFR-1 Data source & legality.** Public Riot API + derived data only; carry the "not endorsed by Riot" disclaimer (as OP.GG/DPM/Rewind do). Respect rate limits; queue and cache ingestion; show a freshness/"up to date" state. **The Riot API (Match-V5 timeline + participant fields, League/Summoner endpoints, and the account statistics data) is the source of truth for which fields exist** — the near-total overlap between DPM Lens and iTero's stat lists strongly implies both are 1:1 with the same Riot-provided fields plus light derivations. The metric registry (Section 7) should be *generated against current Riot API documentation* rather than hardcoded from these screenshots; Appendix A is a captured snapshot for scoping, not the schema of record. (Riot API access and field mapping are being handled in the parallel Claude Code build, so this doc treats them as a solved input.)
- **NFR-2 Performance.** Dense boards must stay fluid. Pre-compute StatValues server-side; cards read cached values. Target board render < 1s on cached data; satellite generation must not block the focus card.
- **NFR-3 Mobile-first responsiveness.** The primary user reads on mobile. The board must reflow gracefully: focus card full-width, satellites stack below; glance cards form a compact grid. Not a desktop-only dashboard shrunk down.
- **NFR-4 Registry-driven extensibility.** Adding a stat = adding a StatDefinition, no bespoke UI. New baselines and dimensions plug in generically.
- **NFR-5 Correctness & transparency.** Every stat has a plain-language description (DPM does this well — "Kill Participation shows how involved you are in kills") and a visible definition/formula on hover. Score weightings are versioned and inspectable.
- **NFR-6 Theming & accessibility.** Dark-first theme; color-blind-safe green/red arrows (pair with shape, not just hue); WCAG AA contrast.
- **NFR-7 Privacy.** Public data, but honor account-claim ownership for any private/linked features and friend comparisons.

---

## 11. Phasing

**Phase 1 — MVP (the board is the product).** Metric registry + engine + Riot ingestion (FR-1,2). Core League stat catalog (Fighting/Laning/Vision/Survivability/Objectives + ranked/profile). Composable board with three sizes and focus+satellites (FR-5–8). Rank + team baselines with arrows (FR-11–13). Global filters (FR-4). Match list (FR-17). Persona/role presets (FR-26). Mobile-responsive.

**Phase 2 — digestion & depth.** Progression/trend baseline + charts (FR-14,20,21). Insight engine + focus-areas + post-game digest (FR-22,24). Match badges + detail (FR-18,19). Fun records + heatmap (FR-28). Pro/OTP/friend baselines (FR-15).

**Phase 3 — patterns, goals, social.** Conditional/relational stats + builder (FR-16,29). Behavioral-pattern insights (FR-23). Session/weekly scheduled digests (FR-25). Goals/challenges (FR-27). Full Adaptability suite.

---

## 12. Open questions

1. **Rank-cohort baselines:** compute our own from ingested data (needs scale) or lean on an external stats source early? Affects Phase-1 feasibility of the rank ladder.
2. **Score weightings:** who owns the formula for the 0–100 domain scores, and do we expose/let users tune weights?
3. **Satellite selection:** when a focus stat has many children/correlates, what's the default set and cap before the board gets noisy? Ranking heuristic needed.
4. **Conditional stat cost:** relational cuts (Rewind-style) are combinatorially large; do we precompute common ones or compute on demand?
5. **Live game:** how far into "live preview" do we go before it becomes the out-of-scope coaching overlay?
6. **Riot API limits** at ingestion scale — the practical ceiling on freshness and history depth.

---

## Appendix A — Stat field index (snapshot)

Captured union of the fields listed across **DPM Lens** and **iTero**, plus profile/record stats from OP.GG and DPM.LOL. This is a **scoping snapshot, not the schema of record** — the metric registry (Section 7) should be generated against current Riot API docs, since the DPM/iTero overlap indicates both are ~1:1 with Riot-provided fields. Grouped by iTero-style category tag (Combat / Resource / Objective / Vision) plus the extensions League-ify adds (Survivability, Laning, Team-Macro, Behavioral, Derived, Meta/Vanity, Profile). Source key: **D** = DPM Lens · **i** = iTero · **D+i** = both · **OP** = OP.GG · **R** = DPM.LOL records.

### A.1 Combat
- **Damage output:** Total Damage Dealt (i) · Total Damage Dealt to Champions · Magic Damage Dealt to Champions (i) · True Damage Dealt to Champions (i) · DMG/min + early/mid/late (D) · Damage/Kill (D) · Damage/Gold (D)
- **Damage taken:** Total Damage Taken (i) · Magic Damage Taken (i) · Physical Damage Taken (i) · True Damage Taken (i) · DMG taken (D)
- **Kills/assists/deaths (raw):** Kills (i) · Assists (i) · Deaths (i)
- **Multikills & sprees:** Double / Triple / Quadra / Penta Kills (D+i) · Flashing-Forward Multikills (i) · Killing Spree Length (i) · Kills whilst Outnumbered (i) · Kills Near Enemy Turret (i)
- **Solo play:** Kills: Solo Kills (i) · Deaths: to Solo Kills (i)
- **Positional split (K+A):** In Lane · Out of Lane (i) · on enemy Top / Jungle / Mid / ADC / Support (i)
- **Positional split (Deaths):** In Lane · Out of Lane (i) · to enemy Top / Jungle / Mid / ADC / Support (i)
- **First blood:** Kills & Assists: First Blood (i) · Deaths: First Blood (i)
- **Fight types (DPM):** Duels — total, WR, % of fights, gold adv/disadv, epics killed/lost, turrets killed/lost · Skirmishes — WR, % of fights, won/lost by golds/monsters/turrets · Teamfights — total, WR, % of fights, won/lost by golds/monsters/towers
- **Mechanics:** Skillshots Hit (D+i) · Skillshots Dodged /min (D) · Trade Efficiency (D)

### A.2 Survivability / Deaths (DPM domain; Combat-adjacent)
- **Tempo & types:** Deaths/game · % time dead · Deaths from Ganks / Dives · Deaths Early/Mid/Late · Time between Deaths (D)
- **Death quality (iTero):** Gold Given from Deaths (i) · Deaths: Total Value (i) · Really Bad Death (i) · Deaths: with low return Damage (i)
- **Teamfight / solo:** TF Deaths/game · % of all Deaths · Death order/placement (D) · Solo Deaths/game + Early/Mid/Late (D)
- **Impact:** Gold diff / Epic Monsters lost / Turrets lost after deaths (D)

### A.3 Resource (economy, farm, XP)
- **Rates:** Gold per Minute (i) · Total XP per Minute (i) · Lane Minions per Minute (i) · Jungle Camps per Minute (i) · Total CS per Minute, all sources (i)
- **Laning econ (DPM):** CS@5/@10/@15 · Gold missed@5/@10/@15 · 1st-item timing & impact · golds from K+A / CS / Plates @15
- **Jungle/map:** Enemy Buffs Killed (i) · Enemy Jungle Monsters Killed (i) · Scuttle Crabs Killed (i) · Team Net Gold from Level-1 Invades (i)
- **Tempo:** Recalls (i)

### A.4 Objective (epic monsters & structures)
- **Team epic taken:** Dragons · Heralds · Voidgrubs · Barons · Elders (i) · Team Epic Monsters (i)
- **Team net epic (vs enemy):** Net Dragons · Net Heralds · Net Voidgrubs · Net Barons · Net Elders (i) · Team Net Epic Monsters (i)
- **Steals/contests:** Epic Monster Steals (i)
- **DPM objective detail:** Barons killed/first/enemy/power-play (golds/kills/turrets) · Dragons killed/enemy per game, Soul WR, Elder WR · Rift killed %, enemy killed %, turrets taken with rift, Rift danced · Void grubs/game, presence %, WR at 0/1/2/3 grubs
- **Towers:** Outer / Inner / Inhibitor Towers Destroyed (i) · Total Towers Destroyed (i) · Inhibitors: Kills+Assists (i) · Turret Plates Taken (i) · First Blood: Turret (i) · Turrets killed/lost/participation/plates per game (D)
- **Bounties:** Objective Bounties claimed / given away (i)

### A.5 Vision
- Standard Wards (i) · Control Ward (i) · Blue Trinket Used (i) · Control Wards: River or Enemy Half (i) · Vision Score per Minute (D+i)
- **DPM vision detail:** Team ward % · Blue wards placed · Wards placed Early/Mid/Late · Control wards placed/sold/x2 bought/gold spent · Wards destroyed, Control destroyed, Blue destroyed per game · Team ward-kill %

### A.6 Team / Macro (shares & net — cross-listed)
- Team Gold Share % (i) · Team XP Share % (i) · Team Damage Share % (i)
- Team Net * (dragons/heralds/grubs/barons/elders/epic monsters) (i) — see A.4
- Team Impact (DPM): team damage %, KP early/mid/late, first-turret contribution, turret participation, first-elite-monster %, elite-monster participation

### A.7 Laning (phase-specific — DPM)
- Farming (CS & gold-missed @5/@10/@15) · First To (first blood contribution/timing/victim, first turret contribution/timing, first-to-lvl-2, first-to-lvl-6) · Items & Golds (1st item timing/impact, team % gold, golds K+A/CS/plates @15) · Lane Dominance (trade efficiency, @15 diffs: K+A, gold, XP, CS, ward)

### A.8 Behavioral / Communication
- **Pings (iTero):** Pings total · On My Way! · Enemy Missing · Assist Me!
- **Adaptability (DPM):** Fatigue (deaths / solo-deaths increase; WR/vision/KP/objective-presence variance across a session) · Champion Pool (unique champs, champs 5+, roles 5+) · Routine (games/day, games/week, same-length sessions, hours-break) · Patterns (WR by morning/afternoon/night, after 3/5/7 games, 1st game, after win/loss streak) · When Behind (KP, TF WR, time-left, comeback %)

### A.9 Derived / ratios
- KDA Ratio (i) · Total Kill Participation (D+i) · Damage Done to Received Ratio (i) · Kills: Secure Ratio (i)
- **Kill Difference (iTero):** In-Lane · Out of Lane · versus Top / Jungle / Mid / ADC / Support · First Blood · Solos

### A.10 Meta / vanity & records (DPM.LOL)
- Records: most Kills/Deaths/Assists/Damage/Damage-Taken, Longest Match, best CS, CC Time (R)
- Counters: Gold Earned, Heal-from-map, Skillshot Hits, Enemy Fountain Kills, Survived-at-1HP, Summoners Casted, Items Bought, Pentakills (R)
- Mode-specific: Porosnax, Snowballs Hit, Poro Explosions (R) · Games-by-day heatmap (R)

### A.11 Profile / ranked (OP.GG · Tracker.gg)
- Tier + LP per queue · LP history · Peak rank · Season records · Win/Loss + streaks · Recent-N-games WR · Champion mastery points · Per-role games & WR · Preferred-role distribution · Performance badges (MVP, Unstoppable, multikills, Struggle, Lucky/Unlucky)

---

*Sources: DPM.LOL (DPM Lens Overview/Fighting/Laning tabs, ARAM records, match overview), iTero (full-stats page + per-stat drill-in, field list provided by user), OP.GG summoner page, LoL Rewind match-history rewind, Spartan Record, Halo Data Hive (Performance Dashboard + Progression Charts), Tracker.gg Halo profile, Halo Waypoint challenges — screenshots and field lists provided by the user.*



