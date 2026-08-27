import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import type { ObjectivesResponse, GoalProgress } from "../../shared/types.ts";
import { api } from "../api.ts";
import { champSquare, subscribeVersion } from "../ddragon.ts";

// A floating, draggable, minimizable Objectives panel (à la the League client's
// Objectives modal) — your active block + goals + profile level, reachable from
// any page via a launcher button. Minimizing collapses it back to the launcher.

const POS_KEY = "objectivesDockPos";
const OPEN_KEY = "objectivesDockOpen";
const round1 = (v: number | null) => (v == null ? "—" : Math.round(v * 10) / 10);

function Ring({ pct, met, size = 40 }: { pct: number; met: boolean; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const col = met ? "var(--green)" : "var(--accent)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="obj-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2a30" strokeWidth="3.5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="3.5"
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {met ? (
        <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" fill="var(--green)" fontSize={size / 2.1}>✓</text>
      ) : (
        <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" fill="var(--muted)" fontSize={size / 3.3} fontFamily="var(--mono)">{Math.round(pct)}</text>
      )}
    </svg>
  );
}

function GoalRow({ g }: { g: GoalProgress }) {
  return (
    <div className={`obj-goal ${g.met ? "met" : ""}`}>
      <Ring pct={g.pct} met={g.met} />
      <div className="obj-goal-body">
        <div className="obj-goal-title">{g.goal.title}</div>
        <div className="obj-goal-sub">now {round1(g.current)} · {g.goal.direction === "lower" ? "≤" : "≥"} {g.target} {g.goal.unit}{g.detail ? ` · ${g.detail}` : ""}</div>
      </div>
    </div>
  );
}

export default function FloatingObjectives() {
  const [data, setData] = useState<ObjectivesResponse | null>(null);
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } });
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (p && typeof p.x === "number") return p; } catch { /* ignore */ }
    return { x: Math.max(16, window.innerWidth - 392), y: 78 };
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const [, force] = useState(0);

  useEffect(() => subscribeVersion(() => force((n) => n + 1)), []);
  useEffect(() => {
    const load = () => api.objectives().then(setData).catch(() => {});
    load();
    window.addEventListener("data:refresh", load);
    return () => window.removeEventListener("data:refresh", load);
  }, []);
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* ignore */ } }, [open]);
  useEffect(() => { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ } }, [pos]);

  const goals = data?.goals ?? [];
  const doneCount = goals.filter((g) => g.met).length;

  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(8, Math.min(window.innerWidth - 360, p.x)),
    y: Math.max(8, Math.min(window.innerHeight - 120, p.y)),
  });
  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return; // buttons aren't drag handles
    drag.current = { id: e.pointerId, ox: e.clientX - pos.x, oy: e.clientY - pos.y };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setPos(clamp({ x: e.clientX - drag.current.ox, y: e.clientY - drag.current.oy }));
  }
  function up(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  // Minimized: just the launcher, always available across pages.
  if (!open) {
    return (
      <button className="obj-fab" onClick={() => setOpen(true)} title="Objectives — your active block & goals">
        <i className="ti ti-target-arrow" aria-hidden="true" />
        {goals.length > 0 && <span className={`obj-fab-badge ${doneCount === goals.length ? "done" : ""}`}>{doneCount}/{goals.length}</span>}
      </button>
    );
  }

  return (
    <div className={`obj-dock ${dragging ? "dragging" : ""}`} style={{ left: pos.x, top: pos.y }}>
      <div className="obj-head" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <span className="obj-head-ic">
          {data?.block?.focusChampion
            ? <img src={champSquare(data.block.focusChampion)} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
            : <i className="ti ti-target-arrow" aria-hidden="true" />}
        </span>
        <div className="obj-head-main">
          <div className="obj-title">{data?.block?.name ?? "Objectives"}</div>
          <div className="obj-sub">{data?.block ? `${data.gamesLogged}/${data.block.targetGames} games · ${doneCount}/${goals.length} goals` : "No active block"}</div>
        </div>
        <button className="obj-btn" title="Minimize" onClick={() => setOpen(false)}><i className="ti ti-minus" aria-hidden="true" /></button>
      </div>

      {data && (
        <div className="obj-level" title="Profile Level — from your achievement tiers">
          <div className="obj-level-top"><span>Level {data.level.level}</span><span className="faint">{data.level.xpIntoLevel.toLocaleString()} / {data.level.xpForNext.toLocaleString()} XP</span></div>
          <div className="obj-level-bar"><div style={{ width: `${data.level.levelPct}%` }} /></div>
        </div>
      )}

      <div className="obj-body">
        {!data?.block ? (
          <div className="obj-empty">
            <i className="ti ti-flag-plus" aria-hidden="true" />
            <p>No active block. Start one to track goals here.</p>
            <Link to="/seasons" className="sm" onClick={() => setOpen(false)}>Go to Blocks</Link>
          </div>
        ) : goals.length === 0 ? (
          <div className="obj-empty">
            <p>This block has no goals yet.</p>
            <Link to="/seasons" className="sm" onClick={() => setOpen(false)}>Add goals</Link>
          </div>
        ) : (
          <>
            <div className="obj-block-prog"><div style={{ width: `${Math.min(100, (data.gamesLogged / Math.max(1, data.block.targetGames)) * 100)}%` }} /></div>
            {goals.map((g) => <GoalRow key={g.goal.id} g={g} />)}
          </>
        )}
      </div>

      <div className="obj-foot">
        <Link to="/" onClick={() => setOpen(false)}>Overview</Link>
        <Link to="/seasons" onClick={() => setOpen(false)}>Manage blocks</Link>
      </div>
    </div>
  );
}
