import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  DashboardResponse,
  EnrichedMatch,
  Verdict,
  StatCard,
  NextGamePlan,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { drainPull, noteRemaining } from "../pull.ts";
import { Bar, roleLabel, queueLabel } from "../ui.tsx";
import { loadFilter, subscribeFilter, gameTypeLabel } from "../globalFilter.ts";
import { champSquare, champSplash, champName, subscribeVersion } from "../ddragon.ts";

const VERDICT_LABEL: Record<Verdict, string> = {
  clean_win: "Clean win",
  bad_win: "Bad win",
  good_loss: "Good loss",
  deserved_loss: "Deserved loss",
  standard: "Standard",
};

// Small square avatars use the clean square icon; the block hero wants the tall
// splash. Re-render once the live patch version resolves.
function ChampImg({ champ, splash = false }: { champ: string; splash?: boolean }) {
  const [ok, setOk] = useState(true);
  const [, force] = useState(0);
  useEffect(() => subscribeVersion(() => force((n) => n + 1)), []);
  useEffect(() => setOk(true), [champ]);
  if (!ok) return <i className="ti ti-shield-half" style={{ color: "#4d453a", fontSize: 18 }} aria-hidden="true" />;
  return <img src={splash ? champSplash(champ) : champSquare(champ)} alt={champ} onError={() => setOk(false)} />;
}

export default function Dashboard({ scouting = false }: { scouting?: boolean }) {
  const [d, setD] = useState<DashboardResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilterState] = useState(loadFilter);
  const queue = filter.queue;
  const [plan, setPlan] = useState<NextGamePlan | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [coachMode, setCoachModeState] = useState<"llm" | "engine">("llm");
  const [params] = useSearchParams();
  const focusParam = params.get("focus");

  function reload(f = filter) {
    api.dashboard(f.queue, f.role).then((d) => {
      setD(d);
      // A backlog is still queued on the server — show the banner and resume the
      // pull (safe to call repeatedly; it no-ops while already draining).
      if ((d.pullRemaining ?? 0) > 0) { noteRemaining(d.pullRemaining!); drainPull({ force: true }); }
    }).catch((e) => setErr(String(e.message)));
    if (!scouting) { setPlan(null); api.coachPlan(f.queue).then((r) => { setPlan(r.plan); if (r.mode) setCoachModeState(r.mode); }).catch((e) => setPlanErr(String(e.message))); }
  }

  async function toggleCoachMode(m: "llm" | "engine") {
    setCoachModeState(m);
    setReplanning(true);
    try { await api.setCoachMode(m); const r = await api.refreshCoachPlan(filter.queue); setPlan(r.plan); }
    catch (e) { setPlanErr(String((e as Error).message)); }
    finally { setReplanning(false); }
  }

  // Re-fetch whenever the global game-type/role filter changes (dashboard + coach).
  useEffect(() => subscribeFilter(setFilterState), []);
  useEffect(() => {
    api.dashboard(filter.queue, filter.role).then(setD).catch((e) => setErr(String(e.message)));
    if (!scouting) { setPlan(null); api.coachPlan(filter.queue).then((r) => { setPlan(r.plan); if (r.mode) setCoachModeState(r.mode); }).catch((e) => setPlanErr(String(e.message))); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.queue, filter.role]);

  useEffect(() => {
    // Data streams in progressively; reload the dashboard as batches land.
    const onData = () => reload();
    window.addEventListener("data:refresh", onData);
    reload();
    // A viewed profile is synced by the Overview before mount; only your own
    // dashboard runs the quiet auto-sync (on load + hourly).
    if (scouting) { return () => window.removeEventListener("data:refresh", onData); }
    drainPull({ force: false });
    const iv = setInterval(() => drainPull({ force: false }), 60 * 60 * 1000);
    return () => { clearInterval(iv); window.removeEventListener("data:refresh", onData); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrived from a goal-complete notification: flash the Current block panel.
  useEffect(() => {
    if (!d || focusParam !== "block") return;
    const el = document.getElementById("current-block");
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 2200);
    }, 350);
    return () => clearTimeout(t);
  }, [d, focusParam]);

  async function replan() {
    setReplanning(true);
    try {
      const r = await api.refreshCoachPlan(filter.queue);
      setPlan(r.plan);
    } catch (e) {
      setPlanErr(String((e as Error).message));
    } finally {
      setReplanning(false);
    }
  }

  async function doSync() {
    setSyncing(true);
    setSyncNote("Pulling this season's games…");
    try {
      await drainPull({ force: true });
      reload();
      setSyncNote("Up to date for this season.");
    } catch (e) {
      setSyncNote(String((e as Error).message));
    } finally {
      setSyncing(false);
    }
  }

  if (err) return <div className="empty">Couldn't load: {err}</div>;
  if (!d) return <div className="empty">Loading…</div>;

  const { season, profile, statBoard, briefing, goals, currentSession, insights, champions, recentMatches } = d;
  const stopRail = currentSession?.guardrails.find((g) => g.severity === "stop");
  const heroChamp = briefing?.champion ?? d.focusChampion.champion;
  // A champion block should picture ITS champion, not your overall best.
  const blockChamp = season?.focusChampion ?? heroChamp;
  const blockStat = blockChamp ? champions.find((c) => c.champion === blockChamp) : null;
  const focusGoal = [...goals].filter((g) => !g.met).sort((a, b) => a.pct - b.pct)[0];

  return (
    <>
      {/* ---- The coach: what's next (your own dashboard only) ---- */}
      {!scouting && (
        <div data-nav="Coach">
          <CoachHero
            plan={plan}
            err={planErr}
            replanning={replanning}
            onReplan={replan}
            syncing={syncing}
            syncNote={syncNote}
            onSync={doSync}
            mode={coachMode}
            onToggleMode={toggleCoachMode}
          />
        </div>
      )}

      <div className="dash-cols">
      <div className="dash-left">
      {/* ---- Profile header ---- */}
      <div className="card" data-nav="Profile">
        <div className="profile-head">
          {(() => {
            const shownChamp = profile.topChampion ?? heroChamp;
            const shownStat = champions.find((c) => c.champion === shownChamp);
            return (
              <div className="pf-avatar" title={shownChamp ? `Most-played: ${champName(shownChamp)}${shownStat ? ` — ${shownStat.games} games this season` : ""}` : "Your profile"}>
                {shownChamp ? <ChampImg champ={shownChamp} /> : <i className="ti ti-user" style={{ color: "#4d453a", fontSize: 22 }} aria-hidden="true" />}
                {shownStat && <span className="pf-lvl" title={`${shownStat.games} games on ${champName(shownChamp!)}`}>{shownStat.games}g</span>}
              </div>
            );
          })()}
          <div className="pf-idcol">
            <div className="pf-topline">
              <div className="pf-name">
                {profile.gameName ?? "Summoner"}
                {profile.tagLine && <span className="tag"> #{profile.tagLine}</span>}
              </div>
              <span className="pf-rank" style={{ color: profile.tier ? rankColor(profile.tier) : "var(--faint)" }} title={`${profile.rankQueue} rank`}>
                {profile.tier ? `${cap(profile.tier)}${profile.division ? ` ${profile.division}` : ""}` : "Unranked"}
                {profile.leaguePoints != null && <span className="pf-rank-lp"> · {profile.leaguePoints} LP</span>}
                <span className="pf-rank-q"> · {profile.rankQueue}</span>
              </span>
            </div>
            <div className="pf-sub">
              {profile.games} games · {profile.winRate}% WR ({profile.wins}W {profile.losses}L)
            </div>
          </div>
        </div>
        <div className="pf-showing mlbl" style={{ marginTop: 12 }}>
          <i className="ti ti-filter" aria-hidden="true" /> Showing <b>{gameTypeLabel(filter.queue)}</b>{filter.role ? <> · <b>{filter.role[0] + filter.role.slice(1).toLowerCase()}</b></> : null} — change it up top.
        </div>
        {!scouting && (
          <div className="pf-sync">
            <button className="sm" onClick={doSync} disabled={syncing}>
              <i className={`ti ti-${syncing ? "loader-2 spin" : "refresh"}`} aria-hidden="true" /> {syncing ? "Syncing…" : "Sync my games"}
            </button>
            {syncNote && <span className="faint" style={{ fontSize: "0.75rem" }}>{syncNote}</span>}
          </div>
        )}
      </div>

      {queue === "aram" && (
        <div className="banner info mt">
          <div className="icon"><i className="ti ti-snowflake" aria-hidden="true" /></div>
          <div>
            <div className="title">ARAM view</div>
            <div className="msg">No lanes, no CS races — this board swaps to what actually matters on the Bridge: kills, damage, and kill participation.</div>
          </div>
        </div>
      )}

      {stopRail && (
        <div className="banner stop mt">
          <div className="icon"><i className="ti ti-hand-stop" aria-hidden="true" /></div>
          <div><div className="title">{stopRail.title}</div><div className="msg">{stopRail.message}</div></div>
        </div>
      )}
      {d.borrowedLp.borrowed && (
        <div className="banner caution mt">
          <div className="icon"><i className="ti ti-alert-triangle" aria-hidden="true" /></div>
          <div><div className="title">Borrowed LP</div><div className="msg">{d.borrowedLp.message}</div></div>
        </div>
      )}

      {/* ---- Current block: the "what do I do right now" focus, up top ---- */}
      {season && (
        <>
          <div className="section-title">
            <h2>Current block</h2>
            <Link to="/seasons" className="more">Manage</Link>
          </div>
          <div className="card block-focus" id="current-block">
            <div className={`blockhero ${season.focusChampion ? "champ-block" : ""}`}>
              <div className="hero-portrait">
                <i className="ti ti-shield-half ph-fallback" aria-hidden="true" />
                {blockChamp && <ChampImg champ={blockChamp} splash />}
                {blockChamp && (
                  <div className="ph-name"><div className="n">{champName(blockChamp)}</div><div className="r">{blockStat ? `${blockStat.masteryRank} · ${blockStat.games} games` : `${briefing?.role ?? "Top"} · ${briefing?.poolTier ?? "main"}`}</div></div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex" style={{ justifyContent: "space-between" }}>
                  <span className="mlbl" style={{ color: "var(--accent)" }}>{season.name}</span>
                  <span className="mn" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{d.gamesLogged} / {season.targetGames}</span>
                </div>
                <div className="bar" style={{ margin: "8px 0 12px" }}><div style={{ width: `${Math.min(100, (d.gamesLogged / Math.max(1, season.targetGames)) * 100)}%` }} /></div>
                {season.theme && <div className="muted" style={{ fontSize: "0.86rem" }}>{season.theme}</div>}
                <div className="flex wrap" style={{ gap: 20, marginTop: 12 }}>
                  <div>
                    <div className="mlbl" style={{ marginBottom: 5 }}>Recommended pick</div>
                    <div className="flex" style={{ gap: 6 }}>
                      <span className="rec-chip" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><i className="ti ti-arrow-up" aria-hidden="true" />{briefing?.role ?? "Top"}</span>
                      {blockChamp && <Link to={`/champions/${blockChamp}`} className="rec-chip" style={{ background: "var(--bg-elev)", color: "var(--text)" }}>{blockChamp}</Link>}
                    </div>
                  </div>
                  {(blockStat ?? briefing?.mastery) && (
                    <div>
                      <div className="mlbl" style={{ marginBottom: 5 }}>Your baseline on {champName(blockChamp!)}</div>
                      <div className="mn" style={{ fontSize: "0.86rem" }}>
                        {blockStat
                          ? `${blockStat.winRate}% WR · ${blockStat.avgProcess} perf · ${blockStat.games} games`
                          : `${briefing!.mastery!.winRate}% WR · ${briefing!.mastery!.avgProcess} perf · ${briefing!.mastery!.games} games`}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* quests inline */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div className="flex" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                <span className="mlbl" style={{ color: "var(--accent)" }}>Active quests</span>
                {focusGoal && <span className="muted" style={{ fontSize: "0.8rem" }}>focus: {focusGoal.goal.title.toLowerCase()}</span>}
              </div>
              {goals.length === 0 ? (
                <div className="muted" style={{ fontSize: "0.86rem" }}>No quests yet. <Link to="/seasons">Add some</Link>.</div>
              ) : goals.slice(0, 3).map((g) => (
                <Link to="/seasons" className="quest-row" key={g.goal.id}>
                  <div className="qr-head">
                    <span className="qr-title">{g.goal.title}</span>
                    <span className="mn qr-num" style={{ color: g.met ? "var(--green)" : "var(--muted)" }}>{g.current ?? "—"}/{g.goal.target}</span>
                  </div>
                  <Bar value={g.pct} max={100} variant={g.met ? "green" : undefined} />
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---- Quick stats board (mini-graphs) ---- */}
      <div className="section-title">
        <h2>Quick stats</h2>
        <span className="tag">last 10 games vs. the 10 before</span>
      </div>
      <div className="statboard">
        {statBoard.map((c) => <StatTile key={c.id} c={c} />)}
      </div>

      </div>

      <div className="dash-main">
      {/* ---- Insights ---- */}
      {insights.length > 0 && (
        <>
          <div className="section-title"><h2>Insights</h2><span className="tag">how you actually win</span></div>
          <div className="card">
            {insights.map((ins) => {
              const body = (
                <>
                  <span className="ic"><i className={`ti ${ins.icon}`} aria-hidden="true" /></span>
                  <div style={{ flex: 1 }}><div className="it">{ins.title}</div><div className="id">{ins.detail}</div></div>
                  {ins.href && <i className="ti ti-chevron-right chev" aria-hidden="true" />}
                </>
              );
              return ins.href
                ? <Link to={ins.href} className={`insight ${ins.tone}`} key={ins.id}>{body}</Link>
                : <div className={`insight ${ins.tone}`} key={ins.id} style={{ cursor: "default" }}>{body}</div>;
            })}
          </div>
        </>
      )}

      {/* ---- Recent matches (5 most recent; full history on the Report page) ---- */}
      <div className="section-title">
        <h2>Recent matches</h2>
        <Link to="/matches" className="more">View more →</Link>
      </div>
      {recentMatches.length === 0 ? (
        <div className="card muted">No games yet.</div>
      ) : (
        <div className="card" style={{ padding: "6px 12px" }}>
          {recentMatches.slice(0, 8).map((m) => <MatchRow key={m.id} m={m} />)}
        </div>
      )}

      {/* ---- Champions (op.gg-style, with our tier + performance appended) ---- */}
      {champions.length > 0 && (
        <>
          <div className="section-title"><h2>Your champions</h2><span className="tag">most-played this window · tier &amp; performance are ours</span></div>
          <div className="card dpm-champs">
            {champions.slice(0, 7).map((c) => (
              <Link to={`/champions/${c.champion}`} className="dpm-champ" key={c.champion}>
                <span className="champ-sq dc-img"><ChampImg champ={c.champion} /></span>
                <div className="dc-id">
                  <div className="dc-name">
                    {c.champion}
                    <span className={`tierbadge sm ${c.personalTier}`}>{c.personalTier}</span>
                    {c.tier && <span className={`pill ${c.tier === "main" ? "green" : c.tier === "secondary" ? "accent" : "violet"}`}>{c.tier}</span>}
                  </div>
                  <div className="mlbl">CS {c.avgCs} ({c.csPerMin}) · M{c.masteryLevel}</div>
                </div>
                <div className="dc-kda">
                  <div className="mn" style={{ color: kdaColor(c.kda) }}>{c.kda.toFixed(2)}:1 KDA</div>
                  <div className="mlbl">{c.avgKills} / <span style={{ color: "var(--red)" }}>{c.avgDeaths}</span> / {c.avgAssists}</div>
                </div>
                <div className="dc-wr">
                  <div className="mn" style={{ color: c.winRate >= 55 ? "var(--green)" : c.winRate <= 45 ? "var(--red)" : "var(--text)" }}>{c.winRate}%</div>
                  <div className="mlbl">{c.games} games</div>
                </div>
                <span className="mn dc-perf" style={{ color: procColor(c.avgProcess) }} title="Your performance score">{c.avgProcess}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      </div>
      </div>
    </>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div className="sparkline-empty" />;
  const w = 100, h = 30;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 3 - ((v - min) / range) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatTile({ c }: { c: StatCard }) {
  // Color signals good/bad (better vs baseline); the arrow points by value change.
  const cls = c.better == null ? "flat" : c.better ? "up" : "down";
  const arrow = c.delta == null || c.delta === 0 ? "–" : c.delta > 0 ? "▲" : "▼";
  const sparkColor = c.better == null ? "var(--muted)" : c.better ? "var(--green)" : "var(--red)";
  return (
    <Link to={c.href ?? "/progress"} className="statcard sparkcard" title={c.hint}>
      <div className="sc-top">
        <span className="sc-label">{c.label}</span>
        {c.delta != null && (
          <span className={`sc-delta ${cls}`}>{arrow}{Math.abs(c.delta)}{c.unit === "%" ? "%" : ""}</span>
        )}
      </div>
      <div className="sc-value">{c.valueFmt}</div>
      <Sparkline data={c.series} color={sparkColor} />
      <div className="sc-base">{c.baseline != null ? `prev ${c.baseline}${c.unit === "%" ? "%" : ""} · last ${c.series.length}` : "building baseline"}</div>
    </Link>
  );
}

function MatchRow({ m }: { m: EnrichedMatch }) {
  const o = m.objective;
  const isAram = (o.queue ?? "").toUpperCase().includes("ARAM");
  const k = o.kills ?? 0, dth = o.deaths ?? 0, a = o.assists ?? 0;
  const ratio = ((k + a) / Math.max(1, dth)).toFixed(1);
  return (
    <Link to={`/match/${m.id}`} className="match">
      <span className={`wl ${o.win ? "win" : "loss"}`} />
      <span className="champ-sq" style={{ width: 30, height: 30 }}>{o.champion && <ChampImg champ={o.champion} />}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex" style={{ gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 550, fontSize: "0.9rem" }}>{o.champion ?? "Unknown"}</span>
          <span className="qbadge">{queueLabel(o)}</span>
          {!isAram && <span className="mlbl">{roleLabel(o)}</span>}
          <span className={`verdict ${m.verdict}`} style={{ fontSize: "0.76rem" }}>{VERDICT_LABEL[m.verdict]}</span>
        </div>
        <div className="flex wrap" style={{ gap: 5, marginTop: 4 }}>
          {m.tags.slice(0, 3).map((t, i) => <span className={`mtag ${t.tone}`} key={i} title={t.hint}>{t.label}</span>)}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 78 }}>
        <div className="mn kda-line" style={{ fontSize: "0.86rem" }}>
          <span className="k">{k}</span> / <span className="d">{dth}</span> / <span className="a">{a}</span>
        </div>
        <div className="kda-ratio">{ratio} KDA</div>
      </div>
      <div style={{ textAlign: "right", minWidth: 72 }} className="mlbl">
        {isAram
          ? o.teamDamageShare != null && <div className="mn" style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{Math.round(o.teamDamageShare * 100)}% dmg</div>
          : o.csAt10 != null && <div className="mn" style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{o.csAt10} cs@10</div>}
        {o.killParticipation != null && <div className="mn" style={{ fontSize: "0.72rem" }}>{Math.round(o.killParticipation * 100)}% KP</div>}
      </div>
      <div style={{ textAlign: "right", minWidth: 42 }}>
        <div className="mn" style={{ fontSize: "0.9rem", color: procColor(m.process.score) }}>{m.process.score}</div>
        {o.lpDelta != null && <div className="mn" style={{ fontSize: "0.72rem", color: o.lpDelta >= 0 ? "var(--green)" : "var(--red)" }}>{o.lpDelta >= 0 ? "+" : ""}{o.lpDelta}</div>}
      </div>
    </Link>
  );
}

interface DayGroup { date: string; label: string; wins: number; losses: number; matches: EnrichedMatch[]; }
function groupByDay(matches: EnrichedMatch[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const today = dayKey(new Date());
  const yest = dayKey(new Date(Date.now() - 86400000));
  for (const m of matches) {
    const key = dayKey(new Date(m.playedAt));
    let g = groups.find((x) => x.date === key);
    if (!g) {
      const label = key === today ? "Today" : key === yest ? "Yesterday" : new Date(m.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      g = { date: key, label, wins: 0, losses: 0, matches: [] };
      groups.push(g);
    }
    g.matches.push(m);
    if (m.objective.win) g.wins++;
    else if (m.objective.win === false) g.losses++;
  }
  return groups;
}
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function CoachHero({
  plan,
  err,
  replanning,
  onReplan,
  syncing,
  syncNote,
  onSync,
  mode,
  onToggleMode,
}: {
  plan: NextGamePlan | null;
  err: string | null;
  replanning: boolean;
  onReplan: () => void;
  syncing: boolean;
  syncNote: string | null;
  onSync: () => void;
  mode: "llm" | "engine";
  onToggleMode: (m: "llm" | "engine") => void;
}) {
  return (
    <div className="card coach-hero">
      <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="coach-kicker"><i className="ti ti-compass" aria-hidden="true" /> Coach · your next game</div>
        <div className="flex" style={{ gap: 8, alignItems: "center" }}>
          <div className="coach-modesw" title="Claude synthesis vs a deterministic rules engine ($0). Compare them side-by-side.">
            <button className={mode === "llm" ? "on" : ""} onClick={() => onToggleMode("llm")}>Claude</button>
            <button className={mode === "engine" ? "on" : ""} onClick={() => onToggleMode("engine")}>Engine</button>
          </div>
          {plan && (
            <span className={`pill ${plan.generatedBy === "llm" ? "accent" : ""}`}>
              {plan.generatedBy === "llm" ? "AI reasoning" : "rules"}
            </span>
          )}
          <button className="ghost sm" onClick={onReplan} disabled={replanning || !plan}>
            {replanning ? "Thinking…" : "New plan"}
          </button>
        </div>
      </div>

      {err ? (
        <div className="muted mt">Coach couldn't load: {err}</div>
      ) : !plan ? (
        <div className="coach-loading">
          <i className="ti ti-loader-2 spin" aria-hidden="true" />
          Reading your recent games…
        </div>
      ) : (
        <>
          <div className="coach-headline">{plan.headline}</div>

          <div className="coach-directives">
            {plan.directives.map((dir, i) => (
              <div key={i} className={`coach-directive ${dir.tone}`}>
                <div className="flex" style={{ justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <span className="cd-title">{dir.title}</span>
                  <span className="cd-target mn">{dir.target}</span>
                </div>
                <div className="cd-why">{dir.why}</div>
                <div className="cd-metric">{dir.metricLabel}</div>
              </div>
            ))}
          </div>

          <div className="coach-foot">
            {plan.championCall.champion && (
              <Link to={`/champions/${plan.championCall.champion}`} className="coach-champ">
                <span className="champ-sq" style={{ width: 36, height: 36 }}>
                  <ChampImg champ={plan.championCall.champion} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="cc-name">
                    {plan.championCall.champion} <span className="mlbl">{plan.championCall.role ?? ""}</span>
                  </div>
                  <div className="cc-line">{plan.championCall.line}</div>
                </div>
              </Link>
            )}
            <div className="coach-mental">
              <i className="ti ti-brain" aria-hidden="true" /> {plan.mentalNote}
            </div>
          </div>

          <div className="flex mt" style={{ justifyContent: "flex-end" }}>
            <span className="faint" style={{ fontSize: "0.74rem" }}>
              based on {plan.basedOnGames} games · {plan.generatedBy === "llm" ? "reasoned by Claude" : "rule-based fallback"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function cap(s: string) { return s ? s[0] + s.slice(1).toLowerCase() : s; }
function procColor(p: number) {
  if (p >= 65) return "var(--green)";
  if (p >= 45) return "var(--gold)";
  return "var(--red)";
}
function kdaColor(k: number) {
  if (k >= 4) return "#6f93a3"; // elite (op.gg blue)
  if (k >= 3) return "var(--green)";
  if (k >= 2) return "var(--gold)";
  return "var(--red)";
}
const RANK_COLORS: Record<string, string> = {
  IRON: "#8a7768", BRONZE: "#a9713f", SILVER: "#9aa0a6", GOLD: "#d6a24e",
  PLATINUM: "#4bb39b", EMERALD: "#4caf6d", DIAMOND: "#6f93a3", MASTER: "#9b8bd0",
  GRANDMASTER: "#cf7f6d", CHALLENGER: "#6fc3d6",
};
function rankColor(tier: string) {
  return RANK_COLORS[tier.toUpperCase()] ?? "var(--text)";
}
