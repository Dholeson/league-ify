import { useEffect, useMemo, useState } from "react";
import type { Champion, ChampionPoolEntry, PoolTier, Role } from "../../shared/types.ts";
import { api } from "../api.ts";

const CYCLE: (PoolTier | null)[] = ["main", "secondary", "lab", null];
const TIER_CLASS: Record<PoolTier, string> = {
  main: "green",
  secondary: "accent",
  lab: "violet",
};
const ROLES: Role[] = ["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"];

export default function ChampionPicker({
  value,
  onChange,
}: {
  value: ChampionPoolEntry[];
  onChange: (pool: ChampionPoolEntry[]) => void;
}) {
  const [champions, setChampions] = useState<Champion[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .champions()
      .then((r) => setChampions(r.champions))
      .catch((e) => setErr(String(e.message)));
  }, []);

  const entryOf = (name: string) =>
    value.find((p) => p.champion.toLowerCase() === name.toLowerCase()) ?? null;

  function cycle(name: string) {
    const current = entryOf(name);
    const next = CYCLE[(CYCLE.indexOf(current?.tier ?? null) + 1) % CYCLE.length];
    const without = value.filter(
      (p) => p.champion.toLowerCase() !== name.toLowerCase()
    );
    onChange(
      next
        ? [
            ...without,
            {
              champion: name,
              tier: next,
              roles: current?.roles ?? [],
            },
          ]
        : without
    );
  }

  function toggleRole(name: string, role: Role) {
    const current = entryOf(name);
    if (!current) return;
    const roles = current.roles ?? [];
    const nextRoles = roles.includes(role)
      ? roles.filter((r) => r !== role)
      : [...roles, role];
    onChange(
      value.map((entry) =>
        entry.champion.toLowerCase() === name.toLowerCase()
          ? { ...entry, roles: nextRoles }
          : entry
      )
    );
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return champions;
    return champions.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        c.tags.some((t) => t.toLowerCase().includes(s))
    );
  }, [q, champions]);

  const selected = value
    .map((p) => ({
      ...p,
      champ: champions.find(
        (c) =>
          c.id.toLowerCase() === p.champion.toLowerCase() ||
          c.name.toLowerCase() === p.champion.toLowerCase()
      ),
    }))
    .sort((a, b) => CYCLE.indexOf(a.tier) - CYCLE.indexOf(b.tier));

  if (err) {
    return (
      <div className="muted">
        Couldn&apos;t load champion images ({err}). You can still type champion names
        manually elsewhere.
      </div>
    );
  }

  return (
    <div>
      {selected.length > 0 && (
        <div className="selected-pool">
          {selected.map((entry) => (
            <div key={entry.champion} className="selected-pool-card">
              <div className="flex wrap" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="name">{entry.champion}</div>
                  <div className="faint" style={{ fontSize: "0.75rem" }}>
                    {entry.champ?.tags.join(" · ") ?? "champion"}
                  </div>
                </div>
                <span className={`pill ${TIER_CLASS[entry.tier]}`}>{entry.tier}</span>
              </div>
              <div className="flex wrap mt" style={{ gap: 6 }}>
                {ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={`chip-toggle ${(entry.roles ?? []).includes(role) ? "on" : ""}`}
                    onClick={() => toggleRole(entry.champion, role)}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        placeholder="Search champions or class (e.g. Sett, Tank, Mage)..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div className="champ-grid">
        {filtered.map((c) => {
          const tier = entryOf(c.name)?.tier ?? null;
          return (
            <button
              key={c.id}
              className={`champ-cell ${tier ? "on " + TIER_CLASS[tier] : ""}`}
              onClick={() => cycle(c.name)}
              title={`${c.name} - ${c.title}${tier ? ` (${tier})` : ""}`}
              type="button"
            >
              <img src={c.imageUrl} alt={c.name} loading="lazy" />
              <span className="champ-name">{c.name}</span>
              {tier && (
                <span className={`champ-tier ${TIER_CLASS[tier]}`}>
                  {tier[0].toUpperCase()}
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && <span className="muted">No champions match "{q}".</span>}
      </div>
      <p className="faint" style={{ fontSize: "0.78rem", marginTop: 10 }}>
        Click to cycle: <span style={{ color: "var(--green)" }}>main</span> -{" "}
        <span style={{ color: "var(--accent)" }}>secondary</span> -{" "}
        <span style={{ color: "var(--violet)" }}>lab</span> - off. Role tags are
        multi-select and help the Coach make pool-aware block plans.
      </p>
    </div>
  );
}
