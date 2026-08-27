import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AchievementsResponse, Achievement } from "../../shared/types.ts";
import { api } from "../api.ts";
import { loadFilter, subscribeFilter } from "../globalFilter.ts";

const TIER_COLOR = ["#a9713f", "#9aa0a6", "#d6a24e", "#6f93a3", "#9b8bd0"]; // bronze..diamond

// Ideated level rewards (preview — not yet wired to features).
const LEVEL_UNLOCKS: { level: number; label: string; icon: string }[] = [
  { level: 3, label: "Run two blocks at once", icon: "ti-target-arrow" },
  { level: 5, label: "Pin custom stat cards", icon: "ti-layout-dashboard" },
  { level: 8, label: "Profile frame & badge", icon: "ti-award" },
  { level: 12, label: "Deep-dive coach mode", icon: "ti-compass" },
  { level: 18, label: "Full DPM stat tree", icon: "ti-chart-dots" },
];

function fmt(n: number, unit: string) {
  if (unit === "dmg" && n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${n}`;
}

function AchievementCard({ a }: { a: Achievement }) {
  const color = a.tier > 0 ? TIER_COLOR[Math.min(a.tier - 1, TIER_COLOR.length - 1)] : "var(--faint)";
  const tierName = a.tier > 0 ? a.tierNames[a.tier - 1] : "Locked";
  return (
    <div id={`ach-${a.id}`} className={`ach-card ${a.started ? "" : "unstarted"} ${a.nextTarget == null ? "maxed" : ""}`}>
      <div className="ach-icon" style={{ color, borderColor: a.started ? color : "var(--border)" }}>
        <i className={`ti ${a.icon}`} aria-hidden="true" />
        {a.nextTarget == null && <span className="ach-crown"><i className="ti ti-crown" aria-hidden="true" /></span>}
      </div>
      <div className="ach-body">
        <div className="ach-top">
          <span className="ach-name">{a.name}</span>
          <span className="ach-tier" style={{ color }}>{tierName}{a.tier > 0 ? ` ${"★".repeat(a.tier)}` : ""}</span>
        </div>
        <div className="ach-desc">{a.description}</div>
        <div className="ach-bar">
          <div className="ach-fill" style={{ width: `${a.pct}%`, background: color }} />
        </div>
        <div className="ach-foot">
          <span className="mn">{fmt(a.value, a.unit)}{a.nextTarget != null ? ` / ${fmt(a.nextTarget, a.unit)}` : ""} {a.unit}</span>
          <span className="mlbl">{a.nextTarget == null ? "maxed out" : `${a.tier}/${a.tiers.length} tiers`}</span>
        </div>
        <div className="ach-xp">
          <span className="axp-earned" title="XP this achievement contributes to your Profile Level"><i className="ti ti-bolt" aria-hidden="true" /> {a.xp.toLocaleString()} XP</span>
          {a.nextTierXp > 0 && <span className="axp-next">+{a.nextTierXp.toLocaleString()} at next tier</span>}
        </div>
      </div>
    </div>
  );
}

export default function Achievements() {
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [params] = useSearchParams();
  const focus = params.get("focus");
  const [span, setSpan] = useState<"season" | "all">(() => loadFilter().span ?? "season");

  useEffect(() => subscribeFilter((f) => setSpan(f.span ?? "season")), []);
  useEffect(() => {
    const load = () => api.achievements().then(setData).catch((e) => setErr(String(e.message)));
    load();
    window.addEventListener("data:refresh", load); // season/all-time toggle
    return () => window.removeEventListener("data:refresh", load);
  }, []);

  // Arrived from a notification: scroll to the achievement (or level hero) it's
  // about and flash it so it's obvious why you're here.
  useEffect(() => {
    if (!data || !focus) return;
    const el = document.getElementById(focus === "level" ? "acc-level" : `ach-${focus}`);
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 2200);
    }, 250);
    return () => clearTimeout(t);
  }, [data, focus]);

  const list = useMemo(
    () => (data?.achievements ?? []).filter((a) => !cat || a.category === cat),
    [data, cat]
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Achievements</h1>
          <div className="sub">
            {span === "all" ? "Across your full career history" : "This season only"} — <span className="faint">switch with the season toggle up top</span>.
            {data && <> <b>{data.unlocked}</b> of {data.total} started{data.maxed > 0 ? <> · <b>{data.maxed}</b> maxed</> : null}.</>}
          </div>
        </div>
      </div>

      {err && <div className="card muted">{err}</div>}
      {!data && !err && <div className="empty"><i className="ti ti-loader-2 spin" aria-hidden="true" /> Tallying your records…</div>}
      {data && !data.found && <div className="card muted">Play some games and your achievements start filling in.</div>}

      {data?.found && (
        <>
          <div className="card acc-level" id="acc-level">
            <div className="al-ring"><span className="al-num">{data.level}</span><span className="al-lbl">level</span></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="al-title">Profile Level {data.level}</div>
              <div className="mlbl">Achievement tiers earn XP toward your account rank.</div>
              <div className="al-bar"><div style={{ width: `${data.levelPct}%` }} /></div>
              <div className="mlbl">{data.xpIntoLevel.toLocaleString()} / {data.xpForNext.toLocaleString()} XP to level {data.level + 1} · {data.xp.toLocaleString()} total</div>
            </div>
          </div>
          <div className="acc-unlocks">
            <div className="mlbl" style={{ marginBottom: 8 }}>Level rewards <span className="faint">· preview — coming soon</span></div>
            <div className="ul-grid">
              {LEVEL_UNLOCKS.map((u) => {
                const on = data.level >= u.level;
                return (
                  <div className={`unlock ${on ? "on" : ""}`} key={u.level}>
                    <span className="ul-ic"><i className={`ti ${on ? u.icon : "ti-lock"}`} aria-hidden="true" /></span>
                    <div><div className="ul-lvl">Level {u.level}{on ? " · unlocked" : ""}</div><div className="ul-label">{u.label}</div></div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card champ-filters ach-filters">
            <div className="cf-group">
              <span className="cf-label">Category</span>
              <button className={!cat ? "on" : ""} onClick={() => setCat(null)}>All</button>
              {data.categories.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
            </div>
          </div>
          <div className="ach-grid">
            {list.map((a) => <AchievementCard key={a.id} a={a} />)}
          </div>
        </>
      )}
    </>
  );
}
