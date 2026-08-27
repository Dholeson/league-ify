import type { EnrichedMatch, RollingQuest } from "../../shared/types.ts";
import { getTemplate } from "./goals.ts";

interface RollingFamily {
  key: string;
  templateId: string;
  label: string;
  rationale: string;
  targetForStage: (stage: number) => number;
}

const FAMILIES: RollingFamily[] = [
  {
    key: "cs10",
    templateId: "cs10",
    label: "Lane Farm",
    rationale:
      "Reliable farm is the cleanest lane advantage Riot still makes universally valuable.",
    targetForStage: (stage) => Math.min(85, 70 + stage * 3),
  },
  {
    key: "gold15",
    templateId: "gold_diff_15",
    label: "Lead Conversion",
    rationale:
      "Riot's objective and map updates keep emphasizing lane priority and converting it into gold and setup.",
    targetForStage: (stage) => 250 + stage * 150,
  },
  {
    key: "deaths15",
    templateId: "deaths_before_15",
    label: "Stable Opener",
    rationale:
      "The first 10-15 minutes decide whether your champion gets to play the game on your terms.",
    targetForStage: (stage) => Math.max(0.5, 2 - stage * 0.25),
  },
  {
    key: "objectives",
    templateId: "objectives",
    label: "Objective Presence",
    rationale:
      "Riot's recent gameplay notes repeatedly center contested neutral objectives as major turning points.",
    targetForStage: (stage) => 5 + stage,
  },
  {
    key: "vision",
    templateId: "vision_per_min",
    label: "Setup Vision",
    rationale:
      "Objective fights and lane pushes are both easier when you can move first and move informed.",
    targetForStage: (stage) => +(1 + stage * 0.15).toFixed(1),
  },
  {
    key: "close",
    templateId: "close_out_time",
    label: "Close the Door",
    rationale:
      "A champion that gets ahead should help end games before the map state gets messy again.",
    targetForStage: (stage) => Math.max(24, 30 - stage),
  },
];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function pct(current: number | null, target: number, direction: "higher" | "lower") {
  if (current == null) return 0;
  if (direction === "higher") return clamp((current / target) * 100);
  if (current <= target) return 100;
  return clamp((target / current) * 100);
}

function weakOrder(
  ms: EnrichedMatch[],
  champion: string,
  state: Record<string, number>
) {
  const familyScores = FAMILIES.map((family) => {
    const tpl = getTemplate(family.templateId)!;
    const target = family.targetForStage(state[`${champion}:${family.key}`] ?? 0);
    const measurement = tpl.measure(ms, champion);
    let severity = 0;
    if (measurement.value != null) {
      severity =
        tpl.direction === "higher"
          ? Math.max(0, (target - measurement.value) / Math.max(1, target))
          : Math.max(0, (measurement.value - target) / Math.max(1, target));
    }
    return { family, tpl, measurement, target, severity };
  });
  return familyScores.sort((a, b) => b.severity - a.severity);
}

export function buildRollingQuests(
  matches: EnrichedMatch[],
  champion: string | null,
  state: Record<string, number>
): RollingQuest[] {
  if (!champion) return [];
  const scored = weakOrder(matches, champion, state).slice(0, 3);
  return scored.map(({ family, tpl, measurement, target }) => {
    const stage = state[`${champion}:${family.key}`] ?? 0;
    const id = `${champion}:${family.key}:${stage}`;
    const current = measurement.value;
    return {
      id,
      familyKey: `${champion}:${family.key}`,
      champion,
      title: `${champion}: ${family.label}`,
      description: tpl.describe(target, champion),
      current,
      target,
      unit: tpl.unit,
      direction: tpl.direction,
      pct: pct(current, target, tpl.direction),
      complete:
        current != null &&
        (tpl.direction === "higher" ? current >= target : current <= target),
      rationale: family.rationale,
      stage,
    };
  });
}
