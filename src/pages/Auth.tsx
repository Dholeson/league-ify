import { useState, type FormEvent, type CSSProperties } from "react";
import { api } from "../api.ts";

const REGIONS = [
  { key: "na1", label: "NA" }, { key: "euw1", label: "EUW" }, { key: "eun1", label: "EUNE" },
  { key: "kr", label: "KR" }, { key: "br1", label: "BR" }, { key: "jp1", label: "JP" },
  { key: "oc1", label: "OCE" }, { key: "la1", label: "LAN" }, { key: "la2", label: "LAS" },
  { key: "tr1", label: "TR" }, { key: "ru", label: "RU" },
];

// The login / sign-up gate. On success the session cookie is set and onAuthed()
// re-checks auth so the app renders. Sign-up also links the player's Riot ID,
// which every "self" view in the app resolves to.
export default function Auth({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("");
  const [platform, setPlatform] = useState("na1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        await api.signup({ email, password, riotGameName: gameName, riotTagLine: tagLine, platform });
      } else {
        await api.login(email, password);
      }
      onAuthed();
    } catch (err) {
      setError((err as Error).message || "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  const label: CSSProperties = { display: "block", fontSize: 12, color: "var(--muted)", margin: "0 0 4px 2px" };
  const input: CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px", marginBottom: 12,
    background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 8,
    color: "var(--text)", font: "inherit", fontSize: 14,
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg)", color: "var(--text)", padding: 16, fontFamily: "var(--font)",
    }}>
      <div style={{
        width: "100%", maxWidth: 380, background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", padding: 28, boxShadow: "var(--shadow)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 7, background: "var(--accent)", color: "var(--accent-ink)",
            display: "grid", placeItems: "center", fontWeight: 800, fontSize: 18,
          }}>l</span>
          <strong style={{ fontSize: 18 }}>league-ify</strong>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 20px 0" }}>
          {mode === "login" ? "Sign in to your campaign." : "Create an account and link your Riot ID."}
        </p>

        <form onSubmit={submit}>
          <label style={label}>Email</label>
          <input style={input} type="email" autoComplete="email" required value={email}
            onChange={(e) => setEmail(e.target.value)} />

          <label style={label}>Password</label>
          <input style={input} type="password" required minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />

          {mode === "signup" && (
            <>
              <label style={label}>Riot ID</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...input, flex: 2 }} placeholder="Game name" required value={gameName}
                  onChange={(e) => setGameName(e.target.value)} />
                <input style={{ ...input, flex: 1 }} placeholder="Tag" required value={tagLine}
                  onChange={(e) => setTagLine(e.target.value)} />
              </div>
              <label style={label}>Region</label>
              <select style={input} value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </>
          )}

          {error && (
            <div style={{
              background: "rgba(207,127,109,0.12)", border: "1px solid var(--red)", color: "var(--red)",
              borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 12,
            }}>{error}</div>
          )}

          <button type="submit" disabled={busy} style={{
            width: "100%", padding: "11px 12px", borderRadius: 8, border: "none", cursor: busy ? "default" : "pointer",
            background: "var(--accent)", color: "var(--accent-ink)", fontWeight: 700, fontSize: 14, opacity: busy ? 0.6 : 1,
          }}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
            style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", font: "inherit", padding: 0 }}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
