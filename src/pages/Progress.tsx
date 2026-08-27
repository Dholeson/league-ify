import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import type { ProgressResponse, DayActivity, ChampionStat, TrendMatch } from "../../shared/types.ts";
import { api } from "../api.ts";
import { Bar as ProgressBar, queueLabel, VERDICT_LABEL } from "../ui.tsx";
import { champSquare, subscribeVersion } from "../ddragon.ts";
import StatsBoard from "../components/StatsBoard.tsx";

function ChampSq({ champ }: { champ: string }) {
  const [ok, setOk] = useState(true);
  const [, force] = useState(0);
  useEffect(() => subscribeVersion(() => force((n) => n + 1)), []);
  useEffect(() => setOk(true), [champ]);
  if (!ok) return <i className="ti ti-shield-half" style={{ color: "#4d453a", fontSize: 16 }} aria-hidden="true" />;
  return <img src={champSquare(champ)} alt={champ} onError={() => setOk(false)} />;
}

export default function Progress() {
  const [p, setP] = useState<ProgressResponse | null>(null);
  const [champs, setChamps] = useState<ChampionStat[]>([]);
  const [metric, setMetric] = useState("process");
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      api.progress().then(setP).catch((e) => setErr(String(e.message)));
      api.dashboard().then((d) => setChamps(d.champions)).catch(() => {});
    };
    load();
    window.addEventListener("data:refresh", load); // season/all-time toggle
    return () => window.removeEventListener("data:refresh", load);
  }, []);

  if (err) return <div className="empty">Couldn't load: {err}</div>;
  if (!p) return <div className="empty">Loading…</div>;

  if (!p.hasData) {
    return (
      <div className="empty">
        <div className="big">📈</div>
        <h2>No progress to chart yet</h2>
        <p>Sync a few games and this becomes your career timeline — trends across blocks, streaks, and where your skill is actually heading.</p>
        <Link to="/">
          <button className="mt">Sync from the overview →</button>
        </Link>
      </div>
    );
  }

  const meta = p.metrics.find((m) => m.key === metric)!;
  const selGame = selIdx != null ? p.matches.find((m) => m.index === selIdx) ?? null : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Report / Statistics</h1>
          <div className="sub">
            {p.totalGames} games across {p.blocks.length} block{p.blocks.length === 1 ? "" : "s"} — this is where the graphs, trends, and proof live.
          </div>
        </div>
      </div>

      {(() => {
        const hasTrajectory = p.pastComparison.some(
          (r) => r.improved != null && r.now != null && r.then != null && r.delta != null && r.then !== 0
        );
        if (!hasTrajectory && p.insights.length === 0) return null;
        return (
          <>
            <div className="section-title" data-nav="Insights"><h2>Insights</h2><span className="tag">what's shifted lately · how you actually win</span></div>
            <div className="card insights-panel">
              <RecentAnalysis p={p} />
              {p.insights.length > 0 && (
                <div className="report-insights">
                  {p.insights.map((ins) => {
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
              )}
            </div>
          </>
        );
      })()}

      {/* Deep dive up top: past-you table · consistency heatmap · personal bests */}
      <div className="section-title" data-nav="Deep dive">
        <h2>Deep dive</h2>
        <span className="tag">your trajectory, consistency, and records at a glance</span>
      </div>
      <div className="report-trio">
        <div className="card rt-col">
          <h3 className="rt-h">Versus Past You</h3>
          <p className="mlbl">last {p.pastComparisonWindow} games vs. the {p.pastComparisonWindow} before</p>
          {p.pastComparison.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.82rem", padding: "10px 0" }}>
              Log a few more games and this starts comparing you against your earlier self.
            </p>
          ) : (
            <table className="rt-table">
              <thead>
                <tr><th>Metric</th><th className="num">Then</th><th className="num">Now</th><th className="num">Δ</th></tr>
              </thead>
              <tbody>
                {p.pastComparison.map((row) => (
                  <tr key={row.key}>
                    <td style={{ fontWeight: 600 }}>{row.label}</td>
                    <td className="num">{fmtMetric(row.then, row.unit)}</td>
                    <td className="num">{fmtMetric(row.now, row.unit)}</td>
                    <td className="num" style={{ color: row.improved == null ? "var(--faint)" : row.improved ? "var(--green)" : "var(--red)" }}>
                      {fmtDelta(row.delta, row.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card rt-col">
          <h3 className="rt-h">Consistency</h3>
          <p className="mlbl">colored by how you played</p>
          {(() => {
            const active = p.calendar.filter((d) => d.games > 0);
            const best = active.length ? active.reduce((a, b) => (b.avgProcess > a.avgProcess ? b : a)) : null;
            const worst = active.length ? active.reduce((a, b) => (b.avgProcess < a.avgProcess ? b : a)) : null;
            const avg = active.length ? Math.round(active.reduce((s, d) => s + d.avgProcess, 0) / active.length) : null;
            const fmtDay = (s: string) => new Date(s + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
            return (
              <div className="consistency-body">
                <Calendar days={p.calendar} weeks={7} />
                {active.length > 0 && (
                  <div className="consistency-stats">
                    <div className="cs-title" title="Each number is a day's average performance score (0–100).">Avg performance / day</div>
                    <div className="cs-stat"><span className="cs-k">Best day</span><span className="cs-v" style={{ color: "var(--green)" }}>{best!.avgProcess}</span><span className="cs-d">{fmtDay(best!.date)}</span></div>
                    <div className="cs-stat"><span className="cs-k">Worst day</span><span className="cs-v" style={{ color: "var(--red)" }}>{worst!.avgProcess}</span><span className="cs-d">{fmtDay(worst!.date)}</span></div>
                    <div className="cs-stat"><span className="cs-k">Typical</span><span className="cs-v">{avg}</span><span className="cs-d">{active.length} days</span></div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div className="card rt-col">
          <h3 className="rt-h">Personal Bests</h3>
          <p className="mlbl">click one to open the game</p>
          {p.personalBests.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.82rem", padding: "10px 0" }}>Play a few games and your records show up here.</p>
          ) : (
            <div className="pb-grid">
              {p.personalBests.map((b) => (
                <Link className="pb-card" to={`/match/${b.matchId}`} key={b.label} title={`Open the game — ${b.when}`}>
                  <span className="pb-label">{b.label}</span>
                  <span className="pb-value">{b.value}</span>
                  <span className="pb-when">{b.when} <i className="ti ti-arrow-right" aria-hidden="true" /></span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Career metric trend with block bands */}
      <div className="section-title">
        <h2>Career Trend</h2>
        <span className="tag">every game, every block — pick a metric, click a point</span>
      </div>
      <div className="card trend-layout">
        <div className="trend-main">
          <div className="flex wrap" style={{ gap: 6, marginBottom: 12 }}>
            {p.metrics.map((m) => (
              <button
                key={m.key}
                className={`chip-toggle ${metric === m.key ? "on" : ""}`}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <MetricTrend p={p} metric={metric} label={meta.label} unit={meta.unit} selected={selIdx} onSelect={setSelIdx} />
          <p className="faint center" style={{ fontSize: "0.78rem", marginTop: 8 }}>
            Faint dots are individual games; the bold line is the 5-game moving average. Shaded bands are blocks.
          </p>
        </div>
        <div className="trend-side">
          {selGame ? (
            <TrendGameDetail m={selGame} onClose={() => setSelIdx(null)} />
          ) : (
            <>
              <div className="ts-head"><h3 className="rt-h">Recent games</h3><span className="mlbl">{p.matches.length} total</span></div>
              <div className="ts-list">
                {p.matches.slice(0, 40).map((m) => (
                  <button key={m.index} className="ts-row" onClick={() => setSelIdx(m.index)}>
                    <span className={`wl ${m.win ? "win" : m.win === false ? "loss" : ""}`} />
                    {m.champion && <span className="ts-champ"><ChampSq champ={m.champion} /></span>}
                    <div className="ts-mid">
                      <div className="ts-champname">{m.champion ?? "—"} <span className="qbadge">{queueLabel(m)}</span></div>
                      <div className="mlbl">{m.kills}/{m.deaths}/{m.assists} · {new Date(m.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                    </div>
                    <span className="mn ts-score" style={{ color: procColor(m.process) }}>{m.process}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Skill scores (left) + Rank/LP journey (right), side by side */}
      <div className="skill-lp-row mt-lg">
        <div>
          <div className="section-title">
            <h2>Skill scores</h2>
            <span className="tag">vs. rank — pick a domain, then a stat</span>
          </div>
          <StatsBoard />
        </div>
        <div>
          <div className="section-title"><h2>Rank / LP Journey</h2></div>
          <div className="card">
            <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>
              {p.lpTimeline.length > 0
                ? "Estimated LP climb across your ranked games — Riot doesn't expose per-game LP, so this is inferred from your wins and losses."
                : "No ranked games yet — play ranked and your LP trajectory appears here."}
            </p>
            {p.lpTimeline.length > 0 && (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={p.lpTimeline} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#2b2b31" strokeDasharray="3 3" />
                  <XAxis dataKey="index" stroke="#6d6c66" fontSize={12} label={{ value: "ranked game #", position: "insideBottom", offset: -4, fill: "#6d6c66", fontSize: 10 }} />
                  <YAxis stroke="#6f93a3" fontSize={12} width={44} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(i) => `Ranked game ${i}`} />
                  <Line type="monotone" dataKey="cumulativeLp" stroke="#6f93a3" strokeWidth={2.5} dot={false} name="Est. LP" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Champion mastery (left) + Player Shape (right) */}
      <div className="grid cols-2 mt-lg">
        <div className="card" data-nav="Champion mastery">
          <h2>Champion mastery</h2>
          <p className="muted" style={{ fontSize: "0.83rem" }}>You level the champions you play — clear tiers to rank them up.</p>
          {champs.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.82rem", padding: "10px 0" }}>Play some games and your champions show up here.</p>
          ) : (
            <div className="cm-list">
              {[...champs]
                .sort((a, b) => b.masteryLevel - a.masteryLevel || b.games - a.games)
                .slice(0, 6)
                .map((c) => (
                  <Link to={`/champions/${c.champion}`} className="cm-row" key={c.champion}>
                    <span className="champ-sq cm-img"><ChampSq champ={c.champion} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cm-name">{c.champion}</div>
                      <div className="mlbl">{c.masteryRank} · {c.games} games · {c.winRate}% WR</div>
                    </div>
                    <span className="mn cm-lvl">M{c.masteryLevel}</span>
                  </Link>
                ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Player Shape</h2>
          <p className="muted" style={{ fontSize: "0.83rem" }}>
            Your performance profile — this block vs. career. Where are you lopsided?
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={p.radar} outerRadius={80}>
              <PolarGrid stroke="#2b2b31" />
              <PolarAngleAxis dataKey="label" tick={{ fill: "#a4a29b", fontSize: 12 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="Career" dataKey="career" stroke="#6d6c66" fill="#6d6c66" fillOpacity={0.25} />
              <Radar name="This block" dataKey="current" stroke="#c98a5e" fill="#c98a5e" fillOpacity={0.35} />
              <Tooltip contentStyle={tooltipStyle} />
            </RadarChart>
          </ResponsiveContainer>
          <div className="chart-legend">
            <span className="cl-item"><span className="cl-swatch" style={{ background: "#c98a5e" }} /> This block</span>
            <span className="cl-item"><span className="cl-swatch" style={{ background: "#6d6c66" }} /> Career</span>
          </div>
        </div>
      </div>

      {(() => {
        const done = p.blocks.filter((b) => b.status === "complete");
        if (done.length === 0) return null;
        return (
          <>
            <div className="section-title"><h2>Recently completed blocks</h2><span className="tag">campaigns you've closed out</span></div>
            <div className="grid cols-3">
              {done.slice(0, 6).map((b) => (
                <Link to="/seasons" className="card cb-card" key={b.id}>
                  <div className="cb-name">{b.name}</div>
                  <div className="mlbl">{b.identityName}</div>
                  <div className="cb-foot">
                    <span className="mlbl">{b.games} games · {b.winRate}% WR</span>
                    <span className="mn" style={{ color: procColor(b.avgProcess), fontSize: "1.05rem", fontWeight: 700 }}>{b.avgProcess}</span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        );
      })()}
    </>
  );
}

function MetricTrend({
  p,
  metric,
  label,
  unit,
  selected,
  onSelect,
}: {
  p: ProgressResponse;
  metric: string;
  label: string;
  unit: string;
  selected?: number | null;
  onSelect?: (index: number) => void;
}) {
  const data = useMemo(() => {
    const raw = p.series.map((s) => s.values[metric]);
    const w = 5;
    return p.series.map((s, i) => {
      const slice = raw.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v != null);
      const avg = slice.length ? Math.round((slice.reduce((a, b) => a + b, 0) / slice.length) * 10) / 10 : null;
      return { index: s.index, raw: s.values[metric], avg, blockName: s.blockName };
    });
  }, [p, metric]);

  // Alternating shaded bands per block.
  const bands = useMemo(() => {
    const out: { name: string; start: number; end: number }[] = [];
    p.series.forEach((s) => {
      const last = out[out.length - 1];
      if (last && last.name === s.blockName) last.end = s.index;
      else out.push({ name: s.blockName, start: s.index, end: s.index });
    });
    return out;
  }, [p]);

  const isProcess = metric === "process";

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={data}
        margin={{ top: 10, right: 12, left: -8, bottom: 0 }}
        onClick={(e: any) => { const i = e?.activeLabel; if (i != null && onSelect) onSelect(Number(i)); }}
        style={{ cursor: onSelect ? "pointer" : "default" }}
      >
        <CartesianGrid stroke="#2b2b31" strokeDasharray="3 3" />
        {bands.map((b, i) =>
          i % 2 === 1 ? (
            <ReferenceArea key={i} x1={b.start - 0.5} x2={b.end + 0.5} fill="#ffffff" fillOpacity={0.03} />
          ) : null
        )}
        {selected != null && <ReferenceLine x={selected} stroke="var(--gold)" strokeWidth={1.5} />}
        <XAxis dataKey="index" stroke="#6d6c66" fontSize={12} />
        <YAxis stroke="#6d6c66" fontSize={12} width={46} domain={isProcess ? [0, 100] : ["auto", "auto"]} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(i) => `Game ${i}`}
          formatter={(v: any, n: any) => [v == null ? "—" : `${v}${unit}`, n === "avg" ? `${label} (avg)` : label]}
        />
        <Legend wrapperStyle={{ fontSize: "0.75rem", paddingTop: 4 }} />
        <Line type="linear" dataKey="raw" stroke="#8a857c" strokeOpacity={0} dot={{ r: 2, fill: "#8a857c" }} name={`${label} (per game)`} isAnimationActive={false} />
        <Line type="monotone" dataKey="avg" stroke="#c98a5e" strokeWidth={2.5} dot={false} name={`${label} (5-game avg)`} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// A punchy "what's the story lately" hero: overall trajectory + the biggest
// mover in each direction + current form, from the vs-past-self comparison.
function RecentAnalysis({ p }: { p: ProgressResponse }) {
  const rows = p.pastComparison.filter(
    (r): r is typeof r & { now: number; then: number; delta: number } =>
      r.improved != null && r.now != null && r.then != null && r.delta != null && r.then !== 0
  );
  if (rows.length === 0) return null;
  const rel = (r: typeof rows[number]) => Math.abs(r.delta) / Math.max(1, Math.abs(r.then));
  const improved = rows.filter((r) => r.improved).sort((a, b) => rel(b) - rel(a));
  const declined = rows.filter((r) => !r.improved).sort((a, b) => rel(b) - rel(a));
  const up = improved.length, down = declined.length;
  const headline =
    up > down + 1 ? "You're trending up" : down > up + 1 ? "Some slippage to shore up" : "Holding steady lately";
  const hIcon = up > down + 1 ? "ti-trending-up" : down > up + 1 ? "ti-trending-down" : "ti-activity";
  const hTone = up > down + 1 ? "good" : down > up + 1 ? "bad" : "neutral";
  const fmt = (v: number, unit: string) => `${Math.round(v * 10) / 10}${unit === "%" ? "%" : ""}`;
  const card = (r: typeof rows[number] | undefined, tone: "up" | "down") => {
    if (!r) return null;
    return (
      <div className={`ra-card ${tone}`}>
        <div className="ra-k">{tone === "up" ? "Biggest gain" : "Watch this"}</div>
        <div className="ra-metric">{r.label}</div>
        <div className="ra-move mn">{fmt(r.then, r.unit)} <i className="ti ti-arrow-right" aria-hidden="true" /> {fmt(r.now, r.unit)}</div>
      </div>
    );
  };
  return (
    <div className={`ins-recent ${hTone}`}>
      <div className="rh-lead">
        <span className="rh-icon"><i className={`ti ${hIcon}`} aria-hidden="true" /></span>
        <div>
          <div className="rh-headline">{headline}</div>
          <div className="mlbl">last {p.pastComparisonWindow} games vs. the {p.pastComparisonWindow} before — {up} up, {down} down</div>
        </div>
      </div>
      <div className="rh-cards">
        {card(improved[0], "up")}
        {card(declined[0], "down")}
      </div>
    </div>
  );
}

function TrendGameDetail({ m, onClose }: { m: TrendMatch; onClose: () => void }) {
  const kda = ((m.kills + m.assists) / Math.max(1, m.deaths)).toFixed(2);
  const winColor = m.win ? "var(--green)" : m.win === false ? "var(--red)" : "var(--muted)";
  return (
    <div className="tgd">
      <div className="tgd-head">
        <button className="tgd-back" onClick={onClose}><i className="ti ti-arrow-left" aria-hidden="true" /> All games</button>
        <span className="mlbl">Game {m.index}</span>
      </div>
      <div className="tgd-hero">
        {m.champion && <span className="tgd-splash"><ChampSq champ={m.champion} /></span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tgd-champ">{m.champion ?? "Unknown"}</div>
          <div className="mlbl">{queueLabel(m)} · {new Date(m.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
        </div>
        <div className="tgd-score mn" style={{ color: procColor(m.process) }}>{m.process}</div>
      </div>
      <div className="tgd-rows">
        <div className="tgd-r"><span className="mlbl">Result</span><b style={{ color: winColor }}>{m.win ? "Victory" : m.win === false ? "Defeat" : "—"}</b></div>
        <div className="tgd-r"><span className="mlbl">KDA</span><b className="mn"><span className="k">{m.kills}</span>/<span className="d">{m.deaths}</span>/<span className="a">{m.assists}</span> · {kda}</b></div>
        <div className="tgd-r"><span className="mlbl">Verdict</span><span className={`verdict ${m.verdict}`}>{VERDICT_LABEL[m.verdict]}</span></div>
        <div className="tgd-r"><span className="mlbl">Performance</span><b className="mn" style={{ color: procColor(m.process) }}>{m.process}</b></div>
      </div>
      <Link to={`/match/${m.matchId}`} className="viewmore-btn" style={{ marginTop: 12 }}>Open full match detail →</Link>
    </div>
  );
}

function Calendar({ days, weeks }: { days: DayActivity[]; weeks: number }) {
  const map = new Map(days.map((d) => [d.date, d]));
  const cells: { date: string; act: DayActivity | undefined }[] = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Start on the Sunday `weeks` weeks ago.
  const start = new Date(today);
  start.setDate(start.getDate() - weeks * 7 - today.getDay());

  const total = weeks * 7 + today.getDay() + 1;
  for (let i = 0; i < total; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push({ date: key, act: map.get(key) });
  }

  // Group into week columns (7 rows each).
  const columns: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7));

  return (
    <div>
      <div className="cal-grid">
        {columns.map((col, ci) => (
          <div className="cal-col" key={ci}>
            {col.map((c) => (
              <div
                key={c.date}
                className="cal-cell"
                style={{ background: cellColor(c.act) }}
                title={
                  c.act
                    ? `${c.date}: ${c.act.games} game${c.act.games === 1 ? "" : "s"}, avg process ${c.act.avgProcess}, ${Math.round(c.act.reviewedRate * 100)}% reviewed`
                    : `${c.date}: no games`
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className="cal-legend">
        <span className="faint">worse</span>
        <div className="cal-cell" style={{ background: "#6b3a34" }} />
        <div className="cal-cell" style={{ background: "#6b5a2e" }} />
        <div className="cal-cell" style={{ background: "#4e6b3a" }} />
        <span className="faint">better</span>
        <span className="cal-legend-note faint">· empty = rest day</span>
      </div>
    </div>
  );
}

function cellColor(a: DayActivity | undefined) {
  if (!a || a.games === 0) return "#0c0c0f";
  if (a.avgProcess >= 65) return "#4e6b3a";
  if (a.avgProcess >= 45) return "#6b5a2e";
  return "#6b3a34";
}

const tooltipStyle = {
  background: "#202024",
  border: "1px solid #3a3a42",
  borderRadius: 8,
  fontFamily: "var(--mono)",
};

function procColor(p: number) {
  if (p >= 65) return "#93ac6b";
  if (p >= 45) return "#d6a24e";
  return "#cf7f6d";
}
function shorten(n: string) {
  return n.length > 14 ? n.slice(0, 13) + "…" : n;
}

function fmtMetric(value: number | null, unit: string) {
  if (value == null) return "—";
  return `${value}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
}

function fmtDelta(value: number | null, unit: string) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
}
