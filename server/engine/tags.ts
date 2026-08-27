import type { Match, MatchTag } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// MATCH TAGS
//
// op.gg-style at-a-glance labels for a single game — the kind of thing you can
// scan a match list for. Derived from objective data + the self-report. Order
// matters: the most defining tag comes first. Each carries a `hint` explaining
// why it fired, surfaced on hover and spelled out on the match detail page.
// ---------------------------------------------------------------------------

export function matchTags(match: Match, process: number): MatchTag[] {
  const o = match.objective;
  const s = match.scorecard;
  const tags: MatchTag[] = [];
  const win = o.win;
  const isAram = (o.queue ?? "").toUpperCase().includes("ARAM");

  const kills = o.kills ?? 0, deaths = o.deaths ?? 0, assists = o.assists ?? 0;
  const kda =
    o.kills != null && o.deaths != null && o.assists != null
      ? (kills + assists) / Math.max(1, deaths)
      : null;
  const g15 = o.goldDiffAt15;
  const d15 = o.deathsBefore15;
  const durMin = o.durationSec ? o.durationSec / 60 : null;
  const kp = o.killParticipation;
  const dmgShare = o.teamDamageShare;

  // --- headline outcome shape (SR economy; ARAM has no lanes to lead) ---
  if (!isAram) {
    if (win && g15 != null && g15 >= 1500 && process >= 60) {
      tags.push({ label: "Stomp", tone: "good", hint: "Won with a big lead by 15 and clean play." });
    } else if (win && g15 != null && g15 <= -1200) {
      tags.push({ label: "Comeback", tone: "good", hint: "Won from behind — you were down gold at 15 and turned it." });
    } else if (!win && g15 != null && g15 >= 1200) {
      tags.push({ label: "Threw the lead", tone: "bad", hint: "Lost despite a gold lead at 15. A macro/teamfight leak, not a laning one." });
    }
  } else if (win && process >= 70) {
    tags.push({ label: "Snowball", tone: "good", hint: "Won a clean ARAM — kept the pressure on and closed it out." });
  }

  // --- your impact / carry shape ---
  if (kda != null && kda >= 5 && deaths <= 3) {
    tags.push({ label: "Hard carry", tone: "good", hint: `KDA ${kda.toFixed(1)} on ${deaths} deaths — you were the reason.` });
  }
  if (deaths === 0 && (kills + assists) >= 8) {
    tags.push({ label: "Deathless", tone: "good", hint: `${kills}/${deaths}/${assists} — never gave one up.` });
  }
  if (kills >= (isAram ? 20 : 12)) {
    tags.push({ label: "Kill hungry", tone: "good", hint: `${kills} kills — took over the fights.` });
  }
  if (dmgShare != null && dmgShare >= 0.3) {
    tags.push({ label: "Damage carry", tone: "good", hint: `${Math.round(dmgShare * 100)}% of your team's champion damage.` });
  } else if (dmgShare != null && dmgShare <= 0.12 && durMin && durMin >= 12) {
    tags.push({ label: "Low output", tone: "bad", hint: `Only ${Math.round(dmgShare * 100)}% of team damage — struggled to contribute.` });
  }
  if (kp != null && kp >= 0.65) {
    tags.push({ label: "Everywhere", tone: "good", hint: `${Math.round(kp * 100)}% kill participation — present for the fights.` });
  } else if (kp != null && kp <= 0.4 && !isAram) {
    tags.push({ label: "Absent", tone: "bad", hint: `${Math.round(kp * 100)}% kill participation — missing the map's fights.` });
  }
  if (o.soloKills != null && o.soloKills >= 2) {
    tags.push({ label: "1v1 diff", tone: "good", hint: `${o.soloKills} solo kills — you won your matchup outright.` });
  }
  if (assists >= (isAram ? 20 : 13)) {
    tags.push({ label: "Playmaker", tone: "good", hint: `${assists} assists — set the table for your team all game.` });
  }
  if (kda != null && kda >= 3 && kda < 5 && deaths <= (isAram ? 8 : 5)) {
    tags.push({ label: "Steady hand", tone: "good", hint: `KDA ${kda.toFixed(1)} — a reliable, low-risk game.` });
  }
  const dmgMin = o.damageToChampions != null && durMin ? o.damageToChampions / durMin : null;
  if (dmgMin != null && dmgMin >= (isAram ? 1200 : 900)) {
    tags.push({ label: "DPS", tone: "good", hint: `${Math.round(dmgMin)} damage/min to champions — constant output.` });
  }

  // --- laning (SR only) ---
  if (!isAram) {
    if (d15 != null && d15 === 0 && (o.csAt10 ?? 0) >= 70) {
      tags.push({ label: "Clean lane", tone: "good", hint: `0 deaths before 15 and ${o.csAt10} CS@10 — textbook.` });
    } else if (d15 != null && d15 >= 4) {
      tags.push({ label: "Fed early", tone: "bad", hint: `${d15} deaths before 15 — the game was hard from the start.` });
    }
    if (o.csAt10 != null && o.csAt10 >= 85) {
      tags.push({ label: "Farm machine", tone: "good", hint: `${o.csAt10} CS@10 — elite wave management.` });
    } else if (durMin && durMin >= 18 && o.totalCs != null && o.totalCs / durMin < 5) {
      tags.push({ label: "CS starved", tone: "bad", hint: `Under 5 CS/min — gold left on the map.` });
    }
    if (g15 != null && g15 >= 1000) {
      tags.push({ label: "Lane bully", tone: "good", hint: `+${g15} gold at 15 — you won the matchup.` });
    } else if (g15 != null && g15 <= -1200) {
      tags.push({ label: "Behind early", tone: "bad", hint: `${g15} gold at 15 — lost the lane, had to play from behind.` });
    }
  }

  // --- death quality ---
  const selfReported = match.source !== "riot";
  if (selfReported && (s.firstDeathCause === "shutdown_donation" || s.firstDeathCause === "overextension")) {
    tags.push({ label: "Hero death", tone: "bad", hint: "First death was greed/overextension — donated a shutdown." });
  }
  if (deaths >= (isAram ? 12 : 9) && durMin && deaths / (durMin / 10) >= 4) {
    tags.push({ label: "Int check", tone: "bad", hint: `${deaths} deaths — a lot of them, fast.` });
  }

  // --- objectives / vision (SR) ---
  if (!isAram) {
    if (o.visionScore != null && durMin && o.visionScore / durMin >= 1.6) {
      tags.push({ label: "Vision god", tone: "good", hint: `${(o.visionScore / durMin).toFixed(1)} vision/min.` });
    }
    const objs = (o.dragons ?? 0) + (o.heralds ?? 0) + (o.barons ?? 0);
    if (win && objs >= 6) {
      tags.push({ label: "Objective diff", tone: "good", hint: `${objs} major objectives taken.` });
    }
  }

  // --- mental (self-report only) ---
  if (selfReported) {
    if (s.flamed) {
      tags.push({ label: "Tilted", tone: "bad", hint: "You typed something you shouldn't have. It rarely helps." });
    } else if (win === false && s.tiltAfter <= 1) {
      tags.push({ label: "Ice cold", tone: "good", hint: "Lost and stayed calm — the hard part of climbing." });
    }
    if (s.doomedCollapse) {
      tags.push({ label: "4v5", tone: "neutral", hint: "Marked as a team collapse — not on you." });
    }
  }

  // --- fallbacks so no game is unlabeled ---
  if (tags.length === 0) {
    if (win) tags.push({ label: "Grind win", tone: "good", hint: "A workmanlike win. They count." });
    else tags.push({ label: "Standard loss", tone: "neutral", hint: "Nothing decisive — review for the small edges." });
  }

  return tags.slice(0, 6);
}
