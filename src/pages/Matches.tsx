import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { EnrichedMatch } from "../../shared/types.ts";
import { api } from "../api.ts";
import { queueLabel } from "../ui.tsx";
import { champSquare, champName, champId, itemIcon, spellIcon, subscribeVersion } from "../ddragon.ts";
import { loadFilter, subscribeFilter, gameTypeLabel, type GlobalFilter } from "../globalFilter.ts";

const procColor = (v: number) => (v >= 65 ? "var(--green)" : v >= 45 ? "var(--gold)" : "var(--red)");

const QUEUE_MATCH: Record<string, (q: string) => boolean> = {
  ranked_solo: (q) => q.includes("RANKED_SOLO"),
  ranked_flex: (q) => q.includes("RANKED_FLEX"),
  swiftplay: (q) => q.includes("SWIFTPLAY") || q.includes("QUICKPLAY"),
  draft: (q) => q.includes("DRAFT") || q.includes("BLIND"),
  aram: (q) => q.includes("ARAM") && !q.includes("MAYHEM"),
  arena: (q) => q.includes("ARENA"),
};

function Icon({ src, size = 22 }: { src: string | null; size?: number }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return <span className="mrow-slot" style={{ width: size, height: size }} />;
  return <img className="mrow-item" style={{ width: size, height: size }} src={src} alt="" onError={() => setOk(false)} />;
}

function RichMatchRow({ m }: { m: EnrichedMatch }) {
  const o = m.objective;
  const win = o.win;
  const k = o.kills ?? 0, d = o.deaths ?? 0, a = o.assists ?? 0;
  const kda = ((k + a) / Math.max(1, d)).toFixed(2);
  const b = o.build;
  const date = new Date(m.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <Link to={`/match/${m.id}`} className={`mrow ${win ? "win" : win === false ? "loss" : ""}`}>
      <span className="mrow-rail" />
      <img className="mrow-face" src={champSquare(o.champion ?? "")} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
      <div className="mrow-main">
        <div className="mrow-top">
          <b>{o.champion ? champName(o.champion) : "—"}</b>
          <span className="qbadge">{queueLabel(o)}</span>
        </div>
        <div className="mrow-tags">
          {m.tags.slice(0, 3).map((t, i) => <span key={i} className={`mtag ${t.tone}`} title={t.hint}>{t.label}</span>)}
        </div>
      </div>
      <div className="mrow-kda mn"><span className="k">{k}</span>/<span className="d">{d}</span>/<span className="a">{a}</span><div className="kda-ratio">{kda} KDA</div></div>
      {b && (
        <div className="mrow-build">
          <div className="mrow-items">
            {b.items.map((it, i) => <Icon key={i} src={itemIcon(it)} />)}
            <Icon src={itemIcon(b.trinket)} />
          </div>
          <div className="mrow-spells">
            {b.spells.map((s, i) => <Icon key={i} src={spellIcon(s)} size={18} />)}
          </div>
        </div>
      )}
      <div className="mrow-opp">
        {o.opponentChampion ? (
          <>
            <img className="mrow-oppimg" src={champSquare(o.opponentChampion)} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
            <span className="mrow-oppname">{o.opponentName ?? champName(o.opponentChampion)}</span>
          </>
        ) : <span className="faint" style={{ fontSize: "0.75rem" }}>—</span>}
      </div>
      <div className="mrow-perf mn" style={{ color: procColor(m.process.score) }} title="Performance score (0–100)">{m.process.score}</div>
      <div className="mrow-date mlbl">{date}</div>
    </Link>
  );
}

export default function Matches() {
  const [matches, setMatches] = useState<EnrichedMatch[] | null>(null);
  const [filter, setFilter] = useState<GlobalFilter>(loadFilter);
  const [, force] = useState(0);
  useEffect(() => subscribeFilter(setFilter), []);
  useEffect(() => subscribeVersion(() => force((n) => n + 1)), []);
  useEffect(() => {
    const load = () => api.matchList().then((r) => setMatches(r.matches)).catch(() => setMatches([]));
    load();
    window.addEventListener("data:refresh", load);
    return () => window.removeEventListener("data:refresh", load);
  }, []);

  const match = filter.queue === "all" ? null : QUEUE_MATCH[filter.queue];
  const shown = (matches ?? []).filter((m) => {
    if (match && !match((m.objective.queue ?? "").toUpperCase())) return false;
    if (filter.role && m.objective.role !== filter.role) return false;
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Matches</h1>
          <div className="sub">{filter.queue === "all" ? "Every game" : `${gameTypeLabel(filter.queue)} games`} — build, opponent, and result. Click any to break it down.</div>
        </div>
      </div>
      {matches == null ? (
        <div className="empty"><i className="ti ti-loader-2 spin" aria-hidden="true" /> Loading your matches…</div>
      ) : shown.length === 0 ? (
        <div className="card muted">No games for this filter yet.</div>
      ) : (
        <div className="match-list card">
          {shown.map((m) => <RichMatchRow key={m.id} m={m} />)}
        </div>
      )}
    </>
  );
}
