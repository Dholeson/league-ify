import { useEffect, useState } from "react";
import type { AppConfig, ChampionPoolEntry, Role } from "../../shared/types.ts";
import { api, DemoState } from "../api.ts";
import { useToast } from "../ui.tsx";
import RolePool from "../components/RolePool.tsx";

const RANKS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const rankCap = (r: string) => r[0] + r.slice(1).toLowerCase();

export default function Settings() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [check, setCheck] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoState | null>(null);

  const [pool, setPool] = useState<ChampionPoolEntry[]>([]);
  const [primaryRole, setPrimaryRole] = useState<Role | null>(null);
  const [secondaryRole, setSecondaryRole] = useState<Role | null>(null);
  const [preferredRank, setPreferredRank] = useState<string | null>(null);
  const [saved, setSaved] = useState<string>("");
  const toast = useToast();

  const asRole = (r: unknown): Role | null =>
    r && r !== "ANY" && r !== "UNKNOWN" ? (r as Role) : null;

  useEffect(() => {
    api.config().then(setCfg);
    api.demoState().then(setDemo);
    api.profile().then((p) => {
      setPool(p.championPool);
      const pr = asRole(p.primaryRole ?? p.mainRole);
      const sr = asRole(p.secondaryRole);
      setPrimaryRole(pr);
      setSecondaryRole(sr);
      setPreferredRank(p.preferredRank ?? null);
      setSaved(JSON.stringify({ pool: p.championPool, primaryRole: pr, secondaryRole: sr, preferredRank: p.preferredRank ?? null }));
    });
  }, []);

  const dirty = saved !== JSON.stringify({ pool, primaryRole, secondaryRole, preferredRank });

  // Primary/secondary are mutually exclusive across the one role list.
  function setPrimary(role: Role) {
    setPrimaryRole((cur) => (cur === role ? null : role));
    setSecondaryRole((cur) => (cur === role ? null : cur));
  }
  function setSecondary(role: Role) {
    setSecondaryRole((cur) => (cur === role ? null : role));
    setPrimaryRole((cur) => (cur === role ? null : cur));
  }

  async function saveProfile() {
    try {
      const p = await api.updateProfile({ championPool: pool, primaryRole, secondaryRole, preferredRank });
      const pr = asRole(p.primaryRole);
      const sr = asRole(p.secondaryRole);
      setSaved(JSON.stringify({ pool: p.championPool, primaryRole: pr, secondaryRole: sr, preferredRank: p.preferredRank ?? null }));
      toast.ok("Saved. The coach uses your roles + pool for picks and champion goals.");
    } catch (e) {
      toast.err(String((e as Error).message));
    }
  }

  async function toggleDemo(on: boolean) {
    try {
      const next = on ? await api.enableDemo() : await api.disableDemo();
      setDemo(next);
      setCfg(await api.config());
      toast.ok(on ? "Demo mode on. Your real profile stayed intact." : "Back to live data.");
    } catch (e) {
      toast.err(String((e as Error).message));
    }
  }

  async function testRiot() {
    setCheck("Checking…");
    try {
      const r = await api.recentRiot();
      setCheck(`Connected · ${r.matches.length} recent ranked games`);
    } catch (e) {
      setCheck(`Failed · ${(e as Error).message}`);
    }
  }

  if (!cfg) return <div className="empty">Loading…</div>;

  return (
    <>
      {toast.node}
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Your roles and champion pool feed the coach. Connection lives up here →</div>
        </div>
        {/* Compact connection + demo indicators */}
        <div className="settings-status">
          <button
            className={`status-chip ${cfg.riotConfigured ? "ok" : "bad"}`}
            onClick={testRiot}
            title="Test Riot connection"
          >
            <span className="dot" /> Riot API
            <span className="st-sub">{cfg.riotConfigured ? "test" : "not set"}</span>
          </button>
          <label className="status-toggle" title="Demo mode uses a seeded dataset">
            <span className="st-label">Demo</span>
            <input type="checkbox" checked={cfg.demoMode} onChange={(e) => toggleDemo(e.target.checked)} />
            <span className="switch" />
          </label>
        </div>
      </div>

      {check && (
        <div className={`inline-note ${check.startsWith("Failed") ? "bad" : check.startsWith("Connected") ? "ok" : ""}`}>
          {check}
          {cfg.gameName && <span className="faint"> · {cfg.gameName}#{cfg.tagLine} · {cfg.platform}</span>}
        </div>
      )}
      {!cfg.riotConfigured && (
        <div className="inline-note bad">
          Add <code>RIOT_API_KEY</code> / <code>RIOT_GAME_NAME</code> / <code>RIOT_TAG_LINE</code> / <code>RIOT_PLATFORM</code> to <code>.env</code> and restart to auto-sync games.
        </div>
      )}

      {/* Comparison baseline — which rank the champion "vs average" numbers use */}
      <div className="card" data-nav="Comparison rank">
        <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Comparison rank</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 6 }}>
              The rank your champion stats are compared against (the "vs average" bars). Auto uses your own rank.
            </p>
          </div>
          <div className="seg rank-seg">
            <button className={!preferredRank ? "on" : ""} onClick={() => setPreferredRank(null)}>Auto</button>
            {RANKS.map((r) => (
              <button key={r} className={preferredRank === r ? "on" : ""} onClick={() => setPreferredRank(r)} title={rankCap(r)}>{rankCap(r).slice(0, 4)}</button>
            ))}
          </div>
        </div>
        {dirty && <button className="mt sm" onClick={saveProfile}>Save</button>}
      </div>

      {/* Champion pool: grid on top, five role rows below, P/S in the headers */}
      <div className="card mt" data-nav="Champion pool">
        <div className="flex" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: 0 }}>Champion pool &amp; roles</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 6 }}>
              {pool.length} champions across your roles. Drag from the grid into a role's tier; set your primary and
              secondary role on the headers.
            </p>
          </div>
          <button onClick={saveProfile} disabled={!dirty}>{dirty ? "Save" : "Saved"}</button>
        </div>
        <div className="mt">
          <RolePool
            value={pool}
            onChange={setPool}
            primaryRole={primaryRole}
            secondaryRole={secondaryRole}
            onSetPrimary={setPrimary}
            onSetSecondary={setSecondary}
          />
        </div>
      </div>
    </>
  );
}
