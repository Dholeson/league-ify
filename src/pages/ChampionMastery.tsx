import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type {
  ChampionDetail,
  ChampionMeta,
  ChampionTrack,
  ChampionStat,
  Champion,
  Role,
  EnrichedMatch,
  StatComparison,
  RecommendedGoal,
  MatchupStat,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { Bar, useToast, useCountUp, VERDICT_LABEL, roleLabel } from "../ui.tsx";
import { champSquare, champName, champId, subscribeVersion } from "../ddragon.ts";

function RailImg({ champ, size = 34 }: { champ: string; size?: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <i className="ti ti-shield-half" style={{ color: "#4d453a", fontSize: size / 2 }} aria-hidden="true" />;
  // Square face-crop icon — the tall loading splash gets cropped to the torso in
  // these small square avatars.
  return <img key={champId(champ)} src={champSquare(champ)} alt={champName(champ)} onError={() => setOk(false)} />;
}

// Round performance dial for the champion banner.
function PerfDial({ value, size = 88 }: { value: number; size?: number }) {
  const shown = useCountUp(value);
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, shown)) / 100);
  const col = procColor(value);
  return (
    <div className="perf-dial">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a30" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="6"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fill={col} style={{ fontSize: size / 3.2, fontWeight: 700, fontFamily: "var(--mono)" }}>{shown}</text>
      </svg>
      <span className="pd-label">avg performance</span>
    </div>
  );
}

const ROLES: Role[] = ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"];
const CLASSES = ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"];

// Routes: /champions (grid) and /champions/:champion (rail + detail).
export default function ChampionMastery() {
  const { champion } = useParams();
  const [champs, setChamps] = useState<ChampionStat[]>([]);

  useEffect(() => {
    api.dashboard().then((d) => setChamps(d.champions)).catch(() => {});
  }, []);

  if (!champion) return <ChampionGrid champs={champs} />;

  return (
    <div className="champ-layout">
      <ChampionRail champs={champs} selected={champion} />
      <div className="champ-detail-col">
        <ChampionDetailView champion={champion} />
      </div>
    </div>
  );
}

function procColor2(p: number) {
  if (p >= 65) return "var(--green)";
  if (p >= 45) return "var(--gold)";
  return "var(--red)";
}

function ChampionRail({ champs, selected }: { champs: ChampionStat[]; selected: string }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"mastery" | "name">("mastery");

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...champs]
      .filter((c) => !s || c.champion.toLowerCase().includes(s))
      .sort((a, b) => (sort === "mastery" ? b.masteryLevel - a.masteryLevel || b.games - a.games : a.champion.localeCompare(b.champion)));
  }, [champs, q, sort]);

  return (
    <div className="champ-rail">
      <div className="cr-controls">
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="cr-sort">
          <button className={sort === "mastery" ? "on" : ""} onClick={() => setSort("mastery")} title="Sort by mastery"><i className="ti ti-award" aria-hidden="true" /></button>
          <button className={sort === "name" ? "on" : ""} onClick={() => setSort("name")} title="Sort A–Z"><i className="ti ti-sort-a-z" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="cr-list">
        {list.map((c) => (
          <a
            key={c.champion}
            className={`cr-item ${c.champion === selected ? "on" : ""}`}
            href={`/champions/${c.champion}`}
            onClick={(e) => { e.preventDefault(); nav(c.champion === selected ? "/champions" : `/champions/${c.champion}`); }}
            title={c.champion === selected ? "Click again to see all champions" : c.champion}
          >
            <span className="cr-img"><RailImg champ={c.champion} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cr-name">{c.champion}</div>
              <div className="cr-sub">
                <span style={{ color: c.winRate >= 50 ? "var(--green)" : "var(--red)" }}>{c.winRate}%</span>
                {" · "}{c.wins}W {c.games - c.wins}L
              </div>
            </div>
            <span className="cr-score mn" style={{ color: procColor2(c.avgProcess) }}>{c.avgProcess}</span>
          </a>
        ))}
        {list.length === 0 && <div className="muted" style={{ padding: 12, fontSize: "0.82rem" }}>No champions.</div>}
      </div>
    </div>
  );
}

type GridEntry = { id: string; name: string; tags: string[]; roles: Role[]; stat: ChampionStat | null };

// A continuous performance tint so a 90-green clearly out-glows a 68-green:
// gold at ~50, brightening to vivid green at 100 and deepening to red at 0, with
// alpha scaling toward the extremes so the card colour is obvious at a glance.
function perfGradient(score: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  let r: number, g: number, b: number;
  if (score >= 50) {
    const t = clamp((score - 50) / 50); // 50 gold → 100 vivid green
    r = Math.round(214 - t * 104);
    g = Math.round(162 + t * 44);
    b = Math.round(78 + t * 14);
  } else {
    const t = clamp((50 - score) / 50); // 50 gold → 0 deep red
    r = Math.round(214 - t * 10);
    g = Math.round(162 - t * 92);
    b = Math.round(78 - t * 16);
  }
  const a = (0.16 + (Math.abs(score - 50) / 50) * 0.3).toFixed(2); // 0.16 → 0.46
  return `linear-gradient(160deg, rgba(${r},${g},${b},${a}) 0%, var(--bg-card) 78%)`;
}

function ChampionGrid({ champs }: { champs: ChampionStat[] }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"mastery" | "name" | "games">("mastery");
  const [role, setRole] = useState<Role | null>(null);
  const [klass, setKlass] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "played" | "unplayed">("all");
  const [all, setAll] = useState<Champion[]>([]);

  useEffect(() => {
    api.champions().then((r) => setAll(r.champions)).catch(() => {});
  }, []);

  // Merge the full roster with your played stats (matched by champion id).
  const entries: GridEntry[] = useMemo(() => {
    const byId = new Map<string, ChampionStat>();
    for (const c of champs) byId.set(c.champion.toLowerCase(), c);
    if (all.length === 0) {
      // Roster not loaded yet — fall back to just your played champions.
      return champs.map((c) => ({ id: c.champion, name: c.champion, tags: [], roles: c.role ? [c.role] : [], stat: c }));
    }
    return all.map((c) => ({ id: c.id, name: c.name, tags: c.tags, roles: c.roles, stat: byId.get(c.id.toLowerCase()) ?? null }));
  }, [all, champs]);

  const playedCount = entries.filter((e) => e.stat).length;

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return entries
      .filter((e) => !s || e.name.toLowerCase().includes(s) || e.id.toLowerCase().includes(s))
      .filter((e) => (status === "played" ? !!e.stat : status === "unplayed" ? !e.stat : true))
      .filter((e) => !role || e.roles.includes(role) || e.stat?.role === role)
      .filter((e) => !tier || (e.stat ? e.stat.tier === tier : false))
      .filter((e) => !klass || e.tags.includes(klass))
      .sort((a, b) => {
        // Played always sort ahead of unplayed, then by the chosen key.
        if (!!a.stat !== !!b.stat) return a.stat ? -1 : 1;
        if (a.stat && b.stat) {
          if (sort === "name") return a.name.localeCompare(b.name);
          if (sort === "games") return b.stat.games - a.stat.games;
          return b.stat.masteryLevel - a.stat.masteryLevel || b.stat.games - a.stat.games;
        }
        return a.name.localeCompare(b.name);
      });
  }, [entries, q, role, tier, klass, sort, status]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Champions</h1>
          <div className="sub">Every champion in the game — {playedCount} played. Pick one to open its mastery, context, and goals.</div>
        </div>
      </div>

      <div className="card champ-filters">
        <input className="cf-search" placeholder="Search champion…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="cf-group">
          <span className="cf-label">Show</span>
          <button className={status === "all" ? "on" : ""} onClick={() => setStatus("all")}>All</button>
          <button className={status === "played" ? "on" : ""} onClick={() => setStatus("played")}>Played</button>
          <button className={status === "unplayed" ? "on" : ""} onClick={() => setStatus("unplayed")}>Unplayed</button>
        </div>
        <div className="cf-group">
          <span className="cf-label">Role</span>
          <button className={!role ? "on" : ""} onClick={() => setRole(null)}>All</button>
          {ROLES.map((r) => <button key={r} className={role === r ? "on" : ""} onClick={() => setRole(role === r ? null : r)}>{r[0] + r.slice(1).toLowerCase()}</button>)}
        </div>
        <div className="cf-group">
          <span className="cf-label">Class</span>
          <button className={!klass ? "on" : ""} onClick={() => setKlass(null)}>All</button>
          {CLASSES.map((k) => <button key={k} className={klass === k ? "on" : ""} onClick={() => setKlass(klass === k ? null : k)}>{k}</button>)}
        </div>
        <div className="cf-group">
          <span className="cf-label">Pool</span>
          {["main", "secondary", "lab"].map((t) => <button key={t} className={tier === t ? "on" : ""} onClick={() => setTier(tier === t ? null : t)}>{t === "secondary" ? "backup" : t}</button>)}
          <span className="cf-label" style={{ marginLeft: 10 }}>Sort</span>
          {(["mastery", "games", "name"] as const).map((s) => <button key={s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>{s}</button>)}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card muted">No champions match these filters.</div>
      ) : (
        <div className="champ-cardgrid">
          {list.map((e) => (
            <button
              key={e.id}
              className={`champ-gcard ${e.stat ? "" : "unplayed"}`}
              style={e.stat ? { background: perfGradient(e.stat.avgProcess) } : undefined}
              onClick={() => nav(`/champions/${e.id}`)}
            >
              <span className="gc-img"><RailImg champ={e.id} size={52} /></span>
              <div className="gc-name">{e.name}</div>
              {e.stat ? (
                <>
                  <div className="gc-meta">
                    <span className={`tierbadge ${e.stat.personalTier}`} style={{ width: 20, height: 20, fontSize: "0.7rem" }}>{e.stat.personalTier}</span>
                    <span className="mlbl">M{e.stat.masteryLevel}</span>
                  </div>
                  <div className="gc-stats mlbl">{e.stat.games}g · {e.stat.winRate}% · <span style={{ color: procColor2(e.stat.avgProcess) }}>{e.stat.avgProcess}</span></div>
                </>
              ) : (
                <div className="gc-stats mlbl gc-unplayed">not played yet</div>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ChampionDetailView({ champion }: { champion: string }) {
  const [detail, setDetail] = useState<ChampionDetail | null>(null);
  const [meta, setMeta] = useState<ChampionMeta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const [params] = useSearchParams();
  const focus = params.get("focus");
  const toast = useToast();

  // Re-render when the DDragon name map loads so icons/names resolve (Wukong,
  // Kog'Maw, Twisted Fate…).
  useEffect(() => subscribeVersion(() => forceTick((t) => t + 1)), []);
  // Reset the role slice when you switch champions.
  useEffect(() => setRole(null), [champion]);

  // Arrived from a goal-complete notification: jump to + flash the goals section.
  useEffect(() => {
    if (!detail || focus !== "goals") return;
    const el = document.getElementById("champ-goals");
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 2200);
    }, 300);
    return () => clearTimeout(t);
  }, [detail, focus]);

  useEffect(() => {
    if (!champion) return;
    setErr(null);
    setDetail(null);
    setMeta(null);
    setMetaErr(null);
    api
      .championDetail(champion, role)
      .then((d) => {
        setDetail(d);
        // Champion context is generated/cached server-side; fetch it separately
        // so the page paints immediately and the panel fills in.
        api
          .championMeta(champion, d.role)
          .then(setMeta)
          .catch((e) => setMetaErr(String(e.message)));
      })
      .catch((e) => {
        // Unplayed champion (404): still surface its scouting context so the
        // page is useful for deciding whether to pick it up.
        setErr(String(e.message));
        api.championMeta(champion).then(setMeta).catch((ee) => setMetaErr(String(ee.message)));
      });
  }, [champion, role]);

  async function addGoal(goal: RecommendedGoal) {
    setAdding(goal.templateId + (goal.champion ?? ""));
    try {
      const r = await api.addGoal({
        templateId: goal.templateId,
        champion: goal.champion ?? null,
        target: goal.target,
      });
      toast.ok(r.createdBlock ? `Started a new block "${r.createdBlock.name}" with this goal.` : `Added "${goal.title}" to your active block.`);
    } catch (e) {
      toast.err(String((e as Error).message));
    } finally {
      setAdding(null);
    }
  }

  // Unplayed champion: no match history, but we still show its scouting report.
  if (err && !detail) {
    return (
      <>
        <div className="champ-hero" style={{ ["--splash" as any]: `url(https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champId(champion)}_0.jpg)` }}>
          <div className="ch-inner">
            <div className="ch-headline">
              <h1>{champName(champion)}</h1>
              <div className="ch-sub">
                <span className="pill red">not in your history</span>
                <span className="ch-rec">0 games logged</span>
              </div>
              <div className="ch-tags">
                <span className="playtag neutral"><i className="ti ti-sparkles" aria-hidden="true" /> Scouting report</span>
              </div>
            </div>
            <Link to="/champions" className="ch-all"><i className="ti ti-layout-grid" aria-hidden="true" /> All champions</Link>
          </div>
        </div>
        <div className="card muted" style={{ marginTop: 16 }}>
          You haven't played <b>{champion}</b> yet — here's the current-patch scouting so you know what you'd be picking up.
          Play a game on {champion} and your mastery track, trends, and goals will fill in here.
        </div>
        <div className="mt-lg">
          <ChampionContext champion={champion} meta={meta} err={metaErr} />
        </div>
      </>
    );
  }
  if (!detail) return <div className="empty">Loading…</div>;

  const earlyLeak =
    detail.avgFirstDeathSec != null && detail.avgFirstDeathSec < 360;
  const laneLeak = detail.avgGoldDiff15 != null && detail.avgGoldDiff15 < 0;

  return (
    <>
      {toast.node}

      {/* ---- champion hero (splash one-sheet) ---- */}
      <div className="champ-hero" style={{ ["--splash" as any]: `url(https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champId(detail.champion)}_0.jpg)` }}>
        <div className="ch-inner">
          <div className="ch-headline">
            <div className="ch-titlerow">
              <h1>{champName(detail.champion)}</h1>
              <span className="ch-role">{detail.role}</span>
              {detail.tier ? <span className={`pill ${poolClass(detail.tier)}`} title="Your pool tier for this champion.">{detail.tier}</span> : <span className="pill red" title="Not in your champion pool.">off-pool</span>}
            </div>
            <div className="ch-sub">
              <span className="ch-m" title="Your champion-track level — earned by playing this champion.">{detail.track.rank} · level {detail.track.level}</span>
              <span className="ch-dot">·</span>
              <span className="ch-rec">{detail.wins}W {detail.games - detail.wins}L · {detail.winRate}% WR over {detail.games} games</span>
            </div>
            {detail.availableRoles.length > 1 && (
              <div className="ch-roles" title="This champion is played in more than one role — slice the stats by role.">
                <button className={!role ? "on" : ""} onClick={() => setRole(null)}>All roles</button>
                {detail.availableRoles.map((r) => (
                  <button key={r} className={role === r ? "on" : ""} onClick={() => setRole(r)}>{r}</button>
                ))}
              </div>
            )}
            <div className="ch-tags">
              {detail.playstyle.map((t, i) => (
                <span key={i} className={`playtag ${t.tone}`} title={t.hint}>
                  <i className={`ti ti-${t.tone === "bad" ? "alert-triangle" : t.tone === "neutral" ? "minus" : "bolt"}`} aria-hidden="true" /> {t.label}
                </span>
              ))}
            </div>
          </div>
          <div className="ch-right">
            <PerfDial value={detail.avgProcess} />
            <Link to="/champions" className="ch-all"><i className="ti ti-layout-grid" aria-hidden="true" /> All champions</Link>
          </div>
        </div>
      </div>

      {/* ---- doing well / needs work vs rank average · game phases ---- */}
      <div className="grid cols-3 mt-lg scouting-row" data-nav="Scout">
        {(() => {
          const good = detail.comparison.filter((c) => c.better);
          const bad = detail.comparison.filter((c) => !c.better);
          return (
            <>
              <div className="card scout-col good">
                <h3><i className="ti ti-thumb-up" aria-hidden="true" /> Doing well <span className="scout-vs">vs {detail.comparisonRank}</span></h3>
                {good.length ? good.map((c) => <CompRow key={c.key} c={c} />) : <p className="muted" style={{ fontSize: "0.85rem" }}>Nothing above the {detail.comparisonRank} average yet — the columns fill as you play.</p>}
              </div>
              <div className="card scout-col bad">
                <h3><i className="ti ti-tool" aria-hidden="true" /> Needs work <span className="scout-vs">vs {detail.comparisonRank}</span></h3>
                {bad.length ? bad.map((c) => <CompRow key={c.key} c={c} />) : <p className="muted" style={{ fontSize: "0.85rem" }}>At or above the {detail.comparisonRank} average across the board.</p>}
              </div>
              <div className="card scout-col phases">
                <h3><i className="ti ti-clock-hour-4" aria-hidden="true" /> Your game by phase</h3>
                {detail.phases.map((p) => (
                  <div className="phase-row" key={p.phase} title={p.hint}>
                    <div className="flex" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                      <span className="phase-label">{p.label}</span>
                      <span className="mlbl mn">{p.value}</span>
                    </div>
                    <div className="bar"><div style={{ width: `${p.score}%`, background: procColor(p.score) }} /></div>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      <div data-nav="Context" className="mt-lg">
        <ChampionContext champion={detail.champion} meta={meta} err={metaErr} />
      </div>

      <div className="section-title" data-nav="Mastery track">
        <h2>Mastery track</h2>
        <span className="tag">level {detail.champion} by clearing tiers — this is your progression now</span>
      </div>
      <MasteryTrack track={detail.track} />

      {/* trend + suggested goals, side by side */}
      <div className="grid cols-2 mt-lg">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{champName(detail.champion)} trend</h2>
          <p className="muted" style={{ fontSize: "0.83rem" }}>Performance and early lane economy, game by game.</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={detail.trend} margin={{ top: 8, right: 14, left: 0, bottom: 18 }}>
              <CartesianGrid stroke="#2b2b31" strokeDasharray="3 3" />
              <XAxis dataKey="index" stroke="#6d6c66" fontSize={11} label={{ value: "game #", position: "insideBottom", offset: -8, fill: "#6d6c66", fontSize: 10 }} />
              <YAxis yAxisId="proc" stroke="#c98a5e" fontSize={11} width={34} domain={[0, 100]} />
              <YAxis yAxisId="lane" orientation="right" stroke="#6f93a3" fontSize={11} width={34} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(i) => `game ${i}`} />
              <Line yAxisId="proc" type="monotone" dataKey="process" stroke="#c98a5e" strokeWidth={2.4} dot={false} name="Performance" />
              <Line yAxisId="lane" type="monotone" dataKey="cs10" stroke="#6f93a3" strokeWidth={2} dot={false} name="CS @ 10" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card" id="champ-goals">
          <div className="flex" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>Suggested goals</h2>
            <span className="tag">drop into a block</span>
          </div>
          {detail.suggestedGoals.length === 0 ? (
            <p className="muted center" style={{ padding: 16 }}>Keep stacking reps — no sharp leaks right now.</p>
          ) : (
            detail.suggestedGoals.slice(0, 4).map((goal, gi) => (
              <div className="row" key={goal.templateId + (goal.champion ?? "") + gi}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{goal.title}</div>
                  <div className="desc">{goal.rationale}</div>
                  <div className="mt" style={{ maxWidth: 220 }}>
                    <Bar value={Math.max(0, 100 - goal.severity * 100)} max={100} variant="gold" />
                  </div>
                </div>
                <div className="stat" style={{ alignItems: "flex-end", gap: 4 }}>
                  <span className="hint">now {goal.current ?? "—"} · aim {goal.direction === "lower" ? "≤" : "≥"} {goal.target}</span>
                  <button className="sm" onClick={() => addGoal(goal)} disabled={adding === goal.templateId + (goal.champion ?? "")}>
                    {adding === goal.templateId + (goal.champion ?? "") ? "Adding…" : "Add to block"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* recent games + matchups, side by side */}
      <div className="grid cols-2 mt-lg">
        <div>
          <div className="section-title" data-nav="Recent games">
            <h2>Recent games</h2>
            <span className="tag">click any to break it down</span>
          </div>
          <div className="card" style={{ padding: "6px 12px" }}>
            {detail.recentMatches.length > 0
              ? detail.recentMatches.map((m) => <ChampMatchRow key={m.id} m={m} />)
              : <p className="muted center" style={{ padding: 16 }}>No games logged yet.</p>}
          </div>
        </div>

        <div>
          <div className="section-title" data-nav="Matchups">
            <h2>Matchups</h2>
            <span className="tag">your performance vs the lane opponent</span>
          </div>
          <div className="card">
            {detail.matchups.length === 0 ? (
              <p className="muted center" style={{ padding: 16 }}>
                Matchups come from your <b>lane opponent on Summoner's Rift</b> — ARAM and Arena have no lane.
                Fills in as you play ranked/normal SR games on {champName(detail.champion)}.
              </p>
            ) : (
              <MatchupSplit matchups={detail.matchups} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Best / toughest matchups by your average performance vs that opponent.
function MatchupChip({ m }: { m: MatchupStat }) {
  return (
    <Link to={`/champions/${champId(m.opponent)}`} className="mu-chip" title={`${m.games} game${m.games === 1 ? "" : "s"} · ${m.winRate}% WR`}>
      <img className="mu-img" src={champSquare(m.opponent)} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
      <span className="mu-name">{champName(m.opponent)}</span>
      <span className="mu-perf" style={{ color: procColor(m.avgProcess) }}>{m.avgProcess}</span>
    </Link>
  );
}
function MatchupSplit({ matchups }: { matchups: MatchupStat[] }) {
  const byPerf = [...matchups].sort((a, b) => b.avgProcess - a.avgProcess);
  const n = byPerf.length;
  // With a full board, show the top 5 / bottom 5. With fewer, split down the
  // middle so both columns always have something — odd counts favor "best".
  const bestCount = n > 10 ? 5 : Math.ceil(n / 2);
  const best = byPerf.slice(0, bestCount);
  const worst = (n > 10 ? byPerf.slice(-5) : byPerf.slice(bestCount)).reverse(); // toughest first
  return (
    <div className="mu-split">
      <div>
        <div className="mu-h good"><i className="ti ti-arrow-up-right" aria-hidden="true" /> Best (by perf)</div>
        {best.map((m) => <MatchupChip key={m.opponent} m={m} />)}
      </div>
      <div>
        <div className="mu-h bad"><i className="ti ti-arrow-down-right" aria-hidden="true" /> Toughest</div>
        {worst.length > 0
          ? worst.map((m) => <MatchupChip key={m.opponent} m={m} />)
          : <p className="mlbl" style={{ padding: "4px 6px" }}>More games needed to split these out.</p>}
      </div>
    </div>
  );
}

function MasteryTrack({ track }: { track: ChampionTrack }) {
  return (
    <div className="card mastery-card">
      <div className="mastery-head">
        <div className="mastery-badge">
          <div className="mb-lvl">{track.level}</div>
          <div className="mb-of">/ {track.maxLevel}</div>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div className="flex" style={{ gap: 8, alignItems: "baseline" }}>
            <span className="mastery-rank">{track.rank}</span>
            <span className="mlbl">{track.role.toLowerCase()} · {track.games} games</span>
          </div>
          <div className="bar gold" style={{ marginTop: 8 }}><div style={{ width: `${track.pct}%` }} /></div>
          {track.nextUp && (
            <div className="mlbl" style={{ marginTop: 6 }}>
              next: {track.nextUp.label} → {track.nextUp.nextTarget} {track.nextUp.unit} ({track.nextUp.pct}%)
            </div>
          )}
        </div>
      </div>
      <div className="mastery-grid">
        {track.milestones.map((m) => (
          <div className={`milestone ${m.tone}`} key={m.id}>
            <div className="flex" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className="ms-label">{m.label}</span>
              <span className="ms-pips">
                {m.tiers.map((t, i) => (
                  <span key={i} className={`pip ${i < m.tierIndex ? "on" : ""}`} title={`Tier ${i + 1}: ${t} ${m.unit}`} />
                ))}
              </span>
            </div>
            <div className="ms-bar"><Bar value={m.pct} max={100} variant={m.tierIndex >= 3 ? "green" : "gold"} /></div>
            <div className="ms-detail">
              {m.detail}
              {m.nextTarget != null ? <span className="ms-next"> · next {m.nextTarget} {m.unit}</span> : <span className="ms-next done"> · maxed</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChampionContext({
  champion,
  meta,
  err,
}: {
  champion: string;
  meta: ChampionMeta | null;
  err: string | null;
}) {
  if (err) return null;
  if (!meta) {
    return (
      <div className="card champ-context loading">
        <i className="ti ti-loader-2 spin" aria-hidden="true" /> Scouting {champion} on the current patch…
      </div>
    );
  }
  return (
    <div className="card champ-context">
      <div className="ctx-head">
        <span
          className={`ctx-tier t${meta.tier.replace(/[^A-Za-z]/g, "").toUpperCase() || "NA"}`}
          title={`Meta tier for ${meta.role} this patch (S = strongest, D = weakest). ${meta.generatedBy === "llm" ? "Claude's read on the current patch — not a live meta source." : "From champion data."}`}
        >{meta.tier}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ctx-title">
            {champName(champion)} <span className="mlbl">{meta.role}</span>
            <span className="ctx-diff" title="How mechanically demanding this champion is to play well.">{meta.difficulty} difficulty</span>
          </div>
          <div className="ctx-summary">{meta.summary}</div>
        </div>
      </div>
      <div className="ctx-grid">
        <CtxList title="Strengths" tone="good" items={meta.strengths} />
        <CtxList title="Weaknesses" tone="bad" items={meta.weaknesses} />
        <CtxList title="Power spikes" tone="neutral" items={meta.powerSpikes} />
        <CtxChips title="Wins into" tone="good" items={meta.goodInto} />
        <CtxChips title="Struggles into" tone="bad" items={meta.strugglesInto} />
        <CtxChips title="Synergies" tone="accent" items={meta.synergies} />
      </div>
      {(() => {
        const hasTips = (meta.combos?.length ?? 0) > 0 || !!meta.positioning || (meta.playRatings?.length ?? 0) > 0;
        if (!hasTips && meta.winConditions.length === 0) return null;
        return (
          <div className="ctx-playrow">
            {hasTips && (
              <div className="ctx-tips">
                <span className="mlbl">How to play</span>
                {(meta.combos?.length ?? 0) > 0 && (
                  <div className="tips-combos">
                    {meta.combos!.map((c, i) => <div className="tip-combo" key={i}><i className="ti ti-bolt" aria-hidden="true" /> {c}</div>)}
                  </div>
                )}
                {meta.positioning && <div className="tips-pos"><i className="ti ti-crosshair" aria-hidden="true" /> {meta.positioning}</div>}
                {(meta.playRatings?.length ?? 0) > 0 && (
                  <div className="tips-ratings">
                    {meta.playRatings!.map((r, i) => (
                      <div className="tip-rating" key={i}>
                        <span className="tr-aspect">{r.aspect}</span>
                        <span className="tr-dots">
                          {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`tr-dot ${n <= r.rating ? "on" : ""}`} />)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {meta.winConditions.length > 0 && (
              <div className="ctx-wincon">
                <span className="mlbl">Win conditions</span>
                <ol>{meta.winConditions.map((w, i) => <li key={i}>{w}</li>)}</ol>
              </div>
            )}
          </div>
        );
      })()}
      <div className="faint" style={{ fontSize: "0.72rem", marginTop: 10 }}>
        patch {meta.patch} · {meta.generatedBy === "llm" ? "scouted by Claude" : "from champion data"}
      </div>
    </div>
  );
}

function CtxList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="ctx-col">
      <div className={`ctx-col-h ${tone}`}>{title}</div>
      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function ChipImg({ champ }: { champ: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img key={champId(champ)} className="chip-img" src={champSquare(champ)} alt="" onError={() => setOk(false)} />;
}

function CtxChips({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="ctx-col">
      <div className={`ctx-col-h ${tone}`}>{title}</div>
      <div className="flex wrap" style={{ gap: 6 }}>
        {items.map((x, i) => (
          <Link key={i} to={`/champions/${champId(x)}`} className={`ctx-chip img ${tone}`}>
            <ChipImg champ={x} />
            {champName(x)}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ChampMatchRow({ m }: { m: EnrichedMatch }) {
  const o = m.objective;
  const isAram = (o.queue ?? "").toUpperCase().includes("ARAM");
  const k = o.kills ?? 0, d = o.deaths ?? 0, a = o.assists ?? 0;
  const ratio = ((k + a) / Math.max(1, d)).toFixed(1);
  return (
    <Link to={`/match/${m.id}`} className="match">
      <span className={`wl ${o.win ? "win" : "loss"}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex" style={{ gap: 8 }}>
          <span style={{ fontWeight: 550, fontSize: "0.86rem" }}>{roleLabel(o)}</span>
          <span className="mlbl">{new Date(m.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <span className={`verdict ${m.verdict}`} style={{ fontSize: "0.76rem" }}>{VERDICT_LABEL[m.verdict]}</span>
        </div>
        <div className="flex wrap" style={{ gap: 5, marginTop: 4 }}>
          {m.tags.slice(0, 3).map((t, i) => <span className={`mtag ${t.tone}`} key={i} title={t.hint}>{t.label}</span>)}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 78 }}>
        <div className="mn kda-line" style={{ fontSize: "0.86rem" }}><span className="k">{k}</span> / <span className="d">{d}</span> / <span className="a">{a}</span></div>
        <div className="kda-ratio">{ratio} KDA</div>
      </div>
      <div style={{ textAlign: "right", minWidth: 60 }} className="mlbl">
        {isAram
          ? o.teamDamageShare != null && <div className="mn" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{Math.round(o.teamDamageShare * 100)}% dmg</div>
          : o.csAt10 != null && <div className="mn" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{o.csAt10} cs@10</div>}
        {o.killParticipation != null && <div className="mn" style={{ fontSize: "0.72rem" }}>{Math.round(o.killParticipation * 100)}% KP</div>}
      </div>
      <div style={{ textAlign: "right", minWidth: 42 }}>
        <div className="mn" style={{ fontSize: "0.9rem", color: procColor(m.process.score) }} title="Performance score (0–100): how well you played, win or lose.">{m.process.score}</div>
        {o.lpDelta != null && <div className="mn" style={{ fontSize: "0.72rem", color: o.lpDelta >= 0 ? "var(--green)" : "var(--red)" }}>{o.lpDelta >= 0 ? "+" : ""}{o.lpDelta}</div>}
      </div>
    </Link>
  );
}

function CompRow({ c }: { c: StatComparison }) {
  const fmt = (v: number) =>
    c.key === "gold15" ? `${v >= 0 ? "+" : ""}${Math.round(v)}`
    : c.unit === "%" ? `${Math.round(v)}%`
    : `${v}`;
  return (
    <div className="comp-row">
      <div className="comp-head">
        <span className="comp-label">{c.label}</span>
        <span className="comp-val mn">
          {c.value != null ? fmt(c.value) : "—"} <span className="comp-bench">vs {fmt(c.benchmark)}</span>
        </span>
      </div>
      <div className="comp-bar" title={`You: ${c.value != null ? fmt(c.value) : "—"} · average: ${fmt(c.benchmark)}`}>
        <div className={`comp-fill ${c.better ? "good" : "bad"}`} style={{ width: `${c.pct}%` }} />
        <span className="comp-mid" />
      </div>
    </div>
  );
}

function signed(n: number) {
  return `${n >= 0 ? "+" : ""}${n}`;
}

function fmtSeconds(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function procColor(p: number) {
  if (p >= 65) return "var(--green)";
  if (p >= 45) return "var(--gold)";
  return "var(--red)";
}

function earlyColor(v: number | null) {
  if (v == null) return "var(--faint)";
  if (v <= 2) return "var(--green)";
  if (v <= 3) return "var(--gold)";
  return "var(--red)";
}

function poolClass(tier: string) {
  return tier === "main" ? "green" : tier === "secondary" ? "accent" : "violet";
}

const tooltipStyle = {
  background: "#202024",
  border: "1px solid #3a3a42",
  borderRadius: 8,
  fontFamily: "var(--mono)",
};
