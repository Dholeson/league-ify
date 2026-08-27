import { useEffect, useState } from "react";
import type { Verdict, SessionGuardrail, MatchFlag } from "../shared/types.ts";

// Animate a number from 0 → target on mount (and on target change) for a bit of
// life. Honors prefers-reduced-motion by snapping straight to the value.
export function useCountUp(target: number, ms = 750): number {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setV(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  clean_win: "Clean Win",
  bad_win: "Bad Win",
  good_loss: "Good Loss",
  deserved_loss: "Deserved Loss",
  standard: "Standard",
};

export const DEATH_CAUSE_LABEL: Record<string, string> = {
  laning_mistake: "Laning mistake",
  greedy_recall: "Greedy recall",
  facecheck: "Facecheck",
  objective_setup: "Objective setup",
  overextension: "Overextension",
  shutdown_donation: "Shutdown donation",
  teamfight_execution: "Teamfight execution",
  sidelane_greed: "Side-lane greed",
  mechanical_misplay: "Mechanical misplay",
  unavoidable_team_collapse: "Unavoidable team collapse",
};

export function Verdict({ v }: { v: Verdict }) {
  return <span className={`verdict ${v}`}>{VERDICT_LABEL[v]}</span>;
}

export function Bar({
  value,
  max,
  variant,
}: {
  value: number;
  max: number;
  variant?: "gold" | "green";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`bar ${variant ?? ""}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

const RAIL_ICON: Record<string, string> = {
  info: "○",
  caution: "▲",
  stop: "■",
};

export function GuardrailBanner({ rail }: { rail: SessionGuardrail }) {
  const cls = rail.severity === "stop" ? "stop" : rail.severity === "caution" ? "caution" : "info";
  return (
    <div className={`banner ${cls}`}>
      <div className="icon">{RAIL_ICON[rail.severity]}</div>
      <div>
        <div className="title">{rail.title}</div>
        <div className="msg">{rail.message}</div>
      </div>
    </div>
  );
}

export function FlagBanner({ flag }: { flag: MatchFlag }) {
  const cls = flag.kind === "warn" ? "caution" : flag.kind === "reward" ? "reward" : "info";
  const icon = flag.kind === "warn" ? "▲" : flag.kind === "reward" ? "★" : "○";
  return (
    <div className={`banner ${cls}`}>
      <div className="icon">{icon}</div>
      <div className="msg" style={{ color: "var(--text)" }}>
        {flag.message}
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(
    null
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? (
    <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
      {toast.msg}
    </div>
  ) : null;
  return { node, ok: (msg: string) => setToast({ msg, kind: "ok" }), err: (msg: string) => setToast({ msg, kind: "err" }) };
}

// A real role when we have one; otherwise the game type (ARAM / Normal), since
// non-SR modes have no role. Never shows "UNKNOWN".
export function roleLabel(o: { role?: string | null; queue?: string | null }): string {
  if (o.role && o.role !== "UNKNOWN") return o.role;
  const q = (o.queue ?? "").toUpperCase();
  if (q.includes("ARAM")) return "ARAM";
  if (q.includes("NORMAL") || q.includes("DRAFT") || q.includes("BLIND") || q.includes("QUICKPLAY") || q.includes("SWIFTPLAY")) return "Normal";
  if (q.includes("RANKED")) return "Ranked";
  return "";
}

// A short game-type badge, independent of role (Ranked splits Solo/Flex).
export function queueLabel(o: { queue?: string | null }): string {
  const q = (o.queue ?? "").toUpperCase();
  if (q.includes("ARAM")) return "ARAM";
  if (q.includes("RANKED_SOLO")) return "Ranked Solo";
  if (q.includes("RANKED_FLEX")) return "Flex";
  if (q.includes("RANKED")) return "Ranked";
  if (q.includes("SWIFTPLAY") || q.includes("QUICKPLAY")) return "Swiftplay";
  if (q.includes("DRAFT")) return "Draft";
  if (q.includes("BLIND") || q.includes("NORMAL")) return "Normal";
  if (q.includes("CLASH")) return "Clash";
  return "Custom";
}

export function fmtRank(tier?: string, div?: string, lp?: number) {
  if (!tier) return "Unranked";
  const t = tier[0] + tier.slice(1).toLowerCase();
  return `${t} ${div ?? ""} · ${lp ?? 0} LP`.trim();
}
