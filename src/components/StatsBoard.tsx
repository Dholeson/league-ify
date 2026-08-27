import { useEffect, useMemo, useState } from "react";
import type { StatsResponse, StatDomain, StatTile } from "../../shared/types.ts";
import { api } from "../api.ts";
import { useCountUp } from "../ui.tsx";
import { loadFilter, subscribeFilter, gameTypeLabel } from "../globalFilter.ts";

// The DPM-Lens-style skill board: composite dial + domain dials + stat tiles +
// rank ladder. Reads the global game-type/role filter. Rendered on the Report
// page under the Career Trend (formerly its own Stats page).

function scoreColor(s: number) {
  if (s >= 65) return "var(--green)";
  if (s >= 45) return "var(--gold)";
  return "var(--red)";
}

function Dial({ score, size = 46 }: { score: number; size?: number }) {
  const shown = useCountUp(score);
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const off = c * (1 - shown / 100);
  return (
    <svg width={size} height={size} className="dial" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a30" strokeWidth="4" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(score)} strokeWidth="4"
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" className="dial-num" fill={scoreColor(score)}>{shown}</text>
    </svg>
  );
}

function fmtVal(t: StatTile) {
  if (t.value == null) return "—";
  if (t.unit === "%") return `${Math.round(t.value)}%`;
  if (t.unit === "g") return `${t.value >= 0 ? "+" : ""}${Math.round(t.value)}`;
  if (t.unit === "s") return `${Math.floor(t.value / 60)}:${String(Math.round(t.value % 60)).padStart(2, "0")}`;
  return `${t.value}`;
}

function StatLadder({ t }: { t: StatTile }) {
  if (!t.ladder) return null;
  const max = Math.max(...t.ladder.map((p) => Math.abs(p.value)), 1);
  return (
    <div className="ladder">
      {t.ladder.map((p, i) => {
        const h = Math.max(6, (Math.abs(p.value) / max) * 100);
        return (
          <div className={`lad-col ${p.isYou ? "you" : ""}`} key={i} title={`${p.rank}: ${p.value}`}>
            <span className="lad-v">{Math.round(p.value)}</span>
            <div className="lad-bar" style={{ height: `${h}%`, background: p.isYou ? "var(--gold)" : scoreColor(t.better ? 70 : 40) }} />
            <span className="lad-r">{p.rank}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function StatsBoard() {
  const [filter, setFilterState] = useState(loadFilter);
  const queue = filter.queue === "all" ? "sr" : filter.queue;
  const role = filter.role;
  const [data, setData] = useState<StatsResponse | null>(null);
  const [sel, setSel] = useState<string>("fighting");
  const [focus, setFocus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  useEffect(() => subscribeFilter(setFilterState), []);
  useEffect(() => {
    const onData = () => setTick((t) => t + 1);
    window.addEventListener("data:refresh", onData);
    return () => window.removeEventListener("data:refresh", onData);
  }, []);
  useEffect(() => {
    setData(null); setErr(null);
    api.stats(queue, role).then((d) => {
      setData(d);
      if (d.domains.length && !d.domains.some((x) => x.key === sel)) setSel(d.domains[0].key);
    }).catch((e) => setErr(String(e.message)));
  }, [queue, role, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const domain: StatDomain | undefined = useMemo(
    () => data?.domains.find((d) => d.key === sel) ?? data?.domains[0],
    [data, sel]
  );
  const focusTile = useMemo(
    () => domain?.tiles.find((t) => t.key === focus) ?? domain?.tiles.find((t) => t.ladder) ?? domain?.tiles[0],
    [domain, focus]
  );

  return (
    <>
      {err && <div className="card muted">{err}</div>}
      {!data && !err && <div className="card muted" style={{ display: "flex", alignItems: "center", gap: 8 }}><i className="ti ti-loader-2 spin" aria-hidden="true" /> Crunching your skill scores…</div>}
      {data && !data.found && <div className="card muted">No {gameTypeLabel(filter.queue)} games{role ? ` in ${role.toLowerCase()}` : ""} yet — pick another game type or role up top.</div>}

      {data?.found && (
        <div className="card skillboard">
          <div className="sb-top">
            <div className="sh-score">
              <Dial score={data.composite} size={84} />
              <div>
                <div className="sh-lbl">Skill score</div>
                <div className="mlbl">across {data.games} games · vs {data.rank}</div>
              </div>
            </div>
            <div className="sh-domains">
              {data.domains.map((d) => (
                <button key={d.key} className={`sh-dcard ${sel === d.key ? "on" : ""} ${d.weakest ? "weak" : ""}`} onClick={() => { setSel(d.key); setFocus(null); }}>
                  <Dial score={d.score} />
                  <div className="shd-mid">
                    <div className="shd-name"><i className={`ti ${d.icon}`} aria-hidden="true" /> {d.label}</div>
                    {d.weakest && <span className="shd-tag">skill to improve</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {domain && (
            <div className="sb-detail">
              <div className="sb-detail-head">
                <span className="sb-dh-name"><i className={`ti ${domain.icon}`} aria-hidden="true" /> {domain.label}</span>
                <span className="tag">tap a stat for its rank ladder</span>
              </div>
              <div className="stat-tiles">
                {domain.tiles.map((t) => (
                  <button key={t.key} className={`stat-tile ${focusTile?.key === t.key ? "on" : ""} ${t.value == null ? "empty" : ""}`} onClick={() => setFocus(t.key)} title={t.hint}>
                    <div className="st-label">{t.label}</div>
                    <div className="st-value">
                      {fmtVal(t)}
                      {t.value != null && <i className={`ti ti-${t.better ? "caret-up-filled up" : "caret-down-filled down"}`} aria-hidden="true" />}
                    </div>
                    <div className="st-bench mlbl">vs {t.unit === "%" ? `${Math.round(t.benchmark)}%` : Math.round(t.benchmark)}</div>
                  </button>
                ))}
              </div>

              {focusTile && (
                <div className="focus-stat inline">
                  <div className="fs-head">
                    <div>
                      <div className="fs-value mn" style={{ color: scoreColor(focusTile.better ? 70 : 40) }}>{fmtVal(focusTile)}</div>
                      <div className="fs-label">{focusTile.label}</div>
                    </div>
                    <p className="mlbl fs-hint">{focusTile.hint}</p>
                  </div>
                  {focusTile.ladder ? (
                    <StatLadder t={focusTile} />
                  ) : (
                    <div className="fs-noladder">
                      <div className="comp-bar" style={{ height: 10 }}>
                        <div className={`comp-fill ${focusTile.better ? "good" : "bad"}`} style={{ width: `${focusTile.pct}%` }} />
                        <span className="comp-mid" />
                      </div>
                      <p className="mlbl" style={{ marginTop: 6 }}>Benchmark {focusTile.unit === "%" ? `${Math.round(focusTile.benchmark)}%` : Math.round(focusTile.benchmark)} · no per-rank ladder yet.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
