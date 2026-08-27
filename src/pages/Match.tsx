import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import type {
  EnrichedMatch, ProcessWeights, MatchScoreboard, MatchHighlight, StatComparison,
  ScoreboardPlayer, MatchTimeline, ProfileHeader, MatchAnalysis, DraftEval,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { setActiveProfile } from "../active.ts";
import { VERDICT_LABEL, roleLabel } from "../ui.tsx";

const splashUrl = (c: string) =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c}_0.jpg`;
const squareUrl = (v: string, c: string) =>
  `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${c}.png`;
const itemIcon = (v: string, id: number) =>
  `https://ddragon.leagueoflegends.com/cdn/${v}/img/item/${id}.png`;

// Numeric summoner-spell id -> Data Dragon key (icon is key + ".png").
const SPELL_KEY: Record<number, string> = {
  1: "SummonerBoost", 3: "SummonerExhaust", 4: "SummonerFlash", 6: "SummonerHaste",
  7: "SummonerHeal", 11: "SummonerSmite", 12: "SummonerTeleport", 13: "SummonerMana",
  14: "SummonerDot", 21: "SummonerBarrier", 30: "SummonerPoroRecall", 31: "SummonerPoroThrow",
  32: "SummonerSnowball", 39: "SummonerSnowURFSnowball_Mark", 54: "Summoner_UltBookPlaceholder",
};
const spellIcon = (v: string, id: number) =>
  SPELL_KEY[id] ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/spell/${SPELL_KEY[id]}.png` : null;

const SUBMETRIC_LABEL: Record<keyof ProcessWeights, string> = {
  earlyStability: "Early stability",
  deathDiscipline: "Death discipline",
  objectiveMacro: "Objective macro",
  teamfight: "Teamfight",
  mental: "Mental",
  review: "Review",
};

function procColor(p: number) {
  if (p >= 65) return "var(--green)";
  if (p >= 45) return "var(--gold)";
  return "var(--red)";
}
function fmtSec(sec: number | null | undefined) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, "0")}`;
}
function signed(n: number) { return `${n >= 0 ? "+" : ""}${n}`; }

// Scoreboard-relative standouts for the top bar: where you ranked among the ten
// players. Pure client-side — the full board is already loaded here.
function highlightsFrom(sb: MatchScoreboard): MatchHighlight[] {
  const me = sb.players.find((p) => p.isMe);
  if (!me) return [];
  const team = sb.players.filter((p) => p.team === me.team);
  const all = sb.players;
  const kdaOf = (p: ScoreboardPlayer) => (p.kills + p.assists) / Math.max(1, p.deaths);
  const max = (arr: ScoreboardPlayer[], f: (p: ScoreboardPlayer) => number) => Math.max(...arr.map(f));
  const out: MatchHighlight[] = [];

  if (me.kills > 0 && me.kills === max(all, (p) => p.kills))
    out.push({ label: "Most kills", tone: "good", hint: `${me.kills} kills — most in the game.` });
  if (me.damage === max(all, (p) => p.damage))
    out.push({ label: "Highest damage", tone: "good", hint: `${Math.round(me.damage / 1000)}k — most damage of anyone in the game.` });
  else if (me.damage === max(team, (p) => p.damage))
    out.push({ label: "Team's top damage", tone: "good", hint: `${Math.round(me.damage / 1000)}k — most on your team.` });
  if (kdaOf(me) === max(team, kdaOf) && me.deaths <= 4 && me.kills + me.assists >= 5)
    out.push({ label: "Team MVP", tone: "good", hint: `Best KDA on your team (${me.kills}/${me.deaths}/${me.assists}).` });
  if (me.deaths === 0)
    out.push({ label: "Deathless", tone: "good", hint: "Never gave up a kill." });
  if (me.gold === max(team, (p) => p.gold))
    out.push({ label: "Bag secured", tone: "good", hint: `${Math.round(me.gold / 1000)}k gold — most on your team.` });
  if (me.deaths >= 9 && me.deaths === max(all, (p) => p.deaths))
    out.push({ label: "Fed the enemy", tone: "bad", hint: `${me.deaths} deaths — most in the game.` });

  return out.slice(0, 4);
}

function CompRow({ c }: { c: StatComparison }) {
  const fmt = (v: number) =>
    c.key === "gold15" ? `${v >= 0 ? "+" : ""}${Math.round(v)}`
    : c.unit === "%" ? `${Math.round(v)}%`
    : `${v}`;
  return (
    <div className="comp-row">
      <div className="comp-head">
        <span className="comp-label">{c.label}</span>
        <span className="comp-val mn">
          {c.value != null ? fmt(c.value) : "—"} <span className="comp-bench">vs {fmt(c.benchmark)}</span>
        </span>
      </div>
      <div className="comp-bar" title={`You: ${c.value != null ? fmt(c.value) : "—"} · benchmark: ${fmt(c.benchmark)}`}>
        <div className={`comp-fill ${c.better ? "good" : "bad"}`} style={{ width: `${c.pct}%` }} />
        <span className="comp-mid" />
      </div>
    </div>
  );
}

// Compact build: summoner spells, runes (keystone + secondary path), items.
function PlayerBuild({ p, version, size = 20 }: { p: ScoreboardPlayer; version: string; size?: number }) {
  const box = { width: size, height: size } as const;
  return (
    <div className="pbuild">
      <div className="pb-group">
        {p.spells.map((s, i) => {
          const u = spellIcon(version, s);
          return u ? <img key={i} src={u} alt="" style={box} /> : <span key={i} className="pb-empty" style={box} />;
        })}
      </div>
      <div className="pb-group pb-runes">
        {p.keystoneIcon ? <img src={p.keystoneIcon} alt="" style={box} /> : <span className="pb-empty" style={box} />}
        {p.secondaryStyleIcon && <img src={p.secondaryStyleIcon} alt="" className="pb-secondary" style={{ width: size * 0.72, height: size * 0.72 }} />}
      </div>
      <div className="pb-group pb-items">
        {p.items.map((it, i) => <img key={i} src={itemIcon(version, it)} alt="" style={box} />)}
        {Array.from({ length: Math.max(0, 6 - p.items.length) }).map((_, i) => <span key={`e${i}`} className="pb-empty" style={box} />)}
        {p.trinket > 0 && <img className="pb-trinket" src={itemIcon(version, p.trinket)} alt="" style={box} />}
      </div>
    </div>
  );
}

function Scoreboard({ sb, self }: { sb: MatchScoreboard; self: ProfileHeader | null }) {
  const nav = useNavigate();
  const me = sb.players.find((p) => p.isMe);
  const myTeam = me?.team ?? "BLUE";
  const order: ("BLUE" | "RED")[] = [myTeam, myTeam === "BLUE" ? "RED" : "BLUE"];
  const dur = sb.durationSec / 60;

  const isSelf = (p: ScoreboardPlayer) =>
    !!self && p.name.toLowerCase() === (self.gameName ?? "").toLowerCase() && p.tagLine.toLowerCase() === (self.tagLine ?? "").toLowerCase();

  // Clicking a name makes that player the active profile across the app.
  function switchTo(p: ScoreboardPlayer) {
    if (!p.name) return;
    if (isSelf(p)) setActiveProfile(null);
    else setActiveProfile({ gameName: p.name, tagLine: p.tagLine, platform: sb.platform });
    nav("/");
  }

  return (
    <>
      <div className="section-title"><h2>Scoreboard</h2><span className="tag">click a name to scout them · click a champ for its page</span></div>
      <div className="scoreboard">
        {order.map((team) => {
          const players = sb.players.filter((p) => p.team === team);
          const win = players[0]?.win ?? false;
          const mine = team === myTeam;
          return (
            <div key={team} className={`sb-team ${win ? "win" : "loss"}`}>
              <div className="sb-team-head">
                <span className={win ? "wtxt" : "ltxt"}>{win ? "Victory" : "Defeat"}</span>
                <span className="mlbl">{mine ? "Your team" : "Enemy team"}</span>
              </div>
              {players.map((p, i) => (
                <div key={i} className={`sb-row ${p.isMe ? "me" : ""}`}>
                  <Link to={`/champions/${p.champion}`} className="sb-champ" title={`${p.champion} page`}>
                    {p.champion && <img src={splashUrl(p.champion)} alt={p.champion} />}
                    <span className="sb-lvl">{p.level}</span>
                  </Link>
                  <div className="sb-id">
                    <button className="sb-name-btn" onClick={() => switchTo(p)} title={p.isMe ? "You" : `Scout ${p.name}`}>
                      {p.name || p.champion}{p.isMe && <span className="sb-you">YOU</span>}
                    </button>
                    <Link to={`/champions/${p.champion}`} className="mlbl sb-champlink">{p.champion}</Link>
                  </div>
                  <PlayerBuild p={p} version={sb.version} />
                  <div className="sb-kda mn"><span className="k">{p.kills}</span>/<span className="d">{p.deaths}</span>/<span className="a">{p.assists}</span></div>
                  <div className="sb-cell"><div className="mn">{Math.round(p.damage / 1000)}k</div><div className="sb-cl">dmg</div></div>
                  <div className="sb-cell"><div className="mn">{p.cs}</div><div className="sb-cl">{dur ? (p.cs / dur).toFixed(1) : "—"} cs/m</div></div>
                  <div className="sb-cell"><div className="mn">{Math.round(p.gold / 1000)}k</div><div className="sb-cl">gold</div></div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- team analysis: one metric at a time, big mirrored bars ---------------
const TA_METRICS: { key: keyof ScoreboardPlayer; label: string; title: string }[] = [
  { key: "kills", label: "Kills", title: "Champion kills" },
  { key: "gold", label: "Gold", title: "Gold earned" },
  { key: "damage", label: "Damage", title: "Damage to champions" },
  { key: "damageTaken", label: "Taken", title: "Damage taken" },
  { key: "cs", label: "CS", title: "Creep score" },
  { key: "wards", label: "Wards", title: "Wards placed" },
];

function fmtStat(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function TeamAnalysis({ sb, version }: { sb: MatchScoreboard; version: string }) {
  const [metricKey, setMetricKey] = useState<keyof ScoreboardPlayer>("kills");
  const me = sb.players.find((p) => p.isMe);
  const myTeam = me?.team ?? "BLUE";
  const blue = sb.players.filter((p) => p.team === myTeam);
  const red = sb.players.filter((p) => p.team !== myTeam);

  // Only offer metrics that actually have data (ARAM has no wards).
  const avail = TA_METRICS.filter((m) => sb.players.some((p) => (p[m.key] as number) > 0));
  const active = avail.find((m) => m.key === metricKey) ?? avail[0];
  if (!active) return null;

  const val = (p: ScoreboardPlayer) => (p[active.key] as number) ?? 0;
  const blueTotal = blue.reduce((a, p) => a + val(p), 0);
  const redTotal = red.reduce((a, p) => a + val(p), 0);
  const peak = Math.max(1, ...sb.players.map(val));
  const rowFor = (p: ScoreboardPlayer, side: "blue" | "red") => (
    <div className={`ta-row ${side} ${p.isMe ? "me" : ""}`} key={p.name + p.champion}>
      <img src={squareUrl(version, p.champion)} alt={p.champion} className="ta-champ" title={p.name || p.champion} />
      <div className="ta-bar-wrap"><div className="ta-bar" style={{ width: `${(val(p) / peak) * 100}%` }} /></div>
      <span className="ta-val mn">{fmtStat(val(p))}</span>
    </div>
  );

  return (
    <div className="card">
      <div className="flex" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Team analysis</h2>
        <div className="seg">
          {avail.map((m) => (
            <button key={m.key as string} className={active.key === m.key ? "on" : ""} onClick={() => setMetricKey(m.key)}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className="ta-head">
        <span className="ta-total blue mn">{fmtStat(blueTotal)}</span>
        <span className="ta-title">{active.title}</span>
        <span className="ta-total red mn">{fmtStat(redTotal)}</span>
      </div>
      <div className="ta-cols">
        <div className="ta-side">{blue.map((p) => rowFor(p, "blue"))}</div>
        <div className="ta-side right">{red.map((p) => rowFor(p, "red"))}</div>
      </div>
    </div>
  );
}

// ---- over-time graphs: gold / xp / cs per champion ------------------------
const TL_METRICS = [
  { key: "gold" as const, label: "Gold" },
  { key: "xp" as const, label: "Experience" },
  { key: "cs" as const, label: "CS" },
];
const BLUE_SHADES = ["#6f93a3", "#7fa8c9", "#5b8bd0", "#8bb0d0", "#4d7fb0"];
const RED_SHADES = ["#cf7f6d", "#d69a8e", "#c46a72", "#e0a090", "#b85c66"];

function TimelineGraph({ tl, version }: { tl: MatchTimeline; version: string }) {
  const [metric, setMetric] = useState<"gold" | "xp" | "cs">("gold");
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const me = tl.participants.find((p) => p.isMe);
  const myTeam = me?.team ?? "BLUE";

  // Stable per-participant colour, independent of which lines are toggled off.
  const lineProps = useMemo(() => {
    let bi = 0, ri = 0;
    return tl.participants.map((pt) => {
      const mine = pt.team === myTeam;
      const color = pt.isMe ? "#d6a24e" : mine ? BLUE_SHADES[bi++ % BLUE_SHADES.length] : RED_SHADES[ri++ % RED_SHADES.length];
      return { color, width: pt.isMe ? 3 : 1.6, name: pt.champion };
    });
  }, [tl, myTeam]);

  const data = useMemo(
    () => tl.frames.map((f) => {
      const row: Record<string, number> = { minute: f.minute };
      tl.participants.forEach((_, i) => { row[`p${i}`] = f[metric][i] ?? 0; });
      return row;
    }),
    [tl, metric]
  );

  const toggle = (i: number) =>
    setHidden((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  const idxOf = (team: "mine" | "theirs") =>
    tl.participants.map((_, i) => i).filter((i) => (tl.participants[i].team === myTeam) === (team === "mine"));

  const chip = (i: number) => {
    const pt = tl.participants[i];
    const off = hidden.has(i);
    return (
      <button key={i} className={`tl-chip ${off ? "off" : ""}`} style={{ ["--c" as any]: lineProps[i].color }} onClick={() => toggle(i)} title={`${off ? "Show" : "Hide"} ${pt.champion}`}>
        <img src={squareUrl(version, pt.champion)} alt={pt.champion} />
      </button>
    );
  };

  return (
    <div className="card">
      <div className="flex" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Over time</h2>
        <div className="seg">
          {TL_METRICS.map((mtr) => (
            <button key={mtr.key} className={metric === mtr.key ? "on" : ""} onClick={() => setMetric(mtr.key)}>{mtr.label}</button>
          ))}
        </div>
      </div>
      <div className="tl-toggles">
        <div className="tl-team"><span className="tl-team-lbl blue">Your team</span><div className="tl-chips">{idxOf("mine").map(chip)}</div></div>
        <div className="tl-team"><span className="tl-team-lbl red">Enemy</span><div className="tl-chips">{idxOf("theirs").map(chip)}</div></div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 18, left: 4, bottom: 20 }}>
          <CartesianGrid stroke="#2b2b31" strokeDasharray="3 3" />
          <XAxis dataKey="minute" stroke="#6d6c66" fontSize={12} tickFormatter={(m) => `${m}m`} />
          <YAxis stroke="#6d6c66" fontSize={12} width={44} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)} />
          <Tooltip contentStyle={{ background: "#202024", border: "1px solid #3a3a42", borderRadius: 8, fontFamily: "var(--mono)", fontSize: 12 }} labelFormatter={(m) => `${m} min`} />
          {tl.participants.map((_, i) =>
            hidden.has(i) ? null : (
              <Line key={i} type="monotone" dataKey={`p${i}`} stroke={lineProps[i].color} strokeWidth={lineProps[i].width} dot={false} name={lineProps[i].name} isAnimationActive={false} />
            )
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DraftBar({ label, d, tone }: { label: string; d: DraftEval; tone: "blue" | "red" }) {
  return (
    <div className="draft-row">
      <div className="draft-top">
        <span className="draft-label">{label}</span>
        <span className="draft-score mn">{d.score}<span className="draft-vl"> · {d.label}</span></span>
      </div>
      <div className="bar"><div style={{ width: `${d.score}%`, background: tone === "blue" ? "var(--accent)" : "var(--red)" }} /></div>
      <ul className="bda-notes sm">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
    </div>
  );
}

function BuildDraftAnalysis({ a }: { a: MatchAnalysis }) {
  return (
    <>
      <div className="section-title"><h2>Build &amp; draft analysis</h2><span className="tag">graded vs standard builds + the enemy comp{a.generatedBy === "llm" ? " · scouted by Claude" : ""}</span></div>
      <div className="grid cols-2 bda">
        <div className="card">
          <div className="bda-build-head">
            <div className="bda-score mn" style={{ color: procColor(a.buildScore) }}>{a.buildScore}</div>
            <div>
              <div className="bda-verdict">{a.buildVerdict}</div>
              <div className="mlbl">your build score (0–100)</div>
            </div>
          </div>
          <ul className="bda-notes">{a.buildNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
        <div className="card">
          <h3 className="bda-h"><i className="ti ti-sitemap" aria-hidden="true" /> Draft score</h3>
          <DraftBar label="Your team" d={a.myTeam} tone="blue" />
          <DraftBar label="Enemy team" d={a.enemyTeam} tone="red" />
          <p className="bda-matchup"><i className="ti ti-swords" aria-hidden="true" /> {a.matchup}</p>
        </div>
      </div>
    </>
  );
}

export default function Match() {
  const { id = "" } = useParams();
  const [m, setM] = useState<EnrichedMatch | null>(null);
  const [sb, setSb] = useState<MatchScoreboard | null>(null);
  const [tl, setTl] = useState<MatchTimeline | null>(null);
  const [self, setSelf] = useState<ProfileHeader | null>(null);
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setM(null); setSb(null); setTl(null); setAnalysis(null); setErr(null);
    api.matchDetail(id).then(setM).catch((e) => setErr(String(e.message)));
    api.matchScoreboard(id).then(setSb).catch(() => {});
    api.matchTimeline(id).then(setTl).catch(() => {});
    api.matchAnalysis(id).then(setAnalysis).catch(() => {});
    api.me().then(setSelf).catch(() => {});
  }, [id]);

  if (err) return <div className="empty"><h2>Couldn't load the match</h2><p>{err}</p><Link to="/">Back</Link></div>;
  if (!m) return <div className="empty"><i className="ti ti-loader-2 spin" aria-hidden="true" /> Loading match…</div>;

  const o = m.objective;
  const isAram = (o.queue ?? "").toUpperCase().includes("ARAM");
  const k = o.kills ?? 0, d = o.deaths ?? 0, a = o.assists ?? 0;
  const kda = ((k + a) / Math.max(1, d)).toFixed(2);
  const durMin = o.durationSec ? Math.round(o.durationSec / 60) : null;
  const csMin = o.totalCs != null && durMin ? (o.totalCs / durMin).toFixed(1) : null;
  const dmgMin = o.damageToChampions != null && durMin ? Math.round(o.damageToChampions / durMin) : null;

  // ARAM has no lanes, no CS@10 vs a lane opponent, no gold@15, and deaths are
  // expected — so we swap the stat line for the things that actually read a
  // Howling Abyss game: teamfight output, damage share, and participation.
  const stats: { label: string; value: string; hint?: string }[] = isAram
    ? [
        { label: "KDA", value: kda, hint: `${k}/${d}/${a}` },
        { label: "Kill part.", value: o.killParticipation != null ? `${Math.round(o.killParticipation * 100)}%` : "—" },
        { label: "Damage", value: o.damageToChampions != null ? `${Math.round(o.damageToChampions / 1000)}k` : "—", hint: dmgMin ? `${dmgMin}/min` : undefined },
        { label: "Dmg share", value: o.teamDamageShare != null ? `${Math.round(o.teamDamageShare * 100)}%` : "—", hint: "of team" },
        { label: "CS / min", value: csMin ?? "—", hint: o.totalCs != null ? `${o.totalCs} total` : undefined },
        { label: "Kills", value: `${k}`, hint: "champion takedowns" },
      ]
    : [
        { label: "CS @ 10", value: o.csAt10 != null ? `${o.csAt10}` : "—" },
        { label: "CS / min", value: csMin ?? "—", hint: o.totalCs != null ? `${o.totalCs} total` : undefined },
        { label: "Gold @ 15", value: o.goldDiffAt15 != null ? signed(o.goldDiffAt15) : "—", hint: "vs lane opp" },
        { label: "Kill part.", value: o.killParticipation != null ? `${Math.round(o.killParticipation * 100)}%` : "—" },
        { label: "Damage", value: o.damageToChampions != null ? `${Math.round(o.damageToChampions / 1000)}k` : "—", hint: dmgMin ? `${dmgMin}/min` : undefined },
        { label: "Vision", value: o.visionScore != null ? `${o.visionScore}` : "—", hint: durMin && o.visionScore != null ? `${(o.visionScore / durMin).toFixed(1)}/min` : undefined },
        { label: "Solo kills", value: o.soloKills != null ? `${o.soloKills}` : "—" },
        { label: "Deaths < 15", value: o.deathsBefore15 != null ? `${o.deathsBefore15}` : "—" },
        { label: "First death", value: fmtSec(o.firstDeathSec), hint: "timestamp" },
      ];

  const highlights = sb?.found ? highlightsFrom(sb) : [];
  const mine = sb?.found ? sb.players.find((p) => p.isMe) ?? null : null;
  const comparison = m.comparison ?? [];
  const good = comparison.filter((c) => c.better);
  const bad = comparison.filter((c) => !c.better);

  // Howling Abyss has no dragons/heralds/barons/grubs — only towers — so an ARAM
  // game shouldn't parade five zeroed-out neutral objectives.
  const objs = (isAram
    ? [{ label: "Towers", v: o.towers }]
    : [
        { label: "Dragons", v: o.dragons }, { label: "Heralds", v: o.heralds },
        { label: "Barons", v: o.barons }, { label: "Towers", v: o.towers }, { label: "Grubs", v: o.voidgrubs },
      ]
  ).filter((x) => x.v != null);

  const subs = Object.entries(m.process.subMetrics) as [keyof ProcessWeights, number][];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{o.champion ?? "Match"} <span className={`verdict ${m.verdict}`} style={{ fontSize: "1rem" }}>{VERDICT_LABEL[m.verdict]}</span></h1>
          <div className="sub">
            {roleLabel(o)} · {durMin ? `${durMin} min` : ""} · {new Date(m.playedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
        <Link to="/"><button className="ghost sm">Back</button></Link>
      </div>

      {/* Result banner */}
      <div className={`card match-hero ${o.win ? "win" : "loss"}`}>
        <span className="mh-splash">{o.champion && <img src={splashUrl(o.champion)} alt={o.champion} />}</span>
        <div className="mh-mid">
          <div className={`mh-result ${o.win ? "win" : "loss"}`}>{o.win ? "Victory" : "Defeat"}</div>
          <div className="mh-kda mn"><span className="k">{k}</span> / <span className="d">{d}</span> / <span className="a">{a}</span> <span className="mh-ratio">{kda} KDA</span></div>
          {o.opponentChampion && <div className="mlbl">vs {o.opponentChampion}{o.goldDiffAt15 != null ? ` · ${signed(o.goldDiffAt15)} gold@15` : ""}</div>}
          {highlights.length > 0 && (
            <div className="mh-highlights">
              {highlights.map((h, i) => (
                <span className={`hl-chip ${h.tone}`} key={i} title={h.hint}>
                  <i className={`ti ti-${h.tone === "bad" ? "alert-triangle" : "star-filled"}`} aria-hidden="true" /> {h.label}
                </span>
              ))}
            </div>
          )}
        </div>
        {mine && (
          <div className="mh-build">
            <span className="mh-build-lbl">Your build</span>
            <PlayerBuild p={mine} version={sb!.version} size={26} />
          </div>
        )}
        <div className="mh-score">
          <div className="mhs-v" style={{ color: procColor(m.process.score) }}>{m.process.score}</div>
          <div className="mlbl">performance</div>
          {o.lpDelta != null && <div className="mn" style={{ color: o.lpDelta >= 0 ? "var(--green)" : "var(--red)" }}>{signed(o.lpDelta)} LP</div>}
        </div>
      </div>

      {m.tags.length > 0 && (
        <>
          <div className="section-title"><h2>What stood out</h2><span className="tag">the shape of this game, in plain terms</span></div>
          <div className="card tag-explain">
            {m.tags.map((t, i) => (
              <div className="tagx-row" key={i}>
                <span className={`mtag ${t.tone}`}>{t.label}</span>
                <span className="tagx-hint">{t.hint}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {sb?.found && <Scoreboard sb={sb} self={self} />}

      {(sb?.found || tl?.found) && (
        <div className={sb?.found && tl?.found ? "graphs-2col mt-lg" : "mt-lg"}>
          {sb?.found && <TeamAnalysis sb={sb} version={sb.version} />}
          {tl?.found && <TimelineGraph tl={tl} version={tl.version || sb?.version || ""} />}
        </div>
      )}

      {analysis?.found ? (
        <BuildDraftAnalysis a={analysis} />
      ) : sb?.found && !analysis ? (
        <div className="card muted mt-lg" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <i className="ti ti-loader-2 spin" aria-hidden="true" /> Grading your build and both drafts…
        </div>
      ) : null}

      <div className="section-title"><h2>Your stat line</h2><span className="tag">split by what carried vs what leaked · vs {m.comparisonRank ?? "average"}</span></div>
      {comparison.length > 0 ? (
        <div className="grid cols-2 statline-split">
          <div className="card scout-col good">
            <h3><i className="ti ti-thumb-up" aria-hidden="true" /> What went well</h3>
            {good.length ? good.map((c) => <CompRow key={c.key} c={c} />) : <p className="muted" style={{ fontSize: "0.85rem" }}>Nothing beat the benchmark this game — it happens.</p>}
          </div>
          <div className="card scout-col bad">
            <h3><i className="ti ti-tool" aria-hidden="true" /> What needs work</h3>
            {bad.length ? bad.map((c) => <CompRow key={c.key} c={c} />) : <p className="muted" style={{ fontSize: "0.85rem" }}>Clean line — everything at or above the benchmark.</p>}
          </div>
        </div>
      ) : (
        <div className="statboard">
          {stats.map((s) => (
            <div className="statcard" key={s.label} style={{ cursor: "default" }}>
              <div className="sc-label">{s.label}</div>
              <div className="sc-value">{s.value}</div>
              {s.hint && <div className="sc-base">{s.hint}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="grid cols-2 mt-lg">
        <div className="card">
          <h2>Performance breakdown</h2>
          <p className="muted" style={{ fontSize: "0.83rem" }}>How this game scored across the process sub-metrics (0–100).</p>
          {subs.length === 0 ? <p className="muted">No sub-metric data.</p> : subs.map(([key, val]) => (
            <div className="row" key={key} style={{ borderBottom: "none", padding: "6px 0" }}>
              <div style={{ width: 140 }} className="name">{SUBMETRIC_LABEL[key] ?? key}</div>
              <div style={{ flex: 1 }} className="bar"><div style={{ width: `${Math.round(val * 100)}%`, background: procColor(val * 100) }} /></div>
              <span className="mn" style={{ width: 40, textAlign: "right" }}>{Math.round(val * 100)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Objectives &amp; context</h2>
          {isAram && (
            <p className="muted" style={{ fontSize: "0.83rem" }}>
              Howling Abyss has no neutral objectives — the map is one lane and two Nexus turrets.
            </p>
          )}
          {objs.length > 0 && (
            <div className="grid cols-3" style={{ marginTop: 6 }}>
              {objs.map((x) => (
                <div className="card stat" key={x.label}>
                  <span className="label">{x.label}</span>
                  <span className="value">{x.v}</span>
                </div>
              ))}
            </div>
          )}
          {o.champion && (
            <Link to={`/champions/${o.champion}`} className="viewmore-btn" style={{ marginTop: 14 }}>
              View {o.champion} mastery →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
