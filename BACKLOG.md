# league-ify backlog

Execution order (per user): **Achievements → Global selector → Report redesign → Overview → new content.**
"Do anything with a dependency for future work first."

## 1. Achievements  ← done; unlock-effects still to ideate
- ✅ Account-level, tiered achievements (bronze→diamond) computed from career data.
- ✅ Achievements page: cards sorted by progress; unstarted dimmed.
- ✅ **Difficulty scaling**: tiers ramp exponentially (×5/×3/×2.7/×2.5).
- ✅ **Profile Level (Warframe MR style)**: achievement tiers feed XP into a single
  account **Level** (ramped thresholds); shown as a hero on the Achievements page.
  STILL TODO: **ideate what unlocking levels enables** (more blocks, board cards,
  cosmetic borders, advanced stat views, coach modes…) and surface the level elsewhere.
  ✅ **Level-rewards preview** added to the Achievements page (ideated unlocks, lit up as you level). Wiring the unlocks to real features + surfacing the level in the topbar remain.
- Later: "recently completed achievements" panel on the Report page (needs unlock-time tracking).

## 2. Global selector  ✅ DONE
- ✅ **Global game-type selector** (All, Ranked Solo/Duo, Ranked Flex, Swiftplay, Draft, ARAM) + **role selector** in the topbar (`src/globalFilter.ts` pub-sub); persisted; drives Dashboard + Stats; ARAM hides role. Dashboard queue chips removed (now "Showing …" indicator).

## 3. Report page redesign  ✅ DONE
- ✅ Move **Deep Dive** to the top; ✅ **equal-size** the three Deep Dive panels.
- ✅ **Nix Block-over-Block** → replaced with a **recently-completed blocks** card grid.
- ✅ **Interactive Career Trend** (recent-games grid + click → detail panel + ReferenceLine).
- ✅ **Collapse Stats into Report** — extracted `src/components/StatsBoard.tsx`, rendered as "Skill scores" under the Career Trend; Stats nav page removed (`/stats` → redirects to `/progress`).
- ✅ **Recent-analysis hero** + ✅ **more Insights** section at the top (progress payload now carries `insights`).
- ✅ **Consistency panel** — Best/Worst/Average now a thin vertical stack **beside** a 7-column calendar.
- ✅ **Career Trend + Recent-games = ONE panel** with a mid divider.
- ✅ **Champion Mastery ↔ Player Shape** — LP Journey full-width, Champion Mastery (list) beside Player Shape.
- Fold Rank/LP into the trend as a metric — deferred (LP is cumulative + flat for this account).

## 4. Overview (partly done)
- ✅ Replace **"Your champions"** with the DPM-style champion list (CS, colored KDA, per-game K/D/A, WR, games) + our tier badge + performance score appended.
- ✅ **Recent Matches**: single list, no date separators.
- ✅ **Mini graphs** replacing the Quick Stat panels — last-10-games sparkline per stat; **already reactive to the global game-type** (statboard is queue-filtered).
- ✅ **Active Block elevated** — now leads the Overview's left column (above Quick stats) with an accent border; the "what do I do right now?" focus.
- ✅ More **insight types** added (KP, gold@15, low-deaths, objectives); cap raised to 6.
- ✅ **Coach reactive to game-type** — `buildCoachPlan({queue})` filters the career by the global queue; plan cache keyed by (gameCount, queue); dashboard passes the filter.
- ✅ **Active Block "biggest changes this block"** — replaced the redundant games ladder with a stat-gains panel (block avgs vs pre-block, ranked by improvement). Server: `BlockReview.statGains`.
- ✅ **Champions page filter spacing** — each filter group on its own row with dividers + aligned labels.

## 5. Polish / misc
- ✅ **Icon cropping** — small avatars now use DDragon's square champion icon (`src/ddragon.ts`); block hero keeps the tall splash.
- ✅ **User Profile square** — rank is now a colored **word** (no panel); everything after WR dropped; **Sync my games** button moved into the square.
- ✅ **Top-right profile dropdown** — flattened into the nav with a left separator (no boxed panel).
- ✅ **Tags → Title Case.**
- ✅ **Champions page filters** — separated into rows with dividers + aligned labels.
- ✅ **Champions gradient** — continuous tint by score (gold→vivid-green / gold→deep-red) with alpha scaling; a high-green now clearly out-glows a low-green.

---
## 6. Deep stats + game modes  ✅ DONE
- ✅ **Full DPM stat tree** — timeline-event parsing added (`server/riot.ts`): clustered
  CHAMPION_KILL events → **Duels / Skirmishes / Teamfights** win rates; **multi-kills**;
  **damage early/mid/late** from participant-frame damageStats; plus control wards, ward
  clears, turret plates, dragon/baron/grub takedowns, skillshots dodged, enemies CC'd.
  New domains on the Skill-scores board: **Teamfighting, Mechanics, Damage timing**
  (Damage timing is descriptive — excluded from the composite). Stored as
  `ObjectiveData.adv`; a bounded, self-healing **back-fill** upgrades old games on sync.
- ✅ **Arena + rotating-mode ingestion** — Arena (1700) added to the sync + a queue-agnostic
  catch-all pass pulls ARAM Mayhem / URF / Nexus Blitz / One-for-All. Arena is placement-based
  (`placement`, win = top 4), gets its own **Arena** board (placement + fighting + mechanics),
  and is excluded from the Rift "sr" board. Global filter gained an **Arena** game type.

## 7. Notifications  ✅ DONE
- ✅ **Accomplishment notifications** — server diffs career state on each fetch and emits a
  notification on **achievement tier-ups, profile level-ups, and goal completions**
  (`server/notifications.ts`). First run baselines silently (no backlog flood); state stored
  per-profile in `notifSeen`; list bounded to 60.
- ✅ **Topbar bell** (`src/components/NotificationBell.tsx`, self only) — unread badge, dropdown
  stacking items (opening marks read), **transient toasts** (portaled to `document.body`,
  client-side once-per-item dedup, 5-min recency gate), and **Clear all**. Fires on a
  `notif:refresh` event after each sync + a 90s backup poll.
- Endpoints: `GET /api/notifications` (refresh+return), `POST /read`, `DELETE` (clear).

## 8. Design roadmap → see [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md)
The reward system + a large problem dump are captured, problem-framed, in the design doc.
Concrete build items pulled out of it (rough priority, to sequence with the user):

**Bugs**
- [ ] Overview profile hero shows career totals (62 games / Mastery 20) instead of the focus
  champion's games + mastery (should be 7 games / M7 for Lucian).

**Report / Overview IA**
- [ ] Insights → one panel above Career Trend; title on top; uniform grid; keep click-throughs.
- [ ] Skill Scores → one cohesive unit (DPM-Lens style); shrink the tier ladder.
- [ ] Consistency panel → single-line legend (no wrap), title the Best/Worst/Avg minis, stop displacement.

**Champion page** (cluster in progress)
- [x] Multiple data-driven tags (Mobalytics-style), each explainable + live — strengths AND
  weaknesses, mode-aware, color-coded (Lucian: 1 tag → 5). `server/mastery.ts`.
- [x] Always suggest goals — stretch goals when nothing sharp fires (fixes empty ARAM-champ case).
- [x] Removed "duo" + "Dive/tempo compositions" from synergies (`sanitizeMeta`, cleans cached too).
- [x] Matchups empty-state now explains *why* (lane opponent = SR only).
- [x] Multi-role toggle (Vayne Top vs ADC) re-slicing stats/benchmarks/tags — `?role=` slices the
  game set; toggle renders when a champ has 2+ roles. Plumbing verified; no multi-role champ on the
  self profile to eyeball (surfaces on the Vayne profile).
- [ ] Plain-language subtitle under the champ name. **next**
- [ ] Active tips section (combos, positioning, push/teamfight/objective/pick profile); swap Win
  conditions to the right, tips to the left.
- [ ] Suggested goals → route to a NEW block or the active block (currently only "add to active").

**Match detail / Build & Draft / modes**
- [ ] Show the build: 6 item slots (empty when <6), runes, summoners, champ portrait.
- [ ] Feed runes into analysis (not summoners); recommend "build instead".
- [ ] Fix Arena (2v2v2v2) team structure + scope draft analysis to real allies; graceful empty slots.
- [ ] Per-mode performance baselines (don't compare ARAM vs Ranked).

**New feature**
- [ ] OP.GG-style Matches grid as the "View more" destination (both teams, builds, win/loss →
  expand into the visual studies). Keep the Overview recent-matches list where it is.

**Liveness**
- [ ] Motion pass (count-ups, "since you last looked" ticker; prototype animated hero).

**Coach freshness** — already regenerates per new game (cache keyed by game count). Decide whether
to throttle + build a deterministic plan engine to cut cost (see doc Part VII).

## 11. Live companion (`/live`)  ✅ DONE
- [x] **Local reader** (`server/lcu.ts`) — in-game via Live Client Data API (exact roles), champ
  select via LCU (`lockfile` auth, self-signed cert bypass); degrades to a "waiting" state with no
  client running.
- [x] **Companion engine** (`server/liveCompanion.ts`) — your matchup history vs the enemy laner
  (what you do well / focus, from `enrichAll(store.matches())`), build tuned to the enemy comp
  (DDragon tags + curated AP/heal/CC/assassin sets → boots + situational items with reasons), and a
  draft readout; mode-flexible (SR lanes / ARAM / Arena).
- [x] **`/api/live?mock=1`** + `api.live()` + `src/pages/Live.tsx` (polls live, static for mock) +
  nav/route + CSS. Verified end-to-end via mock and graceful empty state.
- [x] **Optional LLM "deep read"** (`server/liveDeep.ts`, `GET /api/live/deep`) — a Claude synthesis
  layered on the rules output: headline, win condition, phase-by-phase plan, a personal matchup read
  grounded in the player's own logged tendencies, key threats, and nuanced build timing. On-demand
  (button-triggered so the fast `/api/live` path stays rules-based/free), cached per champ-select
  signature, mode-flexible, and degrades to `available:false` with no API key. Same Anthropic pattern
  as the coach (`claude-opus-4-8`, adaptive thinking, structured output validated by Zod). Verified
  end-to-end via mock (28s cold call, cached thereafter; grounded in the real Lucian numbers).
- [x] **Client detection is install-location independent** — `server/lcu.ts` now discovers the LCU
  from the running `LeagueClientUx` process's command line (`--app-port` / `--remoting-auth-token`,
  via PowerShell on Windows / `ps` on macOS, cached) when the `lockfile` isn't in a known dir. Fixes
  "nothing happened in a lobby" for non-standard installs. `clientDetected` is now set from a real
  phase read, and the Live page shows a clear status line (red = no client / amber pulsing = detected,
  waiting for champ select / green = active) plus a phase-aware empty state. Verified live: an ARAM
  lobby now reads `clientDetected:true, phase:"Lobby"`.
- [x] **Class-aware build recs** — `buildRecs` used to recommend frontline armor (Plated Steelcaps,
  Randuin's/Thornmail) off the enemy comp alone, so a hypercarry ADC (Kog'Maw) got tank items. Now it
  branches on the player's `archetype` (marksman/mage/assassin → DPS boots + carry defensive tools like
  Wit's End / Guardian Angel / QSS; tank/fighter → the resist-stacking items). Marksmen count as AD
  even when dual-tagged Mage (Kog'Maw/Kai'Sa), added a DIVERS set (Master Yi, Tryndamere, …) so carries
  itemize vs backline dive, and expanded HARD_CC. Verified on the player's real Kog'Maw ARAM vs
  Caitlyn/Yi/Bard/Poppy/Syndra → Berserker's + Wit's End + GA + QSS.
- [x] **Mode maintained in-game** — the Live Client Data API returns `gameMode` (not a queueId), so once
  a game started `mode` fell to "—" and `hasLanes` flipped false. `lcu.ts` now captures `gameMode` and
  `liveCompanion.ts` maps it (CLASSIC→SR/lanes, ARAM, CHERRY→Arena, …) when queueId is absent. Verified
  live: an in-progress ARAM now reads `mode:"ARAM"` correctly.
- [x] **Readout continuity through the loading screen** — the champ-select / in-game readout is now
  held (`lastActive`) across the champ-select → loading → in-game handoff, so the draft readout doesn't
  vanish during the loading screen; it's shown with a "Game starting…" bridge banner until the live
  game data comes online, then swapped. Cleared once the client settles into lobby/post-game.
- [x] **Post-game recap + goal progress** — `server/liveRecap.ts` + `GET /api/live/recap` +
  `RecapCard`. After a game the Live page shows the last game (result, your line, process score,
  verdict, XP, op.gg-style highlight tags) and **how the game moved each active block goal** — per-game
  average goals show "this game X vs target · block avg A→B", cumulative "games/wins" goals show
  "+1 this game · 298/10". Reads from the stored match, so "View full match →" opens the same data as
  the full match detail (no separate cache to drift). Verified live on the player's finished Samira
  ARAM. Follow-up: also surface goal-progress on the match-detail page itself.
- [x] **Full phased build path** — `buildBuild` now emits a phased plan (Opening → Boots → Core →
  Situational) with timing hints, driven by a champion **build STYLE** (crit / on-hit / caster marksman,
  burst / battle mage, AD / AP assassin, bruiser, tank, enchanter / engage support) so the core items
  are accurate without a per-champ DB, then overlays the comp-based situational picks. E.g. Kog'Maw →
  Doran's Blade → Berserker's → BotRK/Guinsoo's/Runaan's → Wit's End/GA/QSS.
- [x] **Identify ME in the team list** — the player's champion gets a green "YOU" badge + highlight.
- [x] **Choosable matchup opponent (any mode)** — click any enemy to set them as your matchup opponent
  (`?opponent=` on `/api/live`), so you can compare vs the enemy ADC in ARAM instead of guessing.
  Deterministic default when unset: role-match (lane modes) → most-faced on this champ → same-archetype
  enemy → first enemy (works in laneless modes too, no more null).
- [x] **Recap shows the game that just completed** — on the in-game→post transition the page force-syncs
  and retries the recap over ~90s to beat Riot's publish delay; recap picks the newest riot game.
- [x] **Mode-consistent stats confirmed** — matchup stats stay lane (Gold@15/CS@10) vs teamfight
  (KDA/KP/Damage share/Deaths) by mode even when the opponent is overridden.
- [x] **Team-comp-aware, multi-option builds** — `buildBuild` now takes YOUR allies too. Flex champs
  (Kai'Sa, Kayle, Varus, Ezreal, Gnar, Jax, Yasuo…) expose labeled build options (e.g. "AP assassin" /
  "On-hit DPS") scored against BOTH comps — filling your team's damage gap and countering theirs — with
  the best marked PICK and switchable tabs. `teamNeeds` surfaces gaps ("no AP on your team"). New
  `carryDamage()` reads Tank/Support tags directly so an AP-tagged tank (Malphite = Tank+Mage) no longer
  masks a real AP gap. Verified: Kai'Sa on an all-AD team → AP build recommended.
- [x] **Deep read auto-generates + never disappears** — once all 5 enemies are known it auto-fires; the
  server caches per comp, so if a poll clears it, it regenerates from cache instantly (and free). Gated
  off for the sample preview so previewing doesn't spend. Cost: ~5¢ per unique comp (one Opus 4.8 call,
  cached for the game).
- [x] **Calmer in-game updates** — poll drops to every 20s once you're in a running game (nothing
  changes) vs 4s in champ select.
- [x] **Compact density pass** — tighter card padding/gaps/fonts across the Live page so the whole
  readout fits in far less scrolling.
- [ ] **NEXT PASS (post-game + match detail):** show richer post-game stats / the match detail inline;
  prioritize "what to keep doing / what to do next time" at the top of the match detail; reconcile the
  live rules build with the LLM build-score grader (currently two engines — the auto deep read is the
  LLM-accurate full build that aligns with the grade).
- [x] **Draft readout right-sized** — pared version was too thin; restored the verdict + damage lean
  plus a compact tone-colored notes list (play-to / watch-for) in one tight card.
- [x] **ARAM-legal items** — `buildBuild` takes a `laneless` flag; in ARAM, items not in the Howling
  Abyss shop are swapped (Guardian Angel → Sterak's/Death's Dance, support quest item → Doran's). Also
  removed Smolder from the AP_OVERRIDE set (he's an AD marksman).
- [x] **No more "go AP" for AD-only champs** — team-gap advice is only prescriptive when the champion
  actually has a build option of that damage type; otherwise it's descriptive ("all physical — expect
  them to stack armor"). Fixes Smolder being told to go AP while recommended an AD build.
- [x] **Deeper post-game view** — recap now shows a full stat line (KDA, CS/min, KP, dmg share, damage,
  vision), a "Did well / Work on next game" readout derived from the process sub-metrics + game tags,
  goal progress, and a prominent "Full match detail" button. Rules-based, no extra token spend.
- [x] **Cheap in-game liveness polling** — during a running game the readout is fixed, so the page
  polls a lightweight `GET /api/live/status` (just the client phase, ~13ms) instead of rebuilding the
  full companion (which re-enriches your whole match history) every tick. A full refetch only fires when
  the game actually ends. Champ select still refetches fully every 4s (picks change).
- [ ] Persist a per-champ-select snapshot so the readout survives a page reload mid-select.
- [x] **Mode-appropriate matchup stats** — lane modes show Gold@15 / CS@10 / Deaths<15 / KDA; laneless
  modes (ARAM/Arena) now show KDA / Kill participation / Damage share / Deaths-per-game instead (lane
  metrics are meaningless when there's no lane and CS is shared). Insights are mode-specific too (fight
  participation & poke discipline vs early-lane advice), and the history sample is filtered to the same
  mode family (ARAM games for an ARAM readout), with a display-name fix in the note. Verified on the
  player's live Kog'Maw ARAM.
- [x] **Incremental pull (no more re-scan loop)** — a caught-up profile used to re-enumerate its
  ENTIRE Riot history every visit (paginate-to-end, no early stop), which re-burned the rate limit and
  made `drainPull` loop the "pulling…" banner forever. Now `server/ingest.ts` does a deep scan only on
  the first pull (or a genuinely small profile); once fully enumerated (`settings.pullComplete`) it
  tops up incrementally — scans the newest games and stops at the first already-stored one. Verified on
  VolibearSitOnMe (734 games stored): sync returns in ~2–5s with `remaining:0`, `rateLimited:false`,
  and only genuinely-new games added. NOTE: the "300ish vs 600+" was the **season span** (150-day
  "This season" view), not data loss — all games are stored; "All time" shows them.

## 10. Run 3 — full backlog sweep (completed)
- [x] **Tier colors** — the champion meta tier badge is now TierList-colored (S red → D blue).
- [x] **Overview hero bug** — the champion face now shows *its* game count, not the account's 62/M20.
- [x] **Block hero** — "block champion" text removed; shows the champion's baseline (WR/perf/games);
  champion portrait enlarged for champion blocks.
- [x] **KP insight reframe** — good-habit splits that correlate with *losing* (reverse causation, e.g.
  kill participation) are suppressed instead of advising "don't fight."
- [x] **Champion banner** — performance **round dial** (animated) on the right; jammed name/info bar
  cleaned into a title row + plain-language subtitle.
- [x] **Matchups** → top-5 **best / toughest by performance** with champ pics; **Trend + Suggested
  Goals** side by side; **Recent games + Matchups** side by side.
- [x] **Consistency panel** — single-line no-wrap legend + a titled Best/Worst/Typical stack.
- [x] **Quick stats** — bigger centered titles + centered values.
- [x] **Liveness** — count-up animation on dials/scores + subtle **ken-burns** drift on hero splashes
  (both honor prefers-reduced-motion).
- [x] **Coach engine switch** — Claude ⇄ deterministic-engine toggle on the coach panel (cache keyed
  by mode) so you can A/B; deterministic path reuses the existing heuristic ($0).

### Deferred sweep — now done (run 4)
- [x] **This-season / all-time view toggle** — threaded through the request context (`x-span` →
  `activeProfile().spanCutoff` → `store.matches()` filters); one central change, every data view
  respects it. Topbar toggle refetches the app. Verified: 20 (season) ↔ 62 (all-time) games.
- [x] **OP.GG Matches grid** — new `/matches` page (rich rows: champ, tags, KDA, **full build** items +
  summoner spells, opponent, perf, win/loss rail). Fed by build capture in ingest
  (`ObjectiveData.build` + `opponentName`) with the backfill upgrading old games. "View more" → here.
- [x] **Active tips** — champion meta v2 adds `combos`, `positioning`, `playRatings` (Tower push /
  Teamfight / Objectives / Picks 1-5); rendered as a **How-to-play** panel with Win conditions swapped
  to the right. Regenerates lazily per champ (cache key bumped).
- [x] **Insights → one panel** (recent-trajectory row + insight grid, one card) + **Skill Scores
  cohesion** (composite/domains/tiles/ladder in one panel, shorter ladder).
- [x] Fixed a duplicate-React-key crash in champion Suggested Goals (deduped by template).

### Notification routing + season achievements (run 5)
- [x] **Deep-linked notifications** — each notification now carries a `link` to the exact item:
  achievement → `/achievements?focus=<id>`, level → the level hero, champion goal →
  `/champions/<c>?focus=goals`, general goal → `/?focus=block`. The landing page **scrolls to +
  flashes** the target (`.flash` glow).
- [x] **Span-independent notifications** — the diff now computes against all-time
  (`store.allMatches`) so toggling season/all-time never spams; `buildAchievements(matches?)`.
- [x] **Season-aware achievements** — the Achievements page respects the season/all-time toggle
  (season view counts only in-window games) and labels which mode it's showing.

### Run 6 — profile/pool/rank fixes (done)
- [x] **Champion pool is per-profile + derived from games** — `derivePool()` auto-includes any
  champion with 3+ games (tiered by volume, in its top role), merged with hand-added entries;
  scouted profiles now get a real pool instead of empty.
- [x] **Matchups always split** — with < a full board, best/toughest split down the middle
  (odd counts favor best); the Toughest column always renders.
- [x] **No-active-block goal auto-creates a block** — seeds a `<champ> focus` block with the goal
  + a couple of recommended goals (fixes "added" goals vanishing); toast says a block was started.
- [x] **Skill Scores + Rank/LP Journey side by side** (skill board reduced to fit).
- [x] **LP Journey no longer flat** — Riot gives no per-game LP, so it's estimated from ranked
  wins/losses (~+20/−18) and clearly labeled.
- [x] **Achievement XP shown** — each card shows the XP it contributes + "+N at next tier"
  (`Achievement.xp`/`nextTierXp`); clarifies what feeds Profile Level.
- [x] **Global sticky "still pulling" banner** + **deep paginated all-time pull** (bounded to 700)
  so accounts with 600+ games fill in (the season toggle filters the view).
- [x] **Rank tracks the game mode** — Flex filter shows the Flex rank (Unranked if none, never the
  solo rank), and the square labels which queue the rank is for (Solo/Duo by default).

### Run 7 — the big pull actually completes now
- [x] **Persisted pull queue** (`settings.pullPending`) — we enumerate match ids ONCE, then drain
  details from the saved queue; previously every sync re-scanned the whole history (~125 API calls)
  and instantly blew the rate limit, stalling at ~160 games. Now ~50 calls/sync → steady progress.
- [x] **Graceful 429s** — a rate limit anywhere (incl. getPuuid) is a soft pause (`rateLimited`, no
  hard error); the drain backs off 25s and **resumes automatically** (up to a long ceiling), and the
  hourly sync gate is bypassed while a backlog is pending. Verified a 600+ profile climbing
  162 → 258 and counting.
- [x] **Sticky, always-visible pull banner** — shows the live "N games still to pull" count + rate-limit
  status; the dashboard exposes `pullRemaining` so it appears immediately and resumes on reload.

### Run 8 — floating Objectives panel (League-modal style)
- [x] **`FloatingObjectives`** — a launcher FAB (bottom-right) on every page opens a floating,
  draggable, minimizable dock: active block header (champ icon + name + games/goals progress), a
  Profile-Level track (MXP-style bar), and each goal as a row with a circular progress ring + target.
  Minimize collapses to the FAB; open state + position persist; hidden while scouting. Fed by a
  lightweight `/api/objectives` endpoint. Replaced the dead `CurrentBlockDock`.

### Still open (secondary)
- [ ] **Harder all-time-only achievements** (much longer ladders) as a *separate* set from the
  season achievements — new content the user is still ideating.
- [ ] Champion-goal deep-link lands on the unplayed page if that champ has no games in the current
  span (edge case); consider forcing all-time or a friendlier empty state.
- [ ] Richer 2-up **inline** match rows in the Active block / dashboard / champion Recent games.
- [ ] Pull pagination for >100 games/queue; mid-pull auto-resume; new-block goal routing.

## 9. Review pass 2 (champion page + dashboard + data pipeline)
**Done this pass**
- [x] **Champion name/icon resolver** (`src/ddragon.ts`: `champId`/`champName`) — fixes the Kog'Maw
  icon falling off, and display names (Wukong←MonkeyKing, Twisted Fate, Lee Sin, LeBlanc) app-wide.
- [x] **B-tier explained** — tooltip on the tier badge saying it's Claude's per-patch read (not a
  live meta source) + a difficulty tooltip.
- [x] **Vayne switcher diagnosed** — not a bug: 1 game, UNKNOWN role (ARAM/normal), labeled "TOP"
  from the champion-pool setting. Toggle needs games tagged in 2+ roles. (Possible follow-up: infer
  role from champion class instead of defaulting to the pool role when games are UNKNOWN.)

**Champion page — remaining**
- [ ] Clean up the jammed name/info bar (role + difficulty crammed).
- [ ] **Performance score** as its own round-dial visual on the right of the banner.
- [ ] Matchups: move up beside Strengths/Weaknesses/Win-conditions; show **top-5 best / top-5 worst
  by performance avg** (add per-matchup avg process to `MatchupStat`); champ pics; side-by-side with
  Recent games; pull the left champ-bar bottom up to compensate.
- [ ] Trend + Suggested Goals panels → smaller, side by side.
- [ ] Champ pics on the Recent-games rows.

**Dashboard / blocks**
- [ ] Remove "block champion" text under the champ icon in the Current block panel.
- [ ] Block quick-stats: bigger stat titles, center the values.
- [ ] Block hero: if champion block, bigger champ + "here's the champ & how you've progressed"
  baseline highlights; other block types show stats + most-played-champ icon (placeholder/recommended
  if none).
- [ ] Richer match rows (build items, summoners, runes, lane opponent + summoner name), 2-up — in the
  Active block "Games in this block", dashboard Recent matches, and champion Recent games. (Overlaps
  the OP.GG grid feature.)

**Insights**
- [ ] The KP insight ("higher KP → lower win rate") reads as "avoid fights" and isn't actionable —
  suppress/reframe counterintuitive correlations (likely reverse causation: losing → chasing fights).

**Data pipeline** (decisions: overhaul first · scope = this-season/all-time **toggle**)
- [x] **Season-scoped pull** — enumeration bounded to a rolling window (`SEASON_WINDOW_DAYS=150`,
  Riot `startTime`); fixes over-pulling all-time. `server/riot.ts` + `server/ingest.ts`.
- [x] **Progressive drain + banner** — sync returns `remaining` (season games known-but-unfetched);
  `src/pull.ts` `drainPull()` loops in rate-safe batches (maxNew 25, 429 backoff) until 0; recent
  games land first; `PullBanner` shows "pulling N to go" / rate-limit pause. Wired into the dashboard
  auto-sync, the manual Sync button, and scouted-profile first-look. Pulled data already persists, so
  reload restores it. Verified: sync returns `remaining`, self-profile caught up = no banner, clean.
- [ ] **This-season / all-time VIEW toggle** (the chosen scope answer) — a global filter that slices
  every view by the season cutoff, with an all-time roll-up. **next**
- [ ] Pagination for >100 games/queue; auto-resume a mid-pull reload (currently hourly-gated → manual
  Sync resumes); persist `remaining` server-side for the resume signal.
