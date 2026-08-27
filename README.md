# league-ify

**LP is the scoreboard Riot gives you. This is the scoreboard you actually need.**

A personal player-development campaign layer for Ranked League of Legends. It
reframes Ranked from a volatile LP grind into a structured, block-based
improvement campaign — one that rewards *process* even when the result lies to
you, and helps you stop queueing when your judgment is gone.

It is not a badges-and-points skin on top of League. It is a second scoreboard
built around one idea: **a single game is almost meaningless; a block of 30 is
the truth.**

---

## What it does

- **A coach that recommends your focus.** Instead of picking an identity and
  goals blind, league-ify reads your recent games, diagnoses where you're leaking
  vs. sensible benchmarks, and *recommends the identity + a measurable goal set*
  for your next block. It sharpens as you log.
- **Measurable, tracked goals.** Farm (CS@10, CS/min), dying less (deaths<15,
  clean-early rate), objectives, kills/KP, solo kills, gold@15, vision, tempo
  (close games out), tilt control, and champion commitment/win-rate goals —
  each with a live progress bar.
- **A profile-level champion pool** you set once via a searchable image grid;
  it carries across every block and drives the pool nudges + champion goals.
- **A Progress timeline.** The career view: pick any metric and watch its trend
  across every game and every block, a rank/LP journey, a player-shape radar
  (this block vs. career), block-over-block comparison, a consistency heatmap
  colored by how you played, discipline streaks, and personal bests. This is the
  part that answers your #1 question — *am I actually improving?*
- **Ranked Blocks, not loose games.** Every game lives inside a 20–40 game
  campaign with a theme, a focused goal set, and an identity you're trying to
  become. At the end you write *patch notes for yourself*.
- **A Process Score, decoupled from LP.** A transparent 0–100 grade for *how you
  played*, weighted by your block's identity. It's the number that predicts LP
  before LP shows up.
- **Verdicts that tell the truth about a game:** Clean Win, **Bad Win** (you got
  away with it — review anyway), **Good Loss** (you played well; that's XP, not
  failure), Deserved Loss.
- **Borrowed LP detection.** When your rank climbs while your play decays, it
  says so. That climb is a loan, and the ladder calls it in.
- **A tilt & session guardrail engine.** Best-of-3 nudges, hard-stop
  recommendations, a "the casino has you" warning for revenge-queueing — sharp,
  but only at real thresholds.
- **Riot API auto-enrichment.** Pull your latest ranked game and it fills in
  CS@10, gold diff@15, first-death timing, objectives, KDA, and a rank snapshot
  for LP deltas — so logging stays a 90-second self-report, not data entry.
- **Quests, XP, levels, badges, champion-pool tracking, death-cause analysis** —
  all of it pointed at behavior change, not vanity.

Your entire history is one human-readable file: `data/league-ify.json`. No cloud,
no lock-in, no data graveyard.

---

## Setup

```bash
npm install          # already done if you're reading this in the project
cp .env.example .env  # then fill it in (see below) — optional but recommended
npm run dev
```

Open **http://localhost:5173**.

`npm run dev` runs two things: the Express server (port 8787, holds your API key
and runs the engine) and the Vite web app (port 5173, proxies `/api` to the
server). One command, two processes.

### Connecting the Riot API (optional but recommended)

1. Copy `.env.example` to `.env`.
2. Get a key at <https://developer.riotgames.com/>. A **Development key** works
   immediately but expires every 24h; for a full season, apply for a **Personal
   key**.
3. Fill in:
   - `RIOT_API_KEY`
   - `RIOT_GAME_NAME` / `RIOT_TAG_LINE` — your Riot ID split on the `#`
     (e.g. `Faker#KR1` → `Faker` and `KR1`)
   - `RIOT_PLATFORM` — `na1`, `euw1`, `kr`, etc.
4. Restart `npm run dev`.

Without it, everything still works — you just type the objective stats yourself.
The engine renormalizes around whatever data is present, so partial input never
breaks a score.

---

## First-time setup

1. Open **Settings → Champion Pool**. Search the grid and click champions to
   cycle them **main → secondary → lab**, set your main role, and save. (You only
   do this once; it carries across blocks.)
2. Open **Ranked Blocks**. The coach recommends an identity + goals (a balanced
   starter set until you've logged ~5 games). Accept or tweak, name the block,
   and start it.

## The daily loop (designed to survive a tilting loss)

1. **Finish a game.** Open **Log a Game**.
2. Choose **Pull latest ranked** (auto-fills the numbers) or **Manual**.
3. Answer the **90-second scorecard**: grade, tilt in/out, first-death cause,
   biggest mistake, best decision, and the one thing — *one adjustment for next
   game*. Toggle flame / mute / reviewed / doomed-collapse.
4. Hit **Log the game** and immediately see: your process score, the verdict,
   XP earned, the sub-metric breakdown, and any nudges the game triggered.
5. When the **hard-stop** banner shows up on the dashboard — that's the read.
   Closing the client is the winning move. Log it as a W for the mental game.

At the end of a block: **Ranked Blocks → Close block + retro**, write your patch
notes, and start the next block with a sharper focus.

---

## How the Process Score works (read it, tune it)

Six sub-metrics, each a plain 0–1 function of the data, combined using your
identity's weights (missing sub-metrics are dropped and the rest renormalized):

| Sub-metric        | Fed by |
|-------------------|--------|
| Early stability   | deaths before 15, gold diff@15, CS@10 |
| Death discipline  | deaths/10min + your first-death cause (avoidable vs not) |
| Objective / macro | team objectives taken, vision/min, self-grade |
| Teamfighting      | damage share, KDA |
| Mental & comms    | tilt after, flame, mute discipline |
| Review            | reviewed? adjustment written? mistake named? |

The formulas live in [`server/engine/processScore.ts`](server/engine/processScore.ts)
and are meant to be edited. Verdict thresholds are in
[`server/engine/classify.ts`](server/engine/classify.ts).

### Goals & the coach

Goal templates live in [`server/engine/goals.ts`](server/engine/goals.ts) — each
is a plain function that measures itself from your games (average, rate, streak,
count). The recommendation engine
([`server/engine/recommend.ts`](server/engine/recommend.ts)) compares your recent
numbers to benchmarks, scores every identity by how many of your leaks it
targets, and returns the best-fit identity plus your highest-severity goals.
Under ~5 games it cold-starts on The Stonewall Climber with a balanced starter
set, then personalizes. Your champion pool lives on the profile
(`store.profile()`), not the season.

### Identities

Recommended per block (you can override); each reweights the score and pushes
different quests:

- **The Stonewall Climber** — stable laning, low deaths, boring on purpose.
- **The Tempo Goblin** — roams, resets, map pressure.
- **The Teamfight Architect** — positioning, fight timing, never first to die.
- **The Lane Bully** — pressure, CS leads, controlled aggression.
- **The Shotcaller Monk** — clean pings, calm macro, zero chat nonsense.

Defined in [`server/engine/identities.ts`](server/engine/identities.ts).

---

## Project layout

```
shared/types.ts          # the whole domain model, one file
server/
  index.ts               # Express API
  store.ts               # JSON-file data layer (seasons, matches, goals, profile)
  riot.ts                # Riot API client + timeline parser
  ddragon.ts             # champion static data + portraits (no key needed)
  dashboard.ts           # aggregate builder
  engine/
    identities.ts        # archetype roster + weights
    processScore.ts      # the process score (the star)
    classify.ts          # verdicts + borrowed-LP / good-block detection
    session.ts           # session grouping + tilt guardrails
    xp.ts                # per-game XP, flags, levels
    quests.ts            # daily/season quests
    badges.ts            # achievements
    goals.ts             # parametric goal templates + measurement
    recommend.ts         # the coach: diagnostics -> identity + goal recs
    enrich.ts            # orchestrator: raw match -> second scoreboard
  progress.ts            # career timeline / cross-block trend aggregator
src/                     # React + Vite dashboard
  components/            # ChampionPicker (searchable image grid)
  pages/                 # Dashboard, LogGame, Progress, Seasons, Settings
```

## Design grounding (why it's built this way)

The engagement model is deliberate, not decorative:

- **Self-Determination Theory** (competence, autonomy, relatedness): the system
  rewards *process* (competence you control), lets you shape your own block
  (autonomy), and never leans on extrinsic LP for XP. Research consistently finds
  intrinsic-motivation designs retain better than points-for-points.
- **Progress visualization is the highest-ROI mechanic.** Trends over time are
  the clearest competence signal, which is why the Progress page is a first-class
  surface, not a footnote.
- **Goal-gradient effect**: progress bars emphasize *what's left* ("3 to 10"),
  which accelerates effort near a milestone.
- **Streaks with a conscience**: streaks are tied to *discipline* (review,
  no-flame, clean-early, calm-exit) — never games-played — so the system builds
  momentum without nudging you toward compulsive queueing.

---

## Design principles it holds itself to

- **Reward process, not outcomes.** You cannot buy a level with LP.
- **Make losses useful without pretending they're fun.**
- **Distinguish "played badly and won" from "played well and lost."**
- **Help you stop when your judgment is compromised.**
- **Low-friction or it dies.** If logging isn't ~90 seconds, you won't do it
  after a 38-minute loss where the jungler was replaced by a Roomba.

---

## Roadmap (deliberately left open)

- Weekly quests and cross-block progression.
- Objective-timing analysis from the match timeline (deaths before Baron/soul,
  reset timing before objectives).
- Champion-specific goal auto-suggestions (e.g. "your Malphite dies pre-6 too
  often") and a per-champion mastery view.
- Wave-state and recall-timing inference where the API allows.
- One-click history export / import and block-over-block comparison.
- A settings UI for tuning process weights, benchmarks, and thresholds without
  editing code.
