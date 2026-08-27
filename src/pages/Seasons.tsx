import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  Identity,
  Champion,
  BlockReview,
  BlockCardSummary,
  BlockPlanProposal,
  BlockImageryKind,
  ProposedGoal,
  GoalProgress,
  EnrichedMatch,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { Bar, useToast, VERDICT_LABEL, roleLabel } from "../ui.tsx";

const splashUrl = (c: string) =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c}_0.jpg`;

const BLOCK_TYPES: { key: string; label: string }[] = [
  { key: "ranked", label: "Ranked" },
  { key: "normal", label: "Normal" },
  { key: "aram", label: "ARAM" },
  { key: "any", label: "Any queue" },
];
const TYPE_LABEL: Record<string, string> = {
  ranked: "Ranked", normal: "Normal", aram: "ARAM", any: "Any queue",
};
const FOCUS: { key: string; label: string; icon: string }[] = [
  { key: "carry", label: "Carrying", icon: "ti-swords" },
  { key: "survival", label: "Dying less", icon: "ti-shield-half" },
  { key: "farm", label: "Farming", icon: "ti-coins" },
  { key: "objectives", label: "Objectives", icon: "ti-topology-star-3" },
  { key: "vision", label: "Vision", icon: "ti-eye" },
  { key: "general", label: "Consistency", icon: "ti-progress-check" },
];
const IMG_ICON: Record<BlockImageryKind, string> = {
  champion: "ti-user-star", objectives: "ti-topology-star-3", vision: "ti-eye",
  survival: "ti-shield-half", farm: "ti-coins", carry: "ti-swords", general: "ti-target-arrow",
};

export default function Seasons() {
  const [summaries, setSummaries] = useState<BlockCardSummary[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toast = useToast();

  const load = () =>
    Promise.all([api.blockSummaries(), api.identities()]).then(([ss, ids]) => {
      setSummaries(ss);
      setIdentities(ids);
    });

  useEffect(() => { load(); }, []);

  const active = summaries.find((s) => s.isActive);
  const others = summaries.filter((s) => !s.isActive);
  const completedCount = others.filter((s) => s.season.status === "complete").length;
  const visible = others
    .filter((s) => showCompleted || s.season.status !== "complete")
    .sort((a, b) => +new Date(b.season.startedAt) - +new Date(a.season.startedAt));

  const identityFor = (id: string) => identities.find((i) => i.id === id);

  return (
    <>
      {toast.node}
      <div className="page-head">
        <div>
          <h1>Blocks</h1>
          <div className="sub">
            Focused campaigns — a champion, a queue, or a part of the game. Every block tracks the
            games that match it, even the ones you haven't pinned active.
          </div>
        </div>
      </div>

      <Composer
        onCreate={async (body) => {
          try {
            await api.createSeason(body);
            await load();
            toast.ok("Block started and pinned active.");
          } catch (e) {
            toast.err(String((e as Error).message));
          }
        }}
      />

      {active && (
        <>
          <div className="section-title"><h2>Active block</h2><span className="tag">pinned to the top of your app</span></div>
          <BlockPanel
            summary={active}
            identity={identityFor(active.season.identityId)}
            expanded
            onActivate={async () => { await api.activateSeason(active.season.id); await load(); }}
            onComplete={async (r) => { try { await api.completeSeason(active.season.id, r); await load(); toast.ok("Block closed."); } catch (e) { toast.err(String((e as Error).message)); } }}
          />
        </>
      )}

      <div className="section-title">
        <h2>{active ? "Other blocks" : "Your blocks"}</h2>
        {completedCount > 0 && (
          <label className="show-completed">
            <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
            <span className="switch" /> Show completed ({completedCount})
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="card muted">No other blocks. Draft one above.</div>
      ) : (
        <div className="block-grid">
          {visible.map((s) => (
            <BlockPanel
              key={s.season.id}
              summary={s}
              identity={identityFor(s.season.identityId)}
              expanded={expanded === s.season.id}
              onToggle={() => setExpanded(expanded === s.season.id ? null : s.season.id)}
              onActivate={async () => { await api.activateSeason(s.season.id); await load(); toast.ok(`"${s.season.name}" is now active.`); }}
              onComplete={async (r) => { try { await api.completeSeason(s.season.id, r); await load(); toast.ok("Block closed."); } catch (e) { toast.err(String((e as Error).message)); } }}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ---- Coach composer -------------------------------------------------------

function ChampionSearch({ champ, onPick }: { champ: string | null; onPick: (c: string | null) => void }) {
  const [all, setAll] = useState<Champion[]>([]);
  const [q, setQ] = useState(champ ?? "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { api.champions().then((r) => setAll(r.champions)).catch(() => {}); }, []);
  useEffect(() => { setQ(champ ?? ""); }, [champ]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const s = q.trim().toLowerCase();
  const matches = s ? all.filter((c) => c.name.toLowerCase().includes(s)).slice(0, 8) : [];

  return (
    <div className="champ-search" ref={ref}>
      <div className="cs-input">
        {champ ? (
          <img src={`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${champ}_0.jpg`} alt="" className="cs-thumb" />
        ) : <i className="ti ti-search" aria-hidden="true" />}
        <input
          placeholder="Search a champion…"
          value={q}
          onChange={(e) => { setQ(e.target.value); onPick(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {champ && <button className="cs-clear" onClick={() => { onPick(null); setQ(""); }} title="Clear"><i className="ti ti-x" aria-hidden="true" /></button>}
      </div>
      {open && matches.length > 0 && (
        <div className="cs-drop">
          {matches.map((c) => (
            <button key={c.id} className="cs-opt" onClick={() => { onPick(c.name); setQ(c.name); setOpen(false); }}>
              <img src={c.imageUrl} alt="" />
              <span>{c.name}</span>
              <span className="faint">{c.tags[0]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({ onCreate }: { onCreate: (b: any) => void }) {
  const [blockType, setBlockType] = useState("ranked");
  const [champ, setChamp] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [proposal, setProposal] = useState<BlockPlanProposal | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(1); // reveal steps 1 → 2 → 3

  const reset = () => setProposal(null);

  async function draft() {
    setDrafting(true);
    try {
      const p = await api.blockPlan({ champion: champ, focus, blockType });
      setProposal(p);
    } finally {
      setDrafting(false);
    }
  }

  // Create the block, then clear the draft and reset the composer to a fresh
  // slate — so the started block only lives in the list below, not lingering here.
  async function start() {
    if (!proposal) return;
    setCreating(true);
    try {
      await onCreate({
        name: proposal.name, theme: proposal.theme, goal: proposal.goal,
        identityId: proposal.identityId, targetGames: proposal.targetGames,
        blockType: proposal.blockType, focusChampion: proposal.focusChampion,
        goals: proposal.goals.map((g) => ({ templateId: g.templateId, target: g.target, champion: g.champion ?? null, baseline: g.baseline })),
      });
      setProposal(null);
      setChamp(null);
      setFocus(null);
      setStep(1);
    } finally {
      setCreating(false);
    }
  }

  const canDraft = !!champ || !!focus;

  return (
    <div className="card composer" data-nav="Coach composer">
      <div className="composer-head">
        <span className="coach-kicker"><i className="ti ti-wand" aria-hidden="true" /> Coach composer</span>
        <h2 style={{ margin: "6px 0 0" }}>Compose your next block</h2>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
          Tell the coach what matters — a champion, a part of the game, or both. It reads your history and drafts goals aimed at where you're actually weak.
        </p>
      </div>

      <div className="compose-step">
        <div className="cs-num on">1</div>
        <div style={{ flex: 1 }}>
          <div className="cs-label">Which queue does this block track?</div>
          <div className="seg" style={{ maxWidth: 380, marginTop: 6 }}>
            {BLOCK_TYPES.map((t) => (
              <button key={t.key} className={blockType === t.key ? "on" : ""} onClick={() => { setBlockType(t.key); reset(); setStep((s) => Math.max(s, 2)); }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {step >= 2 && (
        <div className="compose-step reveal">
          <div className="cs-num on">2</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cs-label">Zeroing in on one champion?</div>
            <p className="cs-help">
              Add a champion and the block <b>only counts games on them</b> — and the goals get built from your recent games on that champ.
              Working across your whole pool instead? Just skip it.
            </p>
            <div style={{ marginTop: 8, maxWidth: 380 }}>
              <ChampionSearch champ={champ} onPick={(c) => { setChamp(c); reset(); setStep((s) => Math.max(s, 3)); }} />
            </div>
            {step < 3 && (
              <button className="ghost sm mt" onClick={() => setStep(3)}>Skip — work across my pool →</button>
            )}
          </div>
        </div>
      )}

      {step >= 3 && (
        <div className="compose-step reveal">
          <div className="cs-num on">3</div>
          <div style={{ flex: 1 }}>
            <div className="cs-label">What part of the game do you want to lift? <span className="faint">{champ ? "(optional for a champion block)" : ""}</span></div>
            <div className="focus-chips" style={{ marginTop: 8 }}>
              {FOCUS.map((f) => (
                <button key={f.key} className={`focus-chip ${focus === f.key ? "on" : ""}`} onClick={() => { setFocus(focus === f.key ? null : f.key); reset(); }}>
                  <i className={`ti ${f.icon}`} aria-hidden="true" /> {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step >= 3 && (
        <button className="mt compose-cta" onClick={draft} disabled={drafting || !canDraft}>
          {drafting ? "Coach is composing…" : "Have the coach draft it →"}
        </button>
      )}

      {proposal && (
        <div className="proposal mt">
          <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div className="prop-name">{proposal.name}</div>
              <div className="muted" style={{ fontSize: "0.85rem" }}>{proposal.theme}</div>
            </div>
            <div className="flex" style={{ gap: 6 }}>
              <span className="pill accent">{TYPE_LABEL[proposal.blockType]}</span>
              <span className="pill">{proposal.targetGames} games</span>
            </div>
          </div>

          <div className="coach-read"><i className="ti ti-quote" aria-hidden="true" /> {proposal.rationale}</div>

          <div className="prop-goals">
            {proposal.goals.map((g, i) => <ProposedGoalRow key={i} g={g} />)}
          </div>

          <div className="flex mt" style={{ gap: 8 }}>
            <button onClick={start} disabled={creating}>{creating ? "Starting…" : "Start this block →"}</button>
            <button className="ghost" onClick={draft} disabled={creating}>Redraft</button>
            <button className="ghost" onClick={() => setProposal(null)} disabled={creating}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProposedGoalRow({ g }: { g: ProposedGoal }) {
  const [showWhat, setShowWhat] = useState(false);
  const arrow = g.direction === "lower" ? "≤" : "≥";
  return (
    <div className="goal-card">
      <div className="gc-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="gc-title">{g.title}{g.champion ? <span className="pill accent" style={{ marginLeft: 6 }}>{g.champion}</span> : null}</div>
          <div className="gc-desc">{g.description}</div>
        </div>
        <span className="gc-target mn">{arrow}{g.target}{g.unit && !/^%/.test(g.unit) ? ` ${g.unit}` : ""}</span>
      </div>
      <GoalMeter baseline={g.baseline} target={g.target} current={null} fillPct={0} direction={g.direction} unit={g.unit} met={false} />
      {g.whatCounts && (
        <button className="gc-what" onClick={() => setShowWhat((s) => !s)}>
          <i className={`ti ti-chevron-${showWhat ? "down" : "right"}`} aria-hidden="true" /> what counts
        </button>
      )}
      {showWhat && g.whatCounts && <div className="gc-what-body">{g.whatCounts}</div>}
    </div>
  );
}

function GoalMeter({ baseline, target, current, fillPct, direction, unit, met }: {
  baseline: number | null; target: number; current: number | null; fillPct: number;
  direction: "higher" | "lower"; unit: string; met: boolean;
}) {
  const suffix = unit && /^%/.test(unit) ? "%" : "";
  return (
    <div className="goal-meter">
      <div className="gm-track">
        <div className={`gm-fill ${met ? "met" : ""}`} style={{ width: `${Math.max(2, fillPct)}%` }} />
        {current != null && baseline != null && <div className="gm-now" style={{ left: `${Math.max(0, Math.min(100, fillPct))}%` }} title={`now ${current}`} />}
      </div>
      <div className="gm-labels">
        <span>{baseline != null ? `you're at ${baseline}${suffix}` : current != null ? `now ${current}${suffix}` : "no baseline yet"}</span>
        <span className="gm-goal">goal {direction === "lower" ? "≤" : "≥"}{target}{suffix}</span>
      </div>
    </div>
  );
}

// ---- Block panel (compact card that expands to the full review) -----------

function BlockImagery({ imagery, kind }: { imagery: BlockCardSummary["imagery"]; kind: "sm" | "lg" }) {
  const cls = `block-img ${kind} ${imagery.kind}`;
  if (imagery.kind === "champion" && imagery.champion) {
    return <span className={cls}><ChampSq champ={imagery.champion} /></span>;
  }
  return <span className={`${cls} ic`}><i className={`ti ${IMG_ICON[imagery.kind]}`} aria-hidden="true" /></span>;
}

function BlockPanel({
  summary, identity, expanded, onToggle, onActivate, onComplete,
}: {
  summary: BlockCardSummary;
  identity?: Identity;
  expanded: boolean;
  onToggle?: () => void;
  onActivate: () => void;
  onComplete: (retro: Record<string, string>) => void;
}) {
  const { season } = summary;
  const done = season.status === "complete";
  const goalsLeft = summary.goals.filter((g) => !g.met).slice(0, 2);
  const gamesPct = Math.min(100, (summary.games / Math.max(1, summary.target)) * 100);

  return (
    <div className={`card block-panel ${expanded ? "open" : ""} ${done ? "done" : ""}`}>
      <div className="bp-head" onClick={onToggle} style={{ cursor: onToggle ? "pointer" : "default" }}>
        <BlockImagery imagery={summary.imagery} kind="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="bp-title">
            {season.name}
            <span className="pill" style={{ marginLeft: 8 }}>{TYPE_LABEL[season.blockType ?? "any"]}</span>
            {done && <span className="pill green">complete</span>}
          </div>
          <div className="mlbl">{identity?.name ?? "block"} · {summary.games}/{summary.target} games · {summary.winRate}% WR</div>
        </div>
        {onToggle && <i className={`ti ti-chevron-${expanded ? "up" : "down"} chev`} aria-hidden="true" />}
      </div>

      {/* limited progression when collapsed */}
      {!expanded && (
        <div className="bp-mini">
          <div className="bp-mini-bar">
            <div className="flex" style={{ justifyContent: "space-between" }}>
              <span className="mlbl">Games</span>
              <span className="mn mlbl">{summary.games}/{summary.target}</span>
            </div>
            <Bar value={gamesPct} max={100} variant="gold" />
          </div>
          <div className="bp-goalsmet">
            <span className="mn" style={{ color: "var(--accent)" }}>{summary.goalsMet}</span>
            <span className="mlbl">/ {summary.goalsTotal} goals</span>
          </div>
          {goalsLeft.length > 0 && (
            <div className="bp-left">
              {goalsLeft.map((g, i) => (
                <div className="bp-left-goal" key={i}>
                  <span className="bp-lg-t">{g.title}</span>
                  <span className="mn mlbl">{g.current ?? "—"}/{g.direction === "lower" ? "≤" : "≥"}{g.target}</span>
                </div>
              ))}
            </div>
          )}
          {!summary.isActive && season.status === "active" && (
            <button className="ghost sm bp-setactive" onClick={(e) => { e.stopPropagation(); onActivate(); }}>
              <i className="ti ti-pin" aria-hidden="true" /> Set active
            </button>
          )}
        </div>
      )}

      {expanded && (
        <ExpandedBlock summary={summary} onActivate={onActivate} onComplete={onComplete} />
      )}
    </div>
  );
}

function ExpandedBlock({
  summary, onActivate, onComplete,
}: {
  summary: BlockCardSummary;
  onActivate: () => void;
  onComplete: (retro: Record<string, string>) => void;
}) {
  const { season } = summary;
  const [retroOpen, setRetroOpen] = useState(false);
  const [retro, setRetro] = useState({ whatWorked: "", whatBroke: "", keepDoing: "", stopDoing: "", nextBlockFocus: "" });

  const unmet = summary.goals.filter((g) => !g.met);
  const allMet = summary.goalsTotal > 0 && unmet.length === 0;

  return (
    <div className="bp-expanded">
      <div className="flex" style={{ gap: 8, marginBottom: 4 }}>
        {!summary.isActive && season.status === "active" && (
          <button className="ghost sm" onClick={onActivate}>Make active</button>
        )}
        {season.status === "active" && (
          allMet ? (
            <button className="sm complete-btn on" onClick={() => setRetroOpen((o) => !o)}>
              {retroOpen ? "Cancel" : "Complete block ✓"}
            </button>
          ) : (
            <div className="complete-wrap">
              <button className="sm complete-btn" disabled>Complete block</button>
              <div className="complete-tip">
                <div className="ct-title">Finish these goals first:</div>
                {unmet.length ? (
                  <ul>
                    {unmet.map((g, i) => (
                      <li key={i}>{g.title} <span className="mn faint">{g.current ?? "—"}/{g.direction === "lower" ? "≤" : "≥"}{g.target}</span></li>
                    ))}
                  </ul>
                ) : (
                  <div className="mlbl">Add some goals to this block before completing it.</div>
                )}
                <div className="mlbl" style={{ marginTop: 6 }}>A block is only complete once every goal is met.</div>
              </div>
            </div>
          )
        )}
      </div>

      {season.retro && (
        <div className="mt">
          <RetroLine label="Worked" text={season.retro.whatWorked} />
          <RetroLine label="Broke" text={season.retro.whatBroke} />
          <RetroLine label="Keep" text={season.retro.keepDoing} />
          <RetroLine label="Stop" text={season.retro.stopDoing} />
          <RetroLine label="Next" text={season.retro.nextBlockFocus} />
        </div>
      )}

      {retroOpen && (
        <div className="mt">
          <p className="muted" style={{ fontSize: "0.83rem" }}>Two minutes — what does the next version of you ship differently?</p>
          {([
            ["whatWorked", "What worked?"], ["whatBroke", "What broke / cost you games?"],
            ["keepDoing", "Keep doing"], ["stopDoing", "Stop doing"], ["nextBlockFocus", "Focus next block"],
          ] as const).map(([key, label]) => (
            <div className="field" key={key}>
              <label>{label}</label>
              <textarea value={retro[key]} onChange={(e) => setRetro({ ...retro, [key]: e.target.value })} />
            </div>
          ))}
          <button onClick={() => onComplete(retro)}>Close block &amp; save notes</button>
        </div>
      )}

      <BlockReviewPanel seasonId={season.id} />
    </div>
  );
}

// ---- Full review (games ring, ladder, goals, champs) ----------------------

function Ring({ value, max, label, sub }: { value: number; max: number; label: string; sub: string }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--accent)" strokeWidth="7"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" transform="rotate(-90 42 42)" />
        <text x="42" y="39" textAnchor="middle" className="ring-v">{value}</text>
        <text x="42" y="55" textAnchor="middle" className="ring-m">/ {max}</text>
      </svg>
      <div className="ring-cap"><div className="rc-l">{label}</div><div className="rc-s">{sub}</div></div>
    </div>
  );
}

function fmtGain(v: number, unit: string) {
  return unit === "%" ? `${Math.round(v)}%` : `${v}`;
}
function procColor(p: number) {
  if (p >= 65) return "var(--green)";
  if (p >= 45) return "var(--gold)";
  return "var(--red)";
}

function BlockReviewPanel({ seasonId }: { seasonId: string }) {
  const [review, setReview] = useState<BlockReview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setReview(null); setErr(null);
    api.blockReview(seasonId).then(setReview).catch((e) => setErr(String(e.message)));
  }, [seasonId]);

  if (err) return <div className="muted mt" style={{ fontSize: "0.85rem" }}>Couldn't load review: {err}</div>;
  if (!review) return <div className="muted mt" style={{ fontSize: "0.85rem" }}>Loading review…</div>;

  if (review.games === 0) {
    const s = review.season;
    const noun = s.focusChampion ? s.focusChampion : `${(TYPE_LABEL[s.blockType ?? "any"] ?? "").toLowerCase()} games`;
    return (
      <div className="block-review mt">
        <div className="br-empty">
          <span className="bre-ic"><i className="ti ti-rocket" aria-hidden="true" /></span>
          <div>
            <div className="bre-title">Go bank some {s.focusChampion ? `${s.focusChampion} games` : noun}</div>
            <div className="bre-msg">
              Nothing tracked here yet — the goals below are set from your recent form, so you can already see the gap.
              Play {noun} and this block fills in automatically (games, a stacked-progress ladder, and your champions all appear here).
            </div>
          </div>
        </div>
        {review.goals.length > 0 && (
          <div className="br-goals" style={{ marginTop: 16 }}>
            <div className="mlbl" style={{ marginBottom: 6 }}>Your goals · baselines from recent games</div>
            {review.goals.map((g) => <GoalReviewRow key={g.goal.id} g={g} />)}
          </div>
        )}
      </div>
    );
  }

  const floorDelta = review.startProcess != null && review.recentProcess != null ? review.recentProcess - review.startProcess : null;

  return (
    <div className="block-review mt">
      <div className="br-top">
        <Ring value={review.games} max={review.target} label="games this block" sub={`${review.winRate}% WR · ${review.wins}W ${review.losses}L`} />
        <div className="br-metrics">
          <div className="br-metric">
            <div className="mlbl">Performance floor</div>
            <div className="flex" style={{ gap: 6, alignItems: "baseline" }}>
              <span className="mn" style={{ color: procColor(review.startProcess ?? 0) }}>{review.startProcess ?? "—"}</span>
              <i className="ti ti-arrow-right faint" aria-hidden="true" />
              <span className="mn" style={{ fontSize: "1.15rem", color: procColor(review.recentProcess ?? 0) }}>{review.recentProcess ?? "—"}</span>
              {floorDelta != null && <span className={`br-delta ${floorDelta >= 0 ? "up" : "down"}`}>{floorDelta >= 0 ? "▲" : "▼"}{Math.abs(floorDelta)}</span>}
            </div>
            <div className="mlbl">start of block → most recent</div>
          </div>
          <div className="br-metric">
            <div className="mlbl">Block performance avg</div>
            <div className="mn" style={{ fontSize: "1.35rem", color: procColor(review.avgProcess) }}>{review.avgProcess}</div>
          </div>
        </div>
      </div>

      {review.statGains.length > 0 && (
        <div className="br-gains-wrap">
          <div className="mlbl" style={{ marginBottom: 8 }}>Biggest changes this block <span className="faint">· vs your games before it started</span></div>
          <div className="br-gains">
            {review.statGains.map((g) => (
              <div className={`br-gain ${g.better ? "up" : "down"}`} key={g.key}>
                <div className="bg-label">{g.label}</div>
                <div className="bg-after mn">{fmtGain(g.after, g.unit)}</div>
                <div className="bg-move mlbl">
                  {g.before != null ? (
                    <>from {fmtGain(g.before, g.unit)} <span className={`bg-delta ${g.better ? "up" : "down"}`}>{g.delta >= 0 ? "▲" : "▼"}{Math.abs(g.delta)}</span></>
                  ) : "new baseline"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(review.goals.length > 0 || review.matches.length > 0) && (
        <div className="br-split">
          {review.goals.length > 0 && (
            <div className="br-goals">
              <div className="mlbl" style={{ marginBottom: 6 }}>Block objectives</div>
              {review.goals.map((g) => <GoalReviewRow key={g.goal.id} g={g} />)}
            </div>
          )}
          {review.matches.length > 0 && (
            <div className="br-matches">
              <div className="mlbl" style={{ marginBottom: 6 }}>Games in this block ({review.matches.length})</div>
              <div className="br-match-list">
                {review.matches.map((m) => <BlockMatchRow key={m.id} m={m} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {review.champions.length > 0 && (
        <div className="br-champs">
          {review.champions.slice(0, 8).map((c) => (
            <Link to={`/champions/${c.champion}`} className="br-champ" key={c.champion}>
              <span className="champ-sq" style={{ width: 26, height: 26 }}><ChampSq champ={c.champion} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="brc-name">{c.champion}</div>
                <div className="mlbl">{c.games}g · {c.winRate}% · M{c.masteryLevel}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function BlockMatchRow({ m }: { m: EnrichedMatch }) {
  const o = m.objective;
  const isAram = (o.queue ?? "").toUpperCase().includes("ARAM");
  const k = o.kills ?? 0, d = o.deaths ?? 0, a = o.assists ?? 0;
  const ratio = ((k + a) / Math.max(1, d)).toFixed(1);
  return (
    <Link to={`/match/${m.id}`} className="bm-row">
      <span className={`wl ${o.win ? "win" : "loss"}`} />
      <span className="champ-sq bm-champ"><ChampSq champ={o.champion ?? ""} /></span>
      <div className="bm-mid">
        <div className="bm-champname">{o.champion}</div>
        <div className="mlbl">{roleLabel(o)} · {new Date(m.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
      </div>
      <div className="bm-kda">
        <div className="mn"><span className="k">{k}</span>/<span className="d">{d}</span>/<span className="a">{a}</span></div>
        <div className="mlbl">{ratio} KDA{isAram ? "" : o.csAt10 != null ? ` · ${o.csAt10} cs@10` : ""}</div>
      </div>
      <span className={`verdict ${m.verdict} bm-verd`}>{VERDICT_LABEL[m.verdict]}</span>
      <span className="mn bm-score" style={{ color: procColor(m.process.score) }}>{m.process.score}</span>
    </Link>
  );
}

function GoalReviewRow({ g }: { g: GoalProgress }) {
  const [showWhat, setShowWhat] = useState(false);
  const arrow = g.goal.direction === "lower" ? "≤" : "≥";
  const unitSuffix = g.goal.unit && !/^%/.test(g.goal.unit) ? ` ${g.goal.unit}` : "";
  return (
    <div className="goal-card">
      <div className="gc-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="gc-title">
            {g.met && <i className="ti ti-circle-check" aria-hidden="true" style={{ color: "var(--green)" }} />} {g.goal.title}
          </div>
          <div className="gc-desc">{g.goal.description}</div>
        </div>
        <span className="gc-target mn" style={{ color: g.met ? "var(--green)" : "var(--muted)" }}>
          {g.current ?? "—"} / {arrow}{g.goal.target}{unitSuffix}
        </span>
      </div>
      <GoalMeter baseline={g.baseline} target={g.goal.target} current={g.current} fillPct={g.fillPct} direction={g.goal.direction} unit={g.goal.unit} met={g.met} />
      <div className="gc-detail-row">
        <span className="mlbl">{g.detail}</span>
        {g.whatCounts && (
          <button className="gc-what" onClick={() => setShowWhat((s) => !s)}>
            <i className={`ti ti-chevron-${showWhat ? "down" : "right"}`} aria-hidden="true" /> what counts
          </button>
        )}
      </div>
      {showWhat && g.whatCounts && <div className="gc-what-body">{g.whatCounts}</div>}
    </div>
  );
}

function ChampSq({ champ }: { champ: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <i className="ti ti-shield-half" style={{ color: "#4d453a", fontSize: 14 }} aria-hidden="true" />;
  return <img src={splashUrl(champ)} alt={champ} onError={() => setOk(false)} />;
}

function RetroLine({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="row">
      <div className="faint" style={{ width: 90 }}>{label}</div>
      <div style={{ flex: 1 }}>{text}</div>
    </div>
  );
}
