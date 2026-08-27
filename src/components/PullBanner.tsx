import { useEffect, useState } from "react";
import { subscribePull, type PullState } from "../pull.ts";

// Thin top banner shown while the season's games are still draining in behind
// the scenes. Recent games are already usable; this just says the full picture
// is still filling in.
export default function PullBanner() {
  const [s, setS] = useState<PullState>({ active: false, remaining: 0, added: 0, rateLimited: false });
  useEffect(() => subscribePull(setS), []);
  if (!s.active || s.remaining <= 0) return null;
  return (
    <div className={`pull-banner ${s.rateLimited ? "waiting" : ""}`}>
      <i className={`ti ${s.rateLimited ? "ti-hourglass-high" : "ti-loader-2 spin"}`} aria-hidden="true" />
      <span>
        {s.rateLimited
          ? <>Riot rate limit hit — pausing, then resuming automatically. <b>{s.remaining}</b> games still to pull.</>
          : <>Pulling your match history in the background — <b>{s.remaining}</b> to go. Games appear as they arrive; you can keep using the app.</>}
      </span>
    </div>
  );
}
