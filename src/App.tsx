import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { ProfileHeader, FavoriteProfile } from "../shared/types.ts";
import { api } from "./api.ts";
import { loadActive, setActiveProfile, subscribeActive } from "./active.ts";
import { loadFilter, setFilter, subscribeFilter, GAME_TYPES, FILTER_ROLES, NO_ROLE_QUEUES, roleLabel, gameTypeLabel, type GlobalFilter } from "./globalFilter.ts";
import Dashboard from "./pages/Dashboard.tsx";
import ChampionMastery from "./pages/ChampionMastery.tsx";
import Progress from "./pages/Progress.tsx";
import Achievements from "./pages/Achievements.tsx";
import Seasons from "./pages/Seasons.tsx";
import Settings from "./pages/Settings.tsx";
import Match from "./pages/Match.tsx";
import Matches from "./pages/Matches.tsx";
import Live from "./pages/Live.tsx";
import NotificationBell from "./components/NotificationBell.tsx";
import PullBanner from "./components/PullBanner.tsx";
import FloatingObjectives from "./components/FloatingObjectives.tsx";
import { drainPull } from "./pull.ts";
import { loadChampions } from "./ddragon.ts";

const splashOf = (c: string) => `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c}_0.jpg`;
const REGIONS = [
  { key: "na1", label: "NA" }, { key: "euw1", label: "EUW" }, { key: "eun1", label: "EUNE" },
  { key: "kr", label: "KR" }, { key: "br1", label: "BR" }, { key: "jp1", label: "JP" },
  { key: "oc1", label: "OCE" }, { key: "la1", label: "LAN" }, { key: "la2", label: "LAS" },
  { key: "tr1", label: "TR" }, { key: "ru", label: "RU" },
];

// ---- topbar profile menu --------------------------------------------------

function ProfileMenu({ active, setActive }: {
  active: FavoriteProfile | null;
  setActive: (a: FavoriteProfile | null) => void;
}) {
  const nav = useNavigate();
  const [self, setSelf] = useState<ProfileHeader | null>(null);
  const [favs, setFavs] = useState<FavoriteProfile[]>([]);
  const [viewed, setViewed] = useState<{ level: number | null; champ: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { api.me().then(setSelf).catch(() => {}); }, []);
  useEffect(() => { if (open || modal) api.favorites().then(setFavs).catch(() => {}); }, [open, modal]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    if (active) {
      setViewed(null);
      api.summoner(active.gameName, active.tagLine, active.platform)
        .then((p) => setViewed({ level: p.level, champ: p.recentMatches[0]?.objective.champion ?? p.champions[0]?.champion ?? null }))
        .catch(() => setViewed(null));
    } else setViewed(null);
  }, [active]);

  const cur = active
    ? { name: active.gameName, tag: active.tagLine, level: viewed?.level ?? null, champ: viewed?.champ ?? null, isSelf: false }
    : { name: self?.gameName ?? "Summoner", tag: self?.tagLine ?? "", level: self?.level ?? null, champ: self?.topChampion ?? null, isSelf: true };

  const go = (g: string, t: string, region: string) => {
    setActive({ gameName: g, tagLine: t, platform: region });
    nav("/");
    setOpen(false); setModal(false);
  };
  const toSelf = () => { setActive(null); nav("/"); setOpen(false); };

  return (
    <div className="profile-menu" ref={ref}>
      <button className="pm-anchor" onClick={() => setOpen((o) => !o)}>
        <span className="pm-av">{cur.champ ? <img src={splashOf(cur.champ)} alt="" /> : <i className="ti ti-user" aria-hidden="true" />}</span>
        <span className="pm-txt">
          <span className="pm-name">{cur.name}{cur.tag && <span className="pm-tag">#{cur.tag}</span>}</span>
          <span className="pm-meta">{cur.level != null ? `Level ${cur.level}` : cur.isSelf ? "your profile" : "scouting"}{cur.champ ? ` · ${cur.champ}` : ""}</span>
        </span>
        <i className="ti ti-chevron-down pm-chev" aria-hidden="true" />
      </button>

      {open && (
        <div className="pm-drop">
          <button className="pm-action" onClick={() => { setModal(true); setOpen(false); }}>
            <i className="ti ti-switch-horizontal" aria-hidden="true" /> Switch profile…
          </button>
          {!cur.isSelf && (
            <button className="pm-action" onClick={toSelf}>
              <i className="ti ti-home" aria-hidden="true" /> Back to your profile
            </button>
          )}
          {favs.length > 0 && (
            <div className="pm-favs">
              <div className="pm-favs-h">Favorites</div>
              {favs.map((f, i) => (
                <button key={i} className="pm-fav" onClick={() => go(f.gameName, f.tagLine, f.platform)}>
                  <i className="ti ti-star-filled" aria-hidden="true" /> {f.gameName}<span className="pm-tag">#{f.tagLine}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {modal && <SwitchModal favs={favs} defaultRegion={self?.platform ?? "na1"} onClose={() => setModal(false)} onPick={go} />}
    </div>
  );
}

function SwitchModal({ favs, defaultRegion, onClose, onPick }: {
  favs: FavoriteProfile[]; defaultRegion: string;
  onClose: () => void; onPick: (g: string, t: string, region: string) => void;
}) {
  const [region, setRegion] = useState(defaultRegion);
  const [q, setQ] = useState("");
  const searching = q.trim().length > 0;
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const m = q.trim().match(/^(.*?)\s*#\s*([A-Za-z0-9]+)$/);
    if (!m) return;
    onPick(m[1].trim(), m[2].trim(), region);
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal switch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Switch profile</h2>
          <button className="modal-x" onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
        <p className="muted" style={{ fontSize: "0.84rem", margin: "0 0 12px" }}>Look up any Riot ID. Riot needs the exact <b>Name#TAG</b>.</p>
        <form className="switch-search" onSubmit={submit}>
          <select value={region} onChange={(e) => setRegion(e.target.value)} title="Region">
            {REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <input autoFocus placeholder="Name#TAG" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          <button type="submit">Search</button>
        </form>
        {!searching && (
          <div className="switch-favs">
            <div className="mlbl" style={{ marginBottom: 6 }}>{favs.length ? "Your favorites" : "No favorites yet — star a profile to pin it here."}</div>
            {favs.map((f, i) => (
              <button key={i} className="switch-fav" onClick={() => onPick(f.gameName, f.tagLine, f.platform)}>
                <i className="ti ti-star-filled" aria-hidden="true" /> <span>{f.gameName}<span className="faint">#{f.tagLine}</span></span>
                <span className="faint" style={{ marginLeft: "auto" }}>{f.platform.toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Overview = the active profile's dashboard (yours, or a viewed profile). A
// viewed profile's games are synced on first look before the dashboard renders.
function Overview({ active }: { active: FavoriteProfile | null }) {
  const [syncing, setSyncing] = useState(false);
  const key = active ? `${active.gameName}#${active.tagLine}@${active.platform}` : "self";
  useEffect(() => {
    if (!active) return;
    setSyncing(true);
    // First look at a profile drains its season progressively behind the banner.
    drainPull({ force: true }).catch(() => {}).finally(() => setSyncing(false));
  }, [key, active]);

  if (active && syncing) {
    return (
      <div className="empty">
        <i className="ti ti-loader-2 spin" aria-hidden="true" /> Loading {active.gameName}'s games…
        <p className="faint" style={{ fontSize: "0.8rem" }}>First look at a profile pulls their recent games from Riot — a few seconds.</p>
      </div>
    );
  }
  return <Dashboard key={key} scouting={!!active} />;
}

const NAV = [
  { to: "/", icon: "ti-layout-2", label: "Overview", end: true },
  { to: "/live", icon: "ti-broadcast", label: "Live" },
  { to: "/champions", icon: "ti-sword", label: "Champions" },
  { to: "/achievements", icon: "ti-trophy", label: "Achievements" },
  { to: "/progress", icon: "ti-chart-line", label: "Report" },
  { to: "/seasons", icon: "ti-target-arrow", label: "Blocks" },
];

const CRUMB: Record<string, string> = {
  "/": "Overview",
  "/live": "Live companion",
  "/achievements": "Achievements",
  "/progress": "Report",
  "/seasons": "Blocks",
  "/settings": "Settings",
};

function isActivePath(to: string, path: string, end?: boolean) {
  return end ? path === to : path === to || path.startsWith(to + "/");
}

// Auto-discovers the current page's panels (any [data-nav] or .section-title, in
// document order) and renders them as a scroll-spy subnav under the active item.
function Subnav() {
  const loc = useLocation();
  const [items, setItems] = useState<{ label: string; el: HTMLElement }[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const main = document.querySelector(".main");
    if (!main) return;
    let current: { label: string; el: HTMLElement }[] = [];
    let lastKey = "";
    let timer: number | undefined;
    let raf = 0;

    const TOP_LINE = 130;

    // Highlight the last section whose header has scrolled up to the top line.
    const computeActive = () => {
      let idx = 0;
      current.forEach((p, i) => {
        if (p.el.getBoundingClientRect().top <= TOP_LINE) idx = i;
      });
      setActive(idx);
    };

    // Give the page enough tail room that the LAST section header can still be
    // scrolled up to the top line — otherwise short trailing sections can never
    // become active. Reset first so the measurement excludes our own padding.
    const applyTailSpace = () => {
      const el = main as HTMLElement;
      const last = current[current.length - 1]?.el;
      if (!last) return;
      el.style.paddingBottom = "0px";
      const headerAbsTop = window.scrollY + last.getBoundingClientRect().top;
      const contentAfter = document.documentElement.scrollHeight - headerAbsTop;
      // +8 so the last header clears the line outright despite sub-pixel rounding.
      const need = Math.max(0, window.innerHeight - TOP_LINE - contentAfter + 8);
      el.style.paddingBottom = `${need}px`;
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(computeActive);
    };

    const scan = () => {
      const els = Array.from(
        main.querySelectorAll<HTMLElement>("[data-nav], .section-title")
      );
      const parsed = els
        .map((el) => ({
          el,
          label: el.dataset.nav || el.querySelector("h2")?.textContent?.trim() || "",
        }))
        .filter((x) => x.label);
      const key = parsed.map((x) => x.label).join("|");
      if (key === lastKey) return;
      lastKey = key;
      current = parsed;
      setItems(parsed);
      applyTailSpace();
      computeActive();
    };

    scan();
    window.addEventListener("scroll", onScroll, { passive: true });
    const onResize = () => { applyTailSpace(); computeActive(); };
    window.addEventListener("resize", onResize, { passive: true });
    const mo = new MutationObserver(() => {
      window.clearTimeout(timer);
      // Content can grow after mount (async panels) without the section set
      // changing — re-measure tail space too, not just re-scan.
      timer = window.setTimeout(() => { scan(); applyTailSpace(); computeActive(); }, 120);
    });
    mo.observe(main, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      (main as HTMLElement).style.paddingBottom = "";
      mo.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [loc.pathname]);

  if (items.length < 2) return null;
  return (
    <div className="subnav">
      {items.map((it, i) => (
        <button
          key={i}
          className={`subnav-item ${active === i ? "on" : ""}`}
          onClick={() => it.el.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// The app-wide game-type + role selector that sits in the topbar and drives the
// dashboard/stats. Two little dropdowns; role is hidden for ARAM (no lanes).
function GlobalFilterBar({ filter }: { filter: GlobalFilter }) {
  const [open, setOpen] = useState<"queue" | "role" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const noRole = NO_ROLE_QUEUES.has(filter.queue);
  return (
    <div className="gfilter" ref={ref}>
      <div className="gf-drop">
        <button className={`gf-btn ${open === "queue" ? "on" : ""}`} onClick={() => setOpen(open === "queue" ? null : "queue")}>
          <i className="ti ti-device-gamepad-2" aria-hidden="true" /> {gameTypeLabel(filter.queue)}
          <i className="ti ti-chevron-down gf-caret" aria-hidden="true" />
        </button>
        {open === "queue" && (
          <div className="gf-menu">
            {GAME_TYPES.map((g) => (
              <button key={g.key} className={filter.queue === g.key ? "on" : ""} onClick={() => { setFilter({ queue: g.key, role: NO_ROLE_QUEUES.has(g.key) ? null : filter.role }); setOpen(null); }}>{g.label}</button>
            ))}
          </div>
        )}
      </div>
      {!noRole && (
        <div className="gf-drop">
          <button className={`gf-btn ${open === "role" ? "on" : ""}`} onClick={() => setOpen(open === "role" ? null : "role")}>
            <i className="ti ti-user-star" aria-hidden="true" /> {filter.role ? roleLabel(filter.role) : "All Roles"}
            <i className="ti ti-chevron-down gf-caret" aria-hidden="true" />
          </button>
          {open === "role" && (
            <div className="gf-menu">
              <button className={!filter.role ? "on" : ""} onClick={() => { setFilter({ ...filter, role: null }); setOpen(null); }}>All Roles</button>
              {FILTER_ROLES.map((r) => (
                <button key={r} className={filter.role === r ? "on" : ""} onClick={() => { setFilter({ ...filter, role: r }); setOpen(null); }}>{roleLabel(r)}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="gf-span" title="Scope every view to the current season or your full history.">
        {(["season", "all"] as const).map((s) => (
          <button
            key={s}
            className={(filter.span ?? "season") === s ? "on" : ""}
            onClick={() => { setFilter({ ...filter, span: s }); window.dispatchEvent(new Event("data:refresh")); }}
          >{s === "season" ? "This season" : "All time"}</button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const loc = useLocation();
  const [active, setActiveState] = useState<FavoriteProfile | null>(loadActive);
  const [filter, setFilterState] = useState<GlobalFilter>(loadFilter);
  // Champion name <-> id map; App only mounts once signed in (see ddragon.ts).
  useEffect(() => { loadChampions(); }, []);
  useEffect(() => subscribeFilter(setFilterState), []);
  // Any part of the app can switch profiles (topbar menu, a scoreboard row);
  // the shared module is the writer and notifies us so our state stays in sync.
  useEffect(() => subscribeActive(setActiveState), []);
  const setActive = (a: FavoriteProfile | null) => setActiveProfile(a);

  const activeKey = active ? `${active.gameName}#${active.tagLine}@${active.platform}` : "self";
  const here =
    CRUMB[loc.pathname] ??
    (loc.pathname.startsWith("/champions")
      ? "Champion"
      : loc.pathname === "/matches"
      ? "Matches"
      : loc.pathname.startsWith("/match")
      ? "Match detail"
      : "Overview");
  const crumbTop = active ? "Scouting" : "Solo queue";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand" title="league-ify">
          <span className="brand-mark">l</span>
          <span className="brand-word">league-ify</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => {
            const on = isActivePath(n.to, loc.pathname, n.end);
            return (
              <div key={n.to} className="nav-group">
                <NavLink to={n.to} end={n.end} className="nav-item" title={n.label}>
                  <i className={`ti ${n.icon}`} aria-hidden="true" />
                  <span className="nav-label">{n.label}</span>
                </NavLink>
                {on && <Subnav />}
              </div>
            );
          })}
          <span className="nav-spacer" />
          <NavLink to="/settings" className="nav-item" title="Settings">
            <i className="ti ti-settings" aria-hidden="true" />
            <span className="nav-label">Settings</span>
          </NavLink>
          {isActivePath("/settings", loc.pathname) && <Subnav />}
          <button
            className="nav-item"
            title="Log out"
            onClick={() => { api.logout().finally(() => window.location.reload()); }}
            style={{ background: "none", border: "none", cursor: "pointer", width: "100%", textAlign: "left", font: "inherit" }}
          >
            <i className="ti ti-logout" aria-hidden="true" />
            <span className="nav-label">Log out</span>
          </button>
        </nav>
      </aside>

      <div className="content">
        <div className="topbar">
          <div className="crumb">
            {crumbTop} <span className="sep">/</span> <span className="here">{here}</span>
          </div>
          <div className="topbar-right">
            <GlobalFilterBar filter={filter} />
            {!active && <NotificationBell />}
            <ProfileMenu active={active} setActive={setActive} />
          </div>
        </div>

        {active && (
          <div className="scout-bar">
            <span><i className="ti ti-binoculars" aria-hidden="true" /> Viewing <b>{active.gameName}</b><span className="faint">#{active.tagLine}</span>'s profile — their games, champions, and blocks.</span>
            <button className="ghost sm" onClick={() => setActive(null)}>Back to your profile</button>
          </div>
        )}

        <PullBanner />

        <main className="main" key={activeKey}>
          <Routes>
            <Route path="/" element={<Overview active={active} />} />
            <Route path="/live" element={<Live />} />
            <Route path="/champions" element={<ChampionMastery />} />
            <Route path="/champions/:champion" element={<ChampionMastery />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/match/:id" element={<Match />} />
            <Route path="/stats" element={<Navigate to="/progress" replace />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/seasons" element={<Seasons />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>

      {/* Floating Objectives panel — your active block & goals, on every page. */}
      {!active && <FloatingObjectives />}
    </div>
  );
}
