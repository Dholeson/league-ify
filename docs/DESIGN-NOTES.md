# league-ify — Design Notes & Problem Roadmap

A living design doc. Written problem-first: each section states the problem, a
proposed direction, and what's still unsolved. Part I is the reward/progression
system (the headline design problem); the rest captures the current backlog of
open problems so they can be reasoned about async and handed back as decisions.

---

## Part I — The Reward / Progression System

### The problem
league-ify's thesis is *process over LP* — you improve by doing the right things,
not by chasing a number. But "do the right things" is intrinsically motivated, and
intrinsic motivation is fragile on a bad night. Games like LoL, Warframe, and the
whole achievement-hunter genre solve this with an **extrinsic scaffold**: visible,
compounding progress that keeps you engaged while the intrinsic habit sets.

We already have the raw material — tiered achievements feeding a single **Profile
Level** (Warframe-MR style), with a level-rewards *preview* on the Achievements
page. The problem: **the rewards are cosmetic mockups that unlock nothing**, so the
level is a vanity number, not a system. We need to turn it into a loop that (a)
rewards the behavior we actually want (consistency, review, breadth, process), (b)
keeps the "how am I doing" data fully upfront and free — never paywalled behind a
level — and (c) doesn't turn into a Skinner box that rewards *grinding* over
*improving*.

### The core tension to resolve
> Unlocks must gate **surface area and delight**, never **insight**.

If a level-up hid your win-rate or your weakest domain, we'd be punishing the
player for not grinding — the opposite of the thesis. So the design rule is: every
"how am I doing" answer is available at level 1. What levels buy is *more room,
more toys, more expression, and more depth* on top of that baseline.

### Design principles
1. **Data is free. Flair, capacity, and depth are earned.**
2. **Reward the loop we want**: reviewing games, running blocks to completion,
   playing a spread of champs/roles, sustaining process — not raw game count.
3. **Every unlock should be legible before you get it** (the roadmap already does
   this) *and* feel like something changed when you get it.
4. **No dead ends**: a maxed player still has streak/season goals to chase.

### Proposed model — three reward tracks
- **Capacity unlocks** (functional): run 2 blocks at once, pin custom stat cards,
  save board layouts, more active goals, extra champion-pool slots. These change
  *what the app lets you do*. Highest value, lowest gimmick.
- **Depth unlocks** (analytical): the full DPM stat tree (now built — good first
  reward), deep-dive coach mode, per-matchup breakdowns, timeline scrubbing.
  These reward the player who's earned the right to drink from the firehose.
- **Expression unlocks** (cosmetic): profile frames, banner colors, an animated
  rank crest, title flair ("The Grind — Diamond"). Cheap to build, high dopamine,
  zero risk to the thesis. These carry the early levels while capacity/depth
  unlocks are spaced out later.

### What still needs solving
- **Wiring**: the previews on the Achievements page point at nothing. Each unlock
  needs a real feature flag checked at its use-site (`level >= N`). Start with the
  cheap expression unlocks so the loop is *felt* immediately.
- **XP shape**: today XP = sum of achievement tiers. Does that over-reward volume
  achievements? We may want process/consistency achievements to grant *more* XP
  per tier than "play 1000 games." Needs a weighting pass.
- **Surfacing the level**: it lives only on the Achievements page. It should ride
  in the topbar (near the profile) so progress is ambient, not buried.
- **Notifications hook**: level-ups and unlocks already fire notifications (built).
  An unlock should get a *distinct*, celebratory toast — not the same chip as a
  goal. Small, worth doing when we wire unlocks.
- **Seasons/streaks as the endgame**: once achievements max, what's the recurring
  chase? Weekly/seasonal challenge goals that reset — the "battle pass" shape,
  minus the monetization.

---

## Part II — Making the app feel alive (motion & liveness)

### The problem
The app reads as a *report* — accurate but static. Reports are for reviewing the
past; a coach is a presence. We want it to feel like something is *happening*, both
to increase appeal and to reinforce that your data is live.

### A menu of options (roughly increasing effort)
1. **Micro-motion on load**: count-up animations on the big numbers (composite
   score, level, win rate), bars that fill, dials that sweep from 0. Cheap, huge
   perceived-liveness win. (Respect `prefers-reduced-motion`.)
2. **Live "since you last looked"**: a small ticker on the Overview — "3 new games
   · +2 process · 1 goal closer" — that animates in. Makes the app feel like it
   was working while you were away.
3. **Ambient sparkline motion**: the existing sparklines could draw-on; the
   Career Trend line could animate its latest point.
4. **A pulse/heartbeat on "live" elements**: the sync button breathes while
   syncing; the notification bell nudges when something lands.
5. **Literal on-page activity** (your instinct): a subtle animated hero — e.g. the
   champion splash with a slow parallax/ken-burns drift, or a particle/gradient
   sheen behind the level crest. This is the "it's alive" lever but the riskiest
   for taste/perf — worth a prototype before committing.

### Recommendation
Ship 1–2 first (count-ups + a "since you last looked" ticker) — they're cheap and
move the needle most — then prototype the animated hero (5) as an opt-in flourish.

---

## Part III — Report/Overview information architecture

### Insights → one panel above the Career Trend
**Problem**: the top of the Report is three stacked things (recent-analysis hero,
an "Insights" bar, section titles) that don't read as a unit, and the "Insights"
title sits *beside* the bar rather than over it. **Direction**: collapse
everything above the Career Trend into a **single "Insights" panel**. The title
sits on top; inside, a tidy uniform grid of insight cards. Framing (as inspiration,
not literal copy): the first cluster answers *"what's been happening"* (recent
trajectory, form, streaks); the second answers *"how to keep/start winning"*
(actionable levers from your own games). Keep the current click-throughs — they're
good. **Open Q**: fixed 2-column grid, or a responsive masonry that grows with the
number of insights?

### Skill Scores — one cohesive unit
**Problem**: the composite/hero (top) reads as separated from the domain dials
(middle), and the rank tier-ladder eats far too much vertical space for its value.
**Direction**: bring it closer to the DPM-Lens layout — composite + domain dials +
the *selected* domain's tiles wrapped into one bordered unit with no hard visual
break; demote the tier ladder to a compact inline element (a thin bar with your
marker, expandable on demand) rather than a full-height chart. Prioritize the
high-value read (where am I strong/weak) over the ladder.

### Consistency panel
**Problem**: the Best/Worst/Average mini-panels get shoved by the "Played badly |
Played well | Empty = rest day" legend, which itself text-wraps; and the three
numbers aren't labeled, so it's unclear what they mean. **Direction**: give the
legend its own single-line row (no wrap, smaller swatches), add a short title over
the three mini-panels explaining they're your best / worst / typical *day's process
score*, and stop the legend from displacing them (fixed columns).

---

## Part IV — Match history & the OP.GG-style match grid (new destination)

### The problem
The Overview's "Recent matches" list is eye-catching and stays put — good. But its
"View more" currently dumps you onto the Report page's plain game list. There's no
**rich match browser**: the OP.GG/mobalytics-style grid showing both teams, who was
on which side, each player's build, and win/loss — expanding into the graphical
"visual studies" (the deep per-game breakdowns we've discussed).

### Proposed shape
A dedicated **Matches** page (the real "View more" target):
- **Row per game**: result rail (win/lose color), champ + KDA + your build (6 item
  slots + trinket), queue/mode badge, performance score, date. Dense, scannable.
- **Expand a row** → the visual study: both teams laid out with sides, each
  player's build/runes/summoners, damage/gold/CS bars, the fight/objective timeline,
  and your process/insight callouts. This is where the deep charts live.
- **Filters** ride the global game-type/role filter already in the topbar.

### Open questions
- Is this a new top-level nav item, or does it live under Report?
- How much of the "visual study" is per-row inline vs a full match-detail route
  (we already have a Match detail page — the grid could deep-link into an enriched
  version of it rather than duplicating)?
- Pagination/virtualization for long histories.

---

## Part V — Champion page

### Multi-role champions
**Problem**: a champ that's played in two roles (Vayne top *and* ADC) is locked to
one context; all stats/benchmarks assume that one role, with no switch.
**Direction**: detect the roles present in the player's games for that champ and
offer a **role toggle** on the champion page; benchmarks, matchups, and tags all
re-slice to the selected role. **Open Q**: default to the most-played role.

### Tags (Mobalytics-style, multiple, data-driven)
**Problem**: 7 Lucian games yield a single "Lane bully" tag. **Direction**: a
richer tag engine that surfaces *several* playstyle/quality tags at once, each
derived from how *your* data lines up (e.g. "Early-game leaner", "Teamfight
carry", "Dies to dives", "Farms low"), and updates as the data shifts. Each tag
should be explainable (hover → the stat that earned it).

### Subtitle clarity
**Problem**: the text under the champion name is jargon-dense; a new user won't
parse it. **Direction**: rewrite in plain language, or make each token a
tooltip'd chip.

### Tips section + layout swap
**Problem**: the champion page shows "Win conditions" but no *how-to-play* guidance.
**Direction**: add an **active tips** section (combos, teamfight positioning, and a
quick read on how the champ pushes towers vs. teamfights vs. contests objectives
vs. picks). Move **Win conditions to the right**, the new tips section to the left.
Remove the word "duo" and the "Dive/tempo compositions" line.

### Suggested goals — always suggest, and route them to a block
**Problem**: a champ with real games (two ARAM games, 2/4/7 and 4/9/24) shows an
*empty* Suggested Goals section because the heuristic found "nothing to work on" —
but there's always something. **Direction**: always surface at least a couple of
suggestions (fall back to the weakest domain / most-improvable stat if no sharp
weakness). Then let the user act on them: **start a new block seeded with the
goal(s), or add them to the active block.** *Needs thinking-out*: the add-to-block
UX, and whether an ARAM-derived goal should target an ARAM block vs. a general one.

### Matchups gating
**Finding (answers your question)**: "Matchup detail appears once Riot timeline
data has lane-opponent context" shows because matchups are built from your **lane
opponent**, which we only get from **Summoner's Rift timeline parsing**. ARAM and
Arena have *no lane opponent* (we deliberately skip it), and games without a
fetched timeline have none either. So a profile that's mostly ARAM/normals/limited
modes — or has few SR games — will show this message. It's not a bug; it's a data
gap. **Direction**: make the empty state say *why* ("no ranked/SR games with lane
data yet"), and confirm it fills in on a profile with SR ranked games.

---

## Part VI — Match detail, Build & Draft, and game-mode correctness

### Show the build
**Problem**: the Build & Draft area doesn't show the actual build. **Direction**:
render the **6 item slots** (empty slots when fewer than 6 were built), **runes**,
and **summoners**, plus a **champ portrait** so you know who you played without
scrolling. Feed **runes** into the LLM analysis; **summoners** displayed but not
analyzed.

### "Build instead"
**Problem**: the analysis critiques the build but doesn't prescribe. **Direction**:
have it recommend **what to build instead** (and why), not just grade what you did.

### Arena / non-standard modes
**Problem (bug-ish)**: Arena renders as two 8-player teams and the draft score
analyzes "your 8 teammates" — but Arena is 2v2v2v2; you had *one* teammate. Other
modes have similar shape mismatches. **Direction**: model teams by the real
subteam structure per mode (Arena = 4 duos), and scope draft analysis to your
actual allies. Any mode lacking vision items/summoners/etc. should render
**graceful empty slots** rather than looking broken (see screenshot).

### Per-mode performance baselines
**Problem**: process/performance compares an ARAM game against the same baseline as
Ranked — but they're genuinely different games. **Direction**: baseline
performance **against the same game mode** (SR-ranked vs SR-ranked, ARAM vs ARAM,
Arena vs Arena). This aligns with the stat board's mode-aware benchmarks we already
built; the process score should adopt the same mode-awareness.

---

## Part VII — LLM cost & the "prefill engine" opportunity

### Current call sites (all `claude-opus-4-8`, adaptive thinking)
| Call | Where | Cap | Cache key | Frequency |
|---|---|---|---|---|
| Coach "Next Game" | `server/coach.ts` | 2500 | store, `(gameCount, queue)` | **regenerates every new game** (and per queue viewed) |
| Match analysis | `server/matchAnalysis.ts` | 1800 | disk, Riot match id | once per game ever, then free |
| Champion meta | `server/championMeta.ts` | 1600 | disk, patch + champion(+role) | once per champ per patch, then free |

### Rough daily cost (single active user)
Assuming Opus-tier pricing (~$15/M input, ~$75/M output) and ~4k input + ~3k
output (incl. thinking) per call ≈ **~$0.25–0.35/call**:
- **Coach**: the recurring cost — regenerates each new game you view the dashboard
  after. ~5 regens on a heavy day ≈ **$1.25–1.75/day**.
- **Match analysis**: only new games you open analysis for; ~5/day ≈
  **$1.25–1.75/day**, then those are free forever.
- **Champion meta**: amortizes to near-zero daily (per-patch cache).
- **Everything else** (dashboard, stats, achievements, notifications, ingest) is
  **$0 to Claude** — pure engine/Riot code.

**Active day ≈ $2–4. Quiet day (re-viewing cached content, no new games) ≈ $0.**
These are estimates — exact Opus 4.8 pricing should be confirmed.

### Reduction levers (the "prefill engine" idea)
1. **Coach is the lever.** It regenerates per game, which is *fresh* but the
   priciest habit. Options: (a) throttle to every N games or 24h; (b) **build a
   deterministic plan engine** from signals we already compute (weakest domain,
   focus goal, recent form, insights) and call Claude only for a periodic "deep"
   synthesis — turning most coach loads into $0.
2. **Model tiering**: route routine/structured work (match analysis on unremarkable
   games, tag generation) to **Haiku 4.5**; reserve **Opus** for high-value
   synthesis (deep coach, flagged games). Large cost cut for little quality loss.
3. **Anthropic prompt caching**: the big static blocks (system prompt, champion
   data, rank benchmarks) are identical across calls — cache them for a ~90% input
   discount. This is the literal "prefill so we don't pay again" mechanism.
4. **Pre-generate for the pool**: warm champion-meta for the user's champion pool
   in the background so it's never a blocking spend.

---

## Live companion (`/live`)

Reads the local League client and turns the current game into three coaching
panels, mode-flexible (SR lanes / ARAM / Arena):

- **`server/lcu.ts`** — the local reader. In-game takes priority: the **Live
  Client Data API** (`https://127.0.0.1:2999/liveclientdata/allgamedata`, no auth)
  gives exact roles for both teams. Otherwise champ select via the **LCU** —
  auth from the client's `lockfile` (`name:pid:port:password:protocol`, Basic
  `riot:{password}`). Both use `https.request` with `rejectUnauthorized:false`
  (self-signed cert; Node's global `fetch`/undici can't easily bypass it).
  Every call resolves `null` on failure, so no client → `clientDetected:false`
  and the page shows a "waiting" state instead of erroring.
- **`server/liveCompanion.ts`** — rules-based engine (instant, $0). **Matchup**:
  your record on your champ vs the enemy laner from `enrichAll(store.matches())`;
  if <2 games vs that opponent it falls back to your overall form on the champ.
  Enemy laner = exact role-match when roles are known (always in-game), else the
  enemy you've faced most on this champ (data-driven), else null. **Build**:
  classifies the enemy comp (DDragon tags + curated AP/healer/CC/assassin sets)
  into AD/AP/tank/CC/heal counts and calls boots + situational items with
  reasons. **Draft**: damage-profile readout + soft "who's favored" from comp
  one-sidedness.
- **`GET /api/live?mock=1`** exercises the whole pipeline (incl. the real
  matchup lookup) without League running — used for the demo and for verifying in
  this dev environment. Enemy positions are **hidden** in ranked champ select
  (Riot omits enemy roles) but **exact** in-game, so the matchup sharpens once the
  game starts.
- **`server/liveDeep.ts` — the optional LLM "deep read"** (`GET /api/live/deep`).
  A Claude synthesis layered on top of the rules output, not a replacement: the
  rules engine always runs (instant, free); this is button-triggered so the fast
  `/api/live` path stays rules-based. It compiles the companion's own output
  (both comps, the enemy laner, the player's real matchup history + strengths/
  focus, the comp profile, the draft readout) into a grounded brief and asks
  Claude for a headline, win condition, phase-by-phase plan, a *personal* matchup
  read that cites the player's tendencies, key threats, and nuanced build timing.
  Same Anthropic pattern as the coach (`claude-opus-4-8`, adaptive thinking,
  `output_config.format` structured output validated by a Zod schema, `hasAnthropic()`
  gate). Cached in-memory by a champ-select signature (team + enemies + mode) so
  re-clicks don't re-spend and the read refreshes only when the comp changes.
  Degrades to `available:false` (with a reason) when there's no key or no active
  game — the frontend shows a CTA / note instead of erroring.

## Known bugs
- **Overview profile hero shows wrong champ stats**: your Lucian reads "62 games ·
  Mastery 20" on the Overview but "7 games · M7" on the Champion page. 62 = career
  total, so the hero is almost certainly showing account-wide totals where it
  should show the *focus champion's* games + that champion's mastery level.
  High-priority correctness fix.
- Goal-completion notifications currently evaluate against the whole career rather
  than the block window the dashboard uses (v1 simplification — may fire early).
