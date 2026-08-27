import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import type { LiveCompanionResponse, LivePlayer, LiveMatchup, LiveBuild, LiveDraft, LiveDeepRead, LiveRecap, LiveRecapGoal } from "../../shared/types.ts";
import { api } from "../api.ts";
import { champSquare, champName, itemIcon, subscribeVersion } from "../ddragon.ts";
import { drainPull } from "../pull.ts";

const VERDICT: Record<string, { label: string; tone: "good" | "bad" | "neutral" }> = {
  clean_win: { label: "Clean win", tone: "good" },
  bad_win: { label: "Sloppy win", tone: "neutral" },
  good_loss: { label: "Good loss", tone: "good" },
  deserved_loss: { label: "Deserved loss", tone: "bad" },
  standard: { label: "Standard game", tone: "neutral" },
};
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 10) / 10}`);
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

const ROLE_LABEL: Record<string, string> = { TOP: "Top", JUNGLE: "Jungle", MID: "Mid", BOT: "Bot", SUPPORT: "Support", UNKNOWN: "" };
const roleTxt = (r: string | null | undefined) => (r ? ROLE_LABEL[r] ?? "" : "");

// LCU gameflow phases → friendly text, so the status line reads plainly.
const PHASE_LABEL: Record<string, string> = {
  None: "in the client", Lobby: "in a lobby", Matchmaking: "in queue", ReadyCheck: "in ready check",
  ChampSelect: "in champ select", InProgress: "in game", Reconnect: "reconnecting",
  PreEndOfGame: "wrapping up", EndOfGame: "in post-game", WaitingForStats: "loading stats",
};
const phaseTxt = (p: string | undefined) => (p ? PHASE_LABEL[p] ?? p : "");

// ---- small pieces ----------------------------------------------------------

function ChampChip({ p, laner, you, onPick }: { p: LivePlayer; laner?: boolean; you?: boolean; onPick?: () => void }) {
  const clickable = !!onPick;
  return (
    <div
      className={`live-chip ${laner ? "laner" : ""} ${you ? "you" : ""} ${clickable ? "pickable" : ""}`}
      title={you ? "This is you" : laner ? "Your matchup — click another enemy to change it" : clickable ? "Set as your matchup opponent" : undefined}
      onClick={onPick}
      role={clickable ? "button" : undefined}
    >
      <img src={champSquare(p.champion)} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
      <div className="live-chip-txt">
        <span className="live-chip-name">{champName(p.champion)}{you && <span className="live-you-badge">YOU</span>}</span>
        {roleTxt(p.role) && <span className="live-chip-role">{roleTxt(p.role)}</span>}
      </div>
    </div>
  );
}

function TeamRow({ label, players, tone, lanerChamp, youChamp, onPick }: {
  label: string; players: LivePlayer[]; tone: "you" | "enemy";
  lanerChamp?: string | null; youChamp?: string | null; onPick?: (champ: string) => void;
}) {
  return (
    <div className={`live-team ${tone}`}>
      <span className="live-team-lbl">{label}</span>
      <div className="live-team-row">
        {players.length ? players.map((p, i) => (
          <ChampChip
            key={i}
            p={p}
            laner={tone === "enemy" && !!lanerChamp && p.champion === lanerChamp}
            you={tone === "you" && !!youChamp && p.champion === youChamp}
            onPick={tone === "enemy" && onPick ? () => onPick(p.champion) : undefined}
          />
        )) : <span className="faint">—</span>}
      </div>
    </div>
  );
}

function MatchupCard({ m, hasLanes }: { m: LiveMatchup; hasLanes: boolean }) {
  return (
    <section className="card live-card" data-nav="Matchup">
      <div className="live-card-h">
        <h2 className="section-title-inline"><i className="ti ti-swords" aria-hidden="true" /> Your matchup</h2>
        <div className="live-matchup-vs">
          <img src={champSquare(m.champion)} alt="" title={champName(m.champion)} />
          {m.opponent ? (
            <>
              <span className="live-vs">vs</span>
              <img src={champSquare(m.opponent)} alt="" title={champName(m.opponent)} />
            </>
          ) : null}
        </div>
      </div>

      <div className="live-matchup-head">
        <div className="live-wr">
          {m.opponent && m.vsGames > 0 ? (
            <><b>{m.vsWinRate}%</b><span className="faint"> WR · {m.vsGames} vs {champName(m.opponent)}</span></>
          ) : (
            <><b>{m.champWinRate ?? "—"}%</b><span className="faint"> WR · {m.champGames} on {champName(m.champion)}</span></>
          )}
        </div>
      </div>
      <p className="live-note">{m.note}{m.opponent ? " Pick a different enemy above to compare against them." : ""}</p>

      {m.stats.length > 0 && (
        <div className="live-stats">
          {m.stats.map((s, i) => (
            <div key={i} className={`live-stat ${s.tone}`}>
              <span className="live-stat-v">{s.value}</span>
              <span className="live-stat-l">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="live-lists">
        <div className="live-list good">
          <div className="live-list-h"><i className="ti ti-check" aria-hidden="true" /> What you do well</div>
          <ul>{m.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
        <div className="live-list bad">
          <div className="live-list-h"><i className="ti ti-target" aria-hidden="true" /> Focus this game</div>
          <ul>{m.focus.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

function CompBar({ profile }: { profile: LiveBuild["profile"] }) {
  const bits: { k: string; v: number; c: string }[] = [
    { k: "AD", v: profile.ad, c: "ad" }, { k: "AP", v: profile.ap, c: "ap" },
    { k: "Tank", v: profile.tank, c: "tank" }, { k: "CC", v: profile.cc, c: "cc" }, { k: "Heal", v: profile.healing, c: "heal" },
  ].filter((b) => b.v > 0);
  return (
    <div className="live-comp">
      {bits.map((b) => (
        <span key={b.k} className={`live-comp-tag ${b.c}`}>{b.k} ×{b.v}</span>
      ))}
    </div>
  );
}

function BuildCard({ b }: { b: LiveBuild }) {
  const recIdx = Math.max(0, b.options.findIndex((o) => o.recommended));
  const optKey = b.options.map((o) => o.id).join(",");
  const [sel, setSel] = useState(recIdx);
  useEffect(() => { setSel(Math.max(0, b.options.findIndex((o) => o.recommended))); }, [optKey]);
  const opt = b.options[sel] ?? b.options[0];
  if (!opt) return null;
  return (
    <section className="card live-card" data-nav="Build">
      <div className="live-card-h">
        <h2 className="section-title-inline"><i className="ti ti-shield-bolt" aria-hidden="true" /> Build path</h2>
        <CompBar profile={b.profile} />
      </div>
      {b.teamNeeds.length > 0 && (
        <ul className="live-team-needs">{b.teamNeeds.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}
      {b.options.length > 1 && (
        <div className="live-build-tabs">
          {b.options.map((o, i) => (
            <button key={o.id} className={`live-build-tab ${i === sel ? "on" : ""}`} onClick={() => setSel(i)} title={o.blurb}>
              {o.recommended && <i className="ti ti-star-filled" aria-hidden="true" />}{o.label}
            </button>
          ))}
        </div>
      )}
      <p className="live-build-fit">{opt.recommended && <span className="live-rec-badge">PICK</span>}{opt.fit}</p>
      <div className="live-phases">
        {opt.phases.map((ph, pi) => (
          <div key={pi} className="live-phase">
            <div className="live-phase-head">
              <span className="live-phase-name">{ph.phase}</span>
              <span className="live-phase-when">{ph.when}</span>
            </div>
            <div className="live-items">
              {ph.items.map((it, i) => (
                <div key={i} className="live-item">
                  {itemIcon(it.itemId ?? 0) ? <img src={itemIcon(it.itemId ?? 0)!} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} /> : <span className="live-item-ph"><i className="ti ti-sparkles" aria-hidden="true" /></span>}
                  <div><span className="live-item-name">{it.name}</span><span className="live-item-reason">{it.reason}</span></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DraftCard({ d }: { d: LiveDraft }) {
  const badge = d.favored === "you" ? { t: "Edge: you", c: "good" } : d.favored === "enemy" ? { t: "Edge: enemy", c: "bad" } : { t: "Even draft", c: "neutral" };
  // Compact but complete: the verdict line + damage lean, then the key notes as
  // one tight tone-colored list (play-to green, watch-for red).
  const notes = [
    ...d.yourNotes.map((t) => ({ t, tone: "good" as const })),
    ...d.enemyNotes.map((t) => ({ t, tone: "bad" as const })),
  ].slice(0, 4);
  return (
    <section className="card live-card live-draft" data-nav="Draft">
      <div className="live-card-h">
        <h2 className="section-title-inline"><i className="ti ti-chart-arcs" aria-hidden="true" /> Draft</h2>
        <span className={`live-badge ${badge.c}`}>{badge.t}</span>
      </div>
      <p className="live-note"><b>You: {d.yourDamage} · Enemy: {d.enemyDamage}.</b> {d.readout}</p>
      {notes.length > 0 && (
        <ul className="live-draft-notes">
          {notes.map((n, i) => (
            <li key={i} className={n.tone}><i className={`ti ${n.tone === "good" ? "ti-arrow-up-right" : "ti-alert-triangle"}`} aria-hidden="true" />{n.t}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeepReadCard({ read, loading, err, onRun }: { read: LiveDeepRead | null; loading: boolean; err: string | null; onRun: () => void }) {
  return (
    <section className="card live-card live-deep" data-nav="Deep read">
      <div className="live-card-h">
        <h2 className="section-title-inline"><i className="ti ti-sparkles" aria-hidden="true" /> Deep read <span className="live-deep-badge">AI</span></h2>
        {read?.available && !loading && (
          <button className="ghost sm" onClick={onRun} title="Regenerate"><i className="ti ti-refresh" aria-hidden="true" /></button>
        )}
      </div>

      {loading ? (
        <p className="live-note"><i className="ti ti-loader-2 spin" aria-hidden="true" /> Reading the draft, your history, and both comps…</p>
      ) : err ? (
        <div className="live-deep-empty"><i className="ti ti-alert-circle" aria-hidden="true" /> {err}</div>
      ) : read == null ? (
        <>
          <p className="live-note">A Claude-written synthesis — win condition, phase-by-phase plan, a personal matchup read, key threats, and build timing. Auto-generates once all enemies are locked in.</p>
          <button className="primary sm" onClick={onRun}><i className="ti ti-sparkles" aria-hidden="true" /> Generate now</button>
        </>
      ) : !read.available ? (
        <div className="live-deep-empty"><i className="ti ti-plug-off" aria-hidden="true" /> {read.reason}</div>
      ) : (
        <div className="live-deep-body">
          {read.headline && <p className="live-deep-headline">{read.headline}</p>}
          {read.winCondition && (
            <div className="live-deep-win"><span className="live-deep-lbl">Win condition</span><p>{read.winCondition}</p></div>
          )}
          {read.matchupPlan && (
            <div className="live-deep-sec"><div className="live-deep-h"><i className="ti ti-user-bolt" aria-hidden="true" /> Your matchup</div><p>{read.matchupPlan}</p></div>
          )}
          {read.gamePlan && read.gamePlan.length > 0 && (
            <div className="live-deep-sec">
              <div className="live-deep-h"><i className="ti ti-timeline-event" aria-hidden="true" /> Game plan</div>
              <div className="live-deep-phases">
                {read.gamePlan.map((p, i) => (
                  <div key={i} className="live-deep-phase"><span className="live-deep-phase-lbl">{p.phase}</span><p>{p.advice}</p></div>
                ))}
              </div>
            </div>
          )}
          {read.keyThreats && read.keyThreats.length > 0 && (
            <div className="live-deep-sec">
              <div className="live-deep-h bad"><i className="ti ti-alert-triangle" aria-hidden="true" /> Key threats</div>
              <ul className="live-deep-threats">{read.keyThreats.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          {read.buildNote && (
            <div className="live-deep-sec"><div className="live-deep-h"><i className="ti ti-shield-bolt" aria-hidden="true" /> Build note</div><p>{read.buildNote}</p></div>
          )}
        </div>
      )}
    </section>
  );
}

function RecapGoalRow({ g }: { g: LiveRecapGoal }) {
  const cmp = g.direction === "lower" ? "≤" : "≥";
  const arrow = g.moved === "up" ? "ti-arrow-up-right" : g.moved === "down" ? "ti-arrow-down-right" : "ti-minus";
  const count = g.kind === "count";
  // count: did this game add to the tally? avg: did it clear the per-game bar?
  const right = g.gameValue == null
    ? <span className="faint live-recap-goal-val">not tracked this game</span>
    : count
      ? <span className={`live-recap-goal-val ${g.metThisGame ? "good" : "neutral"}`}>{g.metThisGame ? "+1 this game" : "didn't count"} <i className={`ti ${g.metThisGame ? "ti-plus" : "ti-minus"}`} aria-hidden="true" /></span>
      : <span className={`live-recap-goal-val ${g.metThisGame ? "good" : "bad"}`}>{fmtNum(g.gameValue)} {g.unit} <i className={`ti ${g.metThisGame ? "ti-check" : "ti-x"}`} aria-hidden="true" /></span>;
  const sub = count
    ? `${fmtNum(g.runningAfter)} / ${fmtNum(g.target)} ${g.unit}`
    : `Block avg ${fmtNum(g.runningBefore)} → ${fmtNum(g.runningAfter)} (${cmp}${fmtNum(g.target)} target)`;
  return (
    <div className="live-recap-goal">
      <div className="live-recap-goal-h">
        <span className="live-recap-goal-title">{g.title}</span>
        {right}
      </div>
      <div className="live-recap-goal-run">
        <span className="faint">{sub}</span>
        <i className={`ti ${arrow} live-move ${g.moved}`} aria-hidden="true" />
      </div>
    </div>
  );
}

function RecapStat({ label, value }: { label: string; value: string }) {
  return <div className="live-stat neutral"><span className="live-stat-v">{value}</span><span className="live-stat-l">{label}</span></div>;
}

function RecapCard({ recap }: { recap: LiveRecap }) {
  const r = recap;
  const isArena = r.placement != null;
  const won = isArena ? (r.placement ?? 9) <= 4 : r.win === true;
  const result = isArena ? `${ORDINAL[r.placement!] ?? r.placement + "th"} place` : r.win ? "Victory" : "Defeat";
  const v = r.verdict ? VERDICT[r.verdict] : null;
  const dur = r.durationSec ? `${Math.round(r.durationSec / 60)} min` : null;
  const stats: { label: string; value: string }[] = [];
  stats.push({ label: "KDA", value: fmtNum(r.kda) });
  if (r.cs != null) stats.push({ label: "CS", value: `${r.cs}${r.csPerMin != null ? ` (${fmtNum(r.csPerMin)}/m)` : ""}` });
  if (r.kp != null) stats.push({ label: "Kill part.", value: `${Math.round(r.kp * 100)}%` });
  if (r.damageShare != null) stats.push({ label: "Dmg share", value: `${Math.round(r.damageShare * 100)}%` });
  if (r.damage != null) stats.push({ label: "Damage", value: `${(r.damage / 1000).toFixed(1)}k` });
  if (r.vision != null) stats.push({ label: "Vision", value: `${r.vision}` });
  return (
    <section className="card live-card live-recap" data-nav="Last game">
      <div className="live-card-h">
        <h2 className="section-title-inline"><i className="ti ti-history" aria-hidden="true" /> Last game</h2>
        {r.matchId && (
          <Link className="primary sm" to={`/match/${r.matchId}`}>Full match detail <i className="ti ti-arrow-right" aria-hidden="true" /></Link>
        )}
      </div>

      <div className="live-recap-hero">
        {r.champion && <img className="live-recap-champ" src={champSquare(r.champion)} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />}
        <div className="live-recap-lines">
          <div className={`live-recap-result ${won ? "win" : "loss"}`}>{result}</div>
          <div className="faint live-recap-sub">
            {r.mode}{r.champion ? ` · ${champName(r.champion)}` : ""} · {r.kills}/{r.deaths}/{r.assists}{dur ? ` · ${dur}` : ""}
          </div>
        </div>
        <div className="live-recap-proc">
          <span className="live-recap-score">{r.processScore ?? "—"}</span>
          <span className="faint">process</span>
        </div>
      </div>

      <div className="live-recap-chips">
        {v && <span className={`live-badge ${v.tone}`}>{v.label}</span>}
        {typeof r.xp === "number" && r.xp > 0 && <span className="live-recap-xp">+{r.xp} XP</span>}
        {(r.highlights ?? []).slice(0, 4).map((h, i) => (
          <span key={i} className={`live-recap-tag ${h.tone}`} title={h.hint}>{h.label}</span>
        ))}
      </div>

      <div className="live-stats">{stats.map((s, i) => <RecapStat key={i} label={s.label} value={s.value} />)}</div>

      {(r.didWell?.length || r.workOn?.length) ? (
        <div className="live-lists">
          <div className="live-list good">
            <div className="live-list-h"><i className="ti ti-thumb-up" aria-hidden="true" /> Did well — keep it up</div>
            <ul>{(r.didWell ?? []).map((p, i) => <li key={i}><b>{p.label}.</b> {p.detail}</li>)}
              {(r.didWell ?? []).length === 0 && <li className="faint">Nothing stood out — grind a cleaner game.</li>}
            </ul>
          </div>
          <div className="live-list bad">
            <div className="live-list-h"><i className="ti ti-target" aria-hidden="true" /> Work on next game</div>
            <ul>{(r.workOn ?? []).map((p, i) => <li key={i}><b>{p.label}.</b> {p.detail}</li>)}
              {(r.workOn ?? []).length === 0 && <li className="faint">No glaring leaks this game — nice.</li>}
            </ul>
          </div>
        </div>
      ) : null}

      {r.goals && r.goals.length > 0 ? (
        <div className="live-recap-goals">
          <div className="live-recap-goals-h"><i className="ti ti-target-arrow" aria-hidden="true" /> Goal progress from this game</div>
          {r.goals.map((g, i) => <RecapGoalRow key={i} g={g} />)}
        </div>
      ) : (
        <p className="faint" style={{ margin: 0, fontSize: "0.84rem" }}>No active block goals — start a block to track goal progress per game.</p>
      )}
    </section>
  );
}

// ---- page ------------------------------------------------------------------

export default function Live() {
  const [params, setParams] = useSearchParams();
  const [sample, setSample] = useState(params.get("mock") === "1");
  const [data, setData] = useState<LiveCompanionResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deep, setDeep] = useState<LiveDeepRead | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepErr, setDeepErr] = useState<string | null>(null);
  // The last readout we had (champ select or in-game) — held through the loading
  // screen so the draft readout survives until the live game data comes online.
  const [lastActive, setLastActive] = useState<LiveCompanionResponse | null>(null);
  const [recap, setRecap] = useState<LiveRecap | null>(null);
  // The enemy the user designated as their matchup opponent (null = deterministic).
  const [opponent, setOpponent] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => subscribeVersion(() => force((n) => n + 1)), []);

  const load = useCallback(() => {
    api.live(sample, opponent).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(String(e?.message ?? e)));
  }, [sample, opponent]);

  // Poll while live. Champ select changes pick-by-pick, so refetch the full
  // companion every 4s. Once you're in a running game the readout is fixed until
  // it ends — so we only poll a cheap status check and refetch the full data when
  // the game actually finishes, instead of re-enriching your whole history each tick.
  const inRunningGame = !!data && data.inGame && data.phase === "InProgress";
  useEffect(() => {
    load();
    if (sample) return;
    const tick = inRunningGame
      ? () => { api.liveStatus().then((s) => { if (!s.inGame || s.phase !== "InProgress") load(); }).catch(() => {}); }
      : load;
    const t = setInterval(tick, inRunningGame ? 15000 : 4000);
    return () => clearInterval(t);
  }, [load, sample, inRunningGame]);

  // Hold the last readout across the champ-select → loading → in-game handoff.
  // Update it whenever we have a live readout; drop it once we settle into a
  // lobby / post-game state so a stale draft never bridges into a new game.
  useEffect(() => {
    if (!data || sample) return;
    if (data.inGame) setLastActive(data);
    else if (/None|Lobby|Matchmaking|ReadyCheck|EndOfGame|PreEndOfGame|WaitingForStats/i.test(data.phase)) setLastActive(null);
  }, [data, sample]);

  const loadRecap = useCallback(() => {
    if (sample) return;
    api.liveRecap().then(setRecap).catch(() => {});
  }, [sample]);

  // Recap on mount + whenever data changes on the server (syncs dispatch this).
  useEffect(() => {
    loadRecap();
    const h = () => loadRecap();
    window.addEventListener("data:refresh", h);
    return () => window.removeEventListener("data:refresh", h);
  }, [loadRecap]);

  // Game just ended (was in a running game, now not) — pull it so the recap is
  // fresh. Riot publishes the finished game with a delay, so retry the recap a
  // few times over the next ~90s until it appears (drainPull also dispatches
  // data:refresh, which reloads the recap too).
  const wasInGame = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    const inGameNow = !!data && data.inGame && data.phase === "InProgress";
    if (wasInGame.current && !inGameNow && !sample) {
      drainPull({ force: true }).catch(() => {});
      loadRecap();
      if (retryTimer.current) clearInterval(retryTimer.current);
      let n = 0;
      retryTimer.current = setInterval(() => {
        drainPull({ force: true }).catch(() => {});
        loadRecap();
        if (++n >= 6 && retryTimer.current) clearInterval(retryTimer.current);
      }, 15000);
    }
    wasInGame.current = inGameNow;
  }, [data, sample, loadRecap]);
  useEffect(() => () => { if (retryTimer.current) clearInterval(retryTimer.current); }, []);

  // Loading bridge: not active, but a game is starting/ongoing with no live data
  // yet — keep showing the held readout instead of dropping to the empty state.
  const active = data && data.inGame;
  const bridging = !active && !!lastActive && !sample && !!data && /InProgress|GameStart|Reconnect|WaitingForStats/i.test(data.phase);
  const shown = active ? data : bridging ? lastActive : null;

  // Comp signature (mine + enemies). A new comp = a new game → reset the chosen
  // opponent and the deep read.
  const compSig = shown ? `${shown.mine?.champion ?? ""}|${[...shown.enemies].map((e) => e.champion).sort().join(",")}` : "";
  const lastComp = useRef(compSig);
  useEffect(() => {
    if (compSig !== lastComp.current) { lastComp.current = compSig; setOpponent(null); setDeep(null); setDeepErr(null); setDeepLoading(false); }
  }, [compSig]);
  // The deep read is opponent-specific too — invalidate it when the pick changes.
  const lastOpp = useRef(opponent);
  useEffect(() => {
    if (opponent !== lastOpp.current) { lastOpp.current = opponent; setDeep(null); setDeepErr(null); setDeepLoading(false); }
  }, [opponent]);

  const loadDeep = useCallback(() => {
    setDeepLoading(true); setDeepErr(null);
    api.liveDeep(sample, opponent)
      .then((d) => setDeep(d))
      .catch((e) => setDeepErr(String(e?.message ?? e)))
      .finally(() => setDeepLoading(false));
  }, [sample, opponent]);

  // Auto-generate the deep read once the full enemy comp is known (all 5 locked
  // in champ select, or in-game). The server caches it per comp, so if a poll
  // ever clears it, this regenerates from cache instantly (and for free) — it
  // never has to be manually re-triggered. Stops on error so failures don't spam.
  const enemiesComplete = !!shown && shown.enemies.length >= 5;
  useEffect(() => {
    if (sample || !enemiesComplete) return;
    if (deep || deepLoading || deepErr) return;
    loadDeep();
  }, [sample, enemiesComplete, deep, deepLoading, deepErr, loadDeep]);

  const useSample = () => { setSample(true); setParams({ mock: "1" }); };
  const useLive = () => { setSample(false); setParams({}); };

  const connected = data && (data.clientDetected || data.source === "mock");

  const statusLevel = !data ? "off" : sample ? "on" : bridging ? "wait" : !connected ? "off" : !active ? "wait" : "on";
  const statusText = sample
    ? "Sample game — this is what champ select and an in-game readout look like."
    : bridging ? "Game starting — holding your draft readout until the live game loads…"
    : !data ? "Checking for your League client…"
    : !connected ? "No League client detected on this PC — open League and this activates automatically."
    : !active ? `Client detected — you're ${phaseTxt(data.phase)}. The companion fills in once you're in champ select.`
    : `${data.mode} · ${data.source === "mock" ? "sample" : data.phase === "InProgress" ? "in game" : "champ select"}`;

  return (
    <div className="live-page">
      <div className="live-top" data-nav="Live companion">
        <div>
          <h1 className="live-title"><i className="ti ti-broadcast" aria-hidden="true" /> Live companion</h1>
          <div className={`live-status ${statusLevel}`}>
            <span className="live-dot" aria-hidden="true" />
            <span>{statusText}</span>
          </div>
        </div>
        <div className="live-top-actions">
          {shown && shown.mode !== "—" && <span className="live-mode">{shown.mode}</span>}
          {sample ? (
            <button className="ghost sm" onClick={useLive}><i className="ti ti-plug" aria-hidden="true" /> Use live client</button>
          ) : (
            <button className="ghost sm" onClick={useSample}><i className="ti ti-eye" aria-hidden="true" /> Preview with sample</button>
          )}
          {!sample && <button className="ghost sm" onClick={load} title="Refresh now"><i className="ti ti-refresh" aria-hidden="true" /></button>}
        </div>
      </div>

      {err && <div className="live-empty"><i className="ti ti-alert-circle" aria-hidden="true" /> {err}</div>}

      {shown ? (
        <>
          {bridging && (
            <div className="live-bridge"><i className="ti ti-loader-2 spin" aria-hidden="true" /> Game starting — holding your draft readout until the live game loads.</div>
          )}
          <section className="card live-card" data-nav="Teams">
            <TeamRow label="Your team" players={shown.mine ? [shown.mine, ...shown.allies] : shown.allies} tone="you" youChamp={shown.mine?.champion ?? null} />
            <TeamRow label="Enemy team" players={shown.enemies} tone="enemy" lanerChamp={shown.enemyLaner?.champion ?? null} onPick={setOpponent} />
          </section>

          {shown.matchup && <MatchupCard m={shown.matchup} hasLanes={shown.hasLanes} />}
          {shown.build && <BuildCard b={shown.build} />}
          {shown.draft && <DraftCard d={shown.draft} />}
          <DeepReadCard read={deep} loading={deepLoading} err={deepErr} onRun={loadDeep} />
        </>
      ) : (
        <>
          {recap?.available && <RecapCard recap={recap} />}
          {(!recap?.available || !connected) ? (
            <div className="live-empty">
              <i className={`ti ${connected ? "ti-hourglass-high" : "ti-broadcast-off"}`} aria-hidden="true" />
              <p><b>{connected ? `Client detected — you're ${phaseTxt(data?.phase)}.` : "Start League and pick a champion."}</b></p>
              <p className="faint">
                {connected
                  ? "The companion fills in the moment you enter champ select. Sit tight — this page is watching your client and refreshes on its own."
                  : "When you're in champ select or a game on this PC, this page reads it locally and shows your matchup history vs the enemy laner, a build tuned to their comp, and a draft readout. Nothing leaves your machine."}
              </p>
              {!connected && <button className="primary sm" onClick={useSample}><i className="ti ti-eye" aria-hidden="true" /> Preview with sample data</button>}
            </div>
          ) : (
            <div className="live-waiting"><i className="ti ti-hourglass-low" aria-hidden="true" /> Waiting for your next champ select — you're {phaseTxt(data?.phase)}.</div>
          )}
        </>
      )}
    </div>
  );
}
