import { useEffect, useMemo, useState } from "react";
import type { Champion, ChampionPoolEntry, PoolTier, Role } from "../../shared/types.ts";
import { api } from "../api.ts";

const TIERS: { v: PoolTier; label: string }[] = [
  { v: "main", label: "Main" },
  { v: "secondary", label: "Backup" },
  { v: "lab", label: "Lab" },
];
const TIER_ORDER: PoolTier[] = ["main", "secondary", "lab"];

const ROLE_SLOTS: { role: Role; label: string; icon: string }[] = [
  { role: "TOP", label: "Top", icon: "ti-chevrons-up" },
  { role: "JUNGLE", label: "Jungle", icon: "ti-tree" },
  { role: "MID", label: "Mid", icon: "ti-arrows-diagonal" },
  { role: "BOT", label: "Bot", icon: "ti-crosshair" },
  { role: "SUPPORT", label: "Support", icon: "ti-heart-handshake" },
];

const CLASSES = ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"];

export default function RolePool({
  value,
  onChange,
  primaryRole,
  secondaryRole,
  onSetPrimary,
  onSetSecondary,
}: {
  value: ChampionPoolEntry[];
  onChange: (pool: ChampionPoolEntry[]) => void;
  primaryRole: Role | null;
  secondaryRole: Role | null;
  onSetPrimary: (role: Role) => void;
  onSetSecondary: (role: Role) => void;
}) {
  const [champions, setChampions] = useState<Champion[]>([]);
  const [q, setQ] = useState("");
  const [klass, setKlass] = useState<string | null>(null);
  const [drop, setDrop] = useState<string | null>(null); // "ROLE:tier" under cursor
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.champions().then((r) => setChampions(r.champions)).catch((e) => setErr(String(e.message)));
  }, []);

  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const entryOf = (name: string) => value.find((p) => same(p.champion, name)) ?? null;
  const imgOf = (name: string) =>
    champions.find((c) => same(c.id, name) || same(c.name, name))?.imageUrl ?? "";

  // Drop a champion into a role + tier. Tier is a champion-level property, so
  // this sets the tier and ensures the role is on its list (a champ can be in
  // several roles).
  function place(name: string, role: Role, tier: PoolTier) {
    const e = entryOf(name);
    if (e) {
      const roles = (e.roles ?? []).includes(role) ? e.roles ?? [] : [...(e.roles ?? []), role];
      onChange(value.map((x) => (same(x.champion, name) ? { ...x, tier, roles } : x)));
    } else {
      onChange([...value, { champion: name, tier, roles: [role] }]);
    }
  }
  function removeRole(name: string, role: Role) {
    const e = entryOf(name);
    if (!e) return;
    const roles = (e.roles ?? []).filter((r) => r !== role);
    if (roles.length === 0) onChange(value.filter((x) => !same(x.champion, name)));
    else onChange(value.map((x) => (same(x.champion, name) ? { ...x, roles } : x)));
  }

  function onDragStart(e: React.DragEvent, name: string) {
    e.dataTransfer.setData("text/plain", name);
    e.dataTransfer.effectAllowed = "copyMove";
    const img = (e.currentTarget as HTMLElement).querySelector("img");
    if (img) e.dataTransfer.setDragImage(img, 20, 20); // drag the actual champion icon
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return champions.filter(
      (c) =>
        (!klass || c.tags.includes(klass)) &&
        (!s || c.name.toLowerCase().includes(s) || c.tags.some((t) => t.toLowerCase().includes(s)))
    );
  }, [q, klass, champions]);

  if (err) return <div className="muted">Couldn&apos;t load champion images ({err}).</div>;

  return (
    <div className="rolepool">
      {/* Library on top — drag source */}
      <div className="pool-lib-controls">
        <input placeholder="Search champion or class…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="class-filter">
          <button className={!klass ? "on" : ""} onClick={() => setKlass(null)}>All</button>
          {CLASSES.map((c) => (
            <button key={c} className={klass === c ? "on" : ""} onClick={() => setKlass(klass === c ? null : c)}>{c}</button>
          ))}
        </div>
      </div>
      <div className="champ-grid pool-grid">
        {filtered.map((c) => {
          const e = entryOf(c.name);
          return (
            <div
              key={c.id}
              draggable
              onDragStart={(ev) => onDragStart(ev, c.name)}
              className={`champ-cell ${e ? "in-pool" : ""}`}
              title={`${c.name} — drag into a role below`}
            >
              <img src={c.imageUrl} alt={c.name} loading="lazy" />
              <span className="champ-name">{c.name}</span>
              {e && <span className="in-pool-dot"><i className="ti ti-check" aria-hidden="true" /></span>}
            </div>
          );
        })}
        {filtered.length === 0 && <span className="muted">No champions match.</span>}
      </div>

      <p className="faint pool-hint">
        Drag a champion down into a role's <b>Main</b>, <b>Backup</b>, or <b>Lab</b> — a champ can live in several roles, and
        the section under your cursor highlights. Click a placed icon to remove it from that role; drag it to another section
        to change its tier. Set each role's <b>Primary</b> / <b>Secondary</b> on the headers.
      </p>

      {/* Five role rows, stacked */}
      <div className="pool-roles">
        {ROLE_SLOTS.map(({ role, label, icon }) => {
          const count = value.filter((e) => (e.roles ?? []).includes(role)).length;
          return (
            <div key={role} className="pool-role">
              <div className="pr-head">
                <i className={`ti ${icon}`} aria-hidden="true" />
                <span className="pr-name">{label}</span>
                <span className="pr-count">{count}</span>
                <span className="pr-spacer" />
                <button
                  type="button"
                  className={`ps-btn p ${primaryRole === role ? "on" : ""}`}
                  onClick={() => onSetPrimary(role)}
                  title="Set as your primary role"
                >Primary</button>
                <button
                  type="button"
                  className={`ps-btn s ${secondaryRole === role ? "on" : ""}`}
                  onClick={() => onSetSecondary(role)}
                  title="Set as your secondary role"
                >Secondary</button>
              </div>
              <div className="pr-tiers">
                {TIERS.map(({ v: tier, label: tlabel }) => {
                  const champs = value.filter((e) => (e.roles ?? []).includes(role) && e.tier === tier);
                  const key = `${role}:${tier}`;
                  return (
                    <div
                      key={tier}
                      className={`pr-tier ${tier} ${drop === key ? "drop" : ""}`}
                      onDragOver={(e) => { e.preventDefault(); setDrop(key); }}
                      onDragLeave={() => setDrop((d) => (d === key ? null : d))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const name = e.dataTransfer.getData("text/plain");
                        if (name) place(name, role, tier);
                        setDrop(null);
                      }}
                    >
                      <div className="prt-h">{tlabel}<span>{champs.length || ""}</span></div>
                      <div className="prt-champs">
                        {champs.length === 0 ? (
                          <span className="prt-empty">drop here</span>
                        ) : (
                          champs.map((e) => (
                            <div
                              key={e.champion}
                              className={`pool-champ ${tier}`}
                              draggable
                              onDragStart={(ev) => onDragStart(ev, e.champion)}
                              onClick={() => removeRole(e.champion, role)}
                              title={`${e.champion} · ${tier === "secondary" ? "backup" : tier} — click to remove from ${role.toLowerCase()}`}
                            >
                              {imgOf(e.champion) ? <img src={imgOf(e.champion)} alt={e.champion} /> : <i className="ti ti-shield-half" />}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
