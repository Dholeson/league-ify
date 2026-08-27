import { useEffect, useState } from "react";
import type { SummonerProfile, EnrichedMatch, FavoriteProfile } from "../../shared/types.ts";
import { api } from "../api.ts";
import { roleLabel } from "../ui.tsx";

const splashUrl = (c: string) =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c}_0.jpg`;

function ChampImg({ champ }: { champ: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <i className="ti ti-shield-half" style={{ color: "#4d453a", fontSize: 16 }} aria-hidden="true" />;
  return <img src={splashUrl(champ)} alt={champ} onError={() => setOk(false)} />;
}

function cap(s: string) {
  return s ? s[0] + s.slice(1).toLowerCase() : s;
}
function procColor(p: number) {
  if (p >= 65) return "var(--green)";
  if (p >= 45) return "var(--gold)";
  return "var(--red)";
}

// The active-profile view of someone else — rendered as the Overview when a
// scouted profile is active (not a separate subpage).
export default function SummonerView({
  game, tag, platform, onExit,
}: {
  game: string;
  tag: string;
  platform?: string;
  onExit: () => void;
}) {
  const [p, setP] = useState<SummonerProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [favs, setFavs] = useState<FavoriteProfile[]>([]);

  const isFav = favs.some((f) => `${f.gameName}#${f.tagLine}`.toLowerCase() === `${game}#${tag}`.toLowerCase());
  async function toggleFav() {
    const plat = p?.platform || platform || "na1";
    setFavs(isFav ? await api.removeFavorite(game, tag) : await api.addFavorite({ gameName: game, tagLine: tag, platform: plat }));
  }

  useEffect(() => {
    if (!game || !tag) return;
    setP(null);
    setErr(null);
    api.summoner(game, tag, platform).then(setP).catch((e) => setErr(String(e.message)));
    api.favorites().then(setFavs).catch(() => {});
  }, [game, tag, platform]);

  if (err) {
    return (
      <div className="empty">
        <h2>Couldn't look up {game}#{tag}</h2>
        <p>{err}</p>
        <button className="mt" onClick={onExit}>Back to your profile</button>
      </div>
    );
  }
  if (!p) {
    return (
      <div className="empty">
        <i className="ti ti-loader-2 spin" aria-hidden="true" /> Looking up {game}#{tag}…
        <p className="faint" style={{ fontSize: "0.8rem" }}>Pulling recent games from Riot — a few seconds.</p>
      </div>
    );
  }
  if (!p.found) {
    return (
      <div className="empty">
        <h2>{game}#{tag}</h2>
        <p>{p.error ?? "No data found for this Riot ID."}</p>
        <button className="mt" onClick={onExit}>Back to your profile</button>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.gameName} <span className="tag">#{p.tagLine}</span></h1>
          <div className="sub">Scouting · {p.platform.toUpperCase()} · last {p.games} games · read-only</div>
        </div>
        <button className="ghost sm" onClick={onExit}><i className="ti ti-arrow-left" aria-hidden="true" /> Back to your profile</button>
      </div>

      {p.error && <div className="banner caution"><div className="icon"><i className="ti ti-alert-triangle" aria-hidden="true" /></div><div className="msg" style={{ color: "var(--text)" }}>{p.error}</div></div>}

      <div className="card">
        <div className="profile-head">
          <div className="pf-avatar">
            {p.recentMatches[0]?.objective.champion ? <ChampImg champ={p.recentMatches[0].objective.champion!} /> : <i className="ti ti-user" style={{ color: "#4d453a", fontSize: 22 }} aria-hidden="true" />}
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="pf-name">
              {p.gameName}<span className="tag"> #{p.tagLine}</span>
              <button className={`fav-star ${isFav ? "on" : ""}`} onClick={toggleFav} title={isFav ? "Remove from favorites" : "Favorite this profile"}>
                <i className={`ti ti-star${isFav ? "-filled" : ""}`} aria-hidden="true" />
              </button>
            </div>
            <div className="pf-sub">{p.platform.toUpperCase()}{p.level != null ? ` · Level ${p.level}` : ""} · {p.games} games · {p.winRate}% WR ({p.wins}W {p.losses}L)</div>
          </div>
          <div className="pf-rankbadge">
            <span className="rk-ic"><i className="ti ti-diamond" aria-hidden="true" /></span>
            <div>
              <div className="rk-t">{p.tier ? `${cap(p.tier)} ${p.division ?? ""}` : "Unranked"}</div>
              <div className="rk-lp">{p.leaguePoints != null ? `${p.leaguePoints} LP` : "solo queue"}</div>
            </div>
          </div>
        </div>
      </div>

      {p.statBoard.length > 0 && (
        <>
          <div className="section-title"><h2>Quick stats</h2><span className="tag">{p.aramMode ? "ARAM · last games" : "last games"}</span></div>
          <div className="statboard">{p.statBoard.map((c) => <ScoutStat key={c.id} c={c} />)}</div>
        </>
      )}

      {p.champions.length > 0 && (
        <>
          <div className="section-title"><h2>Champions</h2><span className="tag">recent form</span></div>
          <div className="card">
            {p.champions.slice(0, 8).map((c) => (
              <div className="qrow" key={c.champion} style={{ cursor: "default" }}>
                <span className={`tierbadge ${c.personalTier}`}>{c.personalTier}</span>
                <span className="champ-sq" style={{ width: 28, height: 28 }}><ChampImg champ={c.champion} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 550, fontSize: "0.9rem" }}>{c.champion}</div>
                  <div className="mlbl">{c.games} games · {c.kda} KDA · M{c.masteryLevel} {c.masteryRank}</div>
                </div>
                <span className="mn muted" style={{ width: 44, textAlign: "right", fontSize: "0.82rem" }}>{c.winRate}%</span>
                <span className="mn" style={{ width: 40, textAlign: "right", fontSize: "0.82rem", color: procColor(c.avgProcess) }}>{c.avgProcess}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title"><h2>Recent games</h2></div>
      <div className="card" style={{ padding: "6px 12px" }}>
        {p.recentMatches.map((m) => <ScoutRow key={m.id} m={m} />)}
      </div>
    </>
  );
}

function ScoutStat({ c }: { c: SummonerProfile["statBoard"][number] }) {
  const cls = c.better == null ? "flat" : c.better ? "up" : "down";
  const arrow = c.delta == null || c.delta === 0 ? "–" : c.delta > 0 ? "▲" : "▼";
  return (
    <div className="statcard" title={c.hint} style={{ cursor: "default" }}>
      <div className="sc-label">{c.label}</div>
      <div className="sc-value">
        {c.valueFmt}
        {c.delta != null && <span className={`sc-delta ${cls}`}>{arrow}{Math.abs(c.delta)}{c.unit === "%" ? "%" : ""}</span>}
      </div>
      <div className="sc-base">{c.baseline != null ? `prev ${c.baseline}${c.unit === "%" ? "%" : ""}` : "building baseline"}</div>
    </div>
  );
}

function ScoutRow({ m }: { m: EnrichedMatch }) {
  const o = m.objective;
  const k = o.kills ?? 0, dth = o.deaths ?? 0, a = o.assists ?? 0;
  const ratio = ((k + a) / Math.max(1, dth)).toFixed(1);
  return (
    <div className="match" style={{ cursor: "default" }}>
      <span className={`wl ${o.win ? "win" : "loss"}`} />
      <span className="champ-sq" style={{ width: 30, height: 30 }}>{o.champion && <ChampImg champ={o.champion} />}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex" style={{ gap: 8 }}>
          <span style={{ fontWeight: 550, fontSize: "0.9rem" }}>{o.champion ?? "Unknown"}</span>
          <span className="mlbl">{roleLabel(o)}</span>
        </div>
        <div className="flex wrap" style={{ gap: 5, marginTop: 4 }}>
          {m.tags.slice(0, 3).map((t, i) => <span className={`mtag ${t.tone}`} key={i} title={t.hint}>{t.label}</span>)}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 78 }}>
        <div className="mn kda-line" style={{ fontSize: "0.86rem" }}>
          <span className="k">{k}</span> / <span className="d">{dth}</span> / <span className="a">{a}</span>
        </div>
        <div className="kda-ratio">{ratio} KDA</div>
      </div>
      <div style={{ textAlign: "right", minWidth: 42 }} title="Performance score (0–100): how well they played, win or lose.">
        <div className="mn" style={{ fontSize: "0.9rem", color: procColor(m.process.score) }}>{m.process.score}</div>
      </div>
    </div>
  );
}
