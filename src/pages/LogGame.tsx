import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AppConfig,
  Scorecard,
  ObjectiveData,
  EnrichedMatch,
  DeathCause,
  SelfGrade,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { FlagBanner, Verdict, DEATH_CAUSE_LABEL, useToast } from "../ui.tsx";

const GRADES: SelfGrade[] = ["A", "B", "C", "D", "F"];
const DEATH_CAUSES = Object.keys(DEATH_CAUSE_LABEL) as DeathCause[];

const EMPTY_CARD: Scorecard = {
  grade: "C",
  tiltBefore: 0,
  tiltAfter: 0,
  biggestMistake: "",
  firstDeathCause: null,
  bestDecision: "",
  oneAdjustment: "",
  doomedCollapse: false,
  flamed: false,
  mutedAppropriately: true,
  reviewed: true,
};

type Source = "latest" | "specific" | "manual";

export default function LogGame() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [source, setSource] = useState<Source>("manual");
  const [recent, setRecent] = useState<{ matchId: string; alreadyLogged: boolean }[]>([]);
  const [specificId, setSpecificId] = useState<string>("");

  const [card, setCard] = useState<Scorecard>(EMPTY_CARD);
  const [obj, setObj] = useState<Partial<ObjectiveData>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ match: EnrichedMatch; warnings: string[] } | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.config().then((c) => {
      setConfig(c);
      if (c.riotConfigured) {
        setSource("latest");
        api
          .recentRiot()
          .then((r) => {
            setRecent(r.matches);
            const firstUnlogged = r.matches.find((m) => !m.alreadyLogged);
            if (firstUnlogged) setSpecificId(firstUnlogged.matchId);
          })
          .catch(() => {});
      }
    });
  }, []);

  if (!config) return <div className="empty">Loading…</div>;

  async function submit() {
    setSaving(true);
    try {
      const body: Parameters<typeof api.logMatch>[0] = { scorecard: card };
      if (source === "latest") body.riotMatchId = "latest";
      else if (source === "specific" && specificId) body.riotMatchId = specificId;
      if (source === "manual" && Object.keys(obj).length) body.objective = obj;
      // Manual overrides are allowed alongside a riot pull too (e.g. fix LP).
      if (source !== "manual" && Object.keys(obj).length) body.objective = obj;

      const res = await api.logMatch(body);
      setResult(res);
      toast.ok(`Logged. Process ${res.match.process.score}. ${verdictLine(res.match)}`);
    } catch (e) {
      toast.err(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setResult(null);
    setCard(EMPTY_CARD);
    setObj({});
    if (config?.riotConfigured) {
      api.recentRiot().then((r) => setRecent(r.matches)).catch(() => {});
    }
  }

  if (result) return <ResultView result={result} onAnother={reset} />;

  return (
    <>
      {toast.node}
      <div className="page-head">
        <div>
          <h1>Log a Game</h1>
          <div className="sub">
            90 seconds. The number is temporary; the note is the point.
          </div>
        </div>
      </div>

      {/* Source */}
      <div className="card">
        <label>Where's the data coming from?</label>
        <div className="seg">
          <button
            className={source === "latest" ? "on" : ""}
            disabled={!config.riotConfigured}
            onClick={() => setSource("latest")}
          >
            Pull latest ranked
          </button>
          <button
            className={source === "specific" ? "on" : ""}
            disabled={!config.riotConfigured}
            onClick={() => setSource("specific")}
          >
            Pick a game
          </button>
          <button className={source === "manual" ? "on" : ""} onClick={() => setSource("manual")}>
            Manual
          </button>
        </div>
        {!config.riotConfigured && (
          <p className="muted mt" style={{ fontSize: "0.83rem" }}>
            Riot API isn't configured, so objective stats are manual.{" "}
            <Link to="/settings">Set it up →</Link>
          </p>
        )}
        {source === "specific" && (
          <div className="field mt">
            <label>Recent ranked games</label>
            <select value={specificId} onChange={(e) => setSpecificId(e.target.value)}>
              {recent.map((m) => (
                <option key={m.matchId} value={m.matchId} disabled={m.alreadyLogged}>
                  {m.matchId} {m.alreadyLogged ? "(already logged)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* The scorecard */}
      <div className="grid cols-2 mt">
        <div className="card">
          <h2>The Read</h2>

          <div className="field">
            <label>Your grade for this game</label>
            <div className="seg">
              {GRADES.map((g) => (
                <button
                  key={g}
                  className={card.grade === g ? "on" : ""}
                  onClick={() => setCard({ ...card, grade: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <TiltScale
              label="Tilt going in"
              value={card.tiltBefore}
              onChange={(v) => setCard({ ...card, tiltBefore: v })}
            />
            <TiltScale
              label="Tilt coming out"
              value={card.tiltAfter}
              onChange={(v) => setCard({ ...card, tiltAfter: v })}
            />
          </div>

          <div className="field">
            <label>First death — what actually caused it?</label>
            <select
              value={card.firstDeathCause ?? ""}
              onChange={(e) =>
                setCard({
                  ...card,
                  firstDeathCause: (e.target.value || null) as DeathCause | null,
                })
              }
            >
              <option value="">— not sure / no death —</option>
              {DEATH_CAUSES.map((c) => (
                <option key={c} value={c}>
                  {DEATH_CAUSE_LABEL[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Biggest mistake</label>
            <textarea
              placeholder="The one thing you'd take back."
              value={card.biggestMistake}
              onChange={(e) => setCard({ ...card, biggestMistake: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Best decision</label>
            <textarea
              placeholder="One thing you got right — wins hide these."
              value={card.bestDecision}
              onChange={(e) => setCard({ ...card, bestDecision: e.target.value })}
            />
          </div>
          <div className="field">
            <label>⚡ One adjustment for next game</label>
            <textarea
              placeholder="The single thing you carry into the next queue."
              value={card.oneAdjustment}
              onChange={(e) => setCard({ ...card, oneAdjustment: e.target.value })}
            />
          </div>

          <div className="flex wrap">
            <Toggle
              label="Doomed team collapse"
              on={card.doomedCollapse}
              onClick={() => setCard({ ...card, doomedCollapse: !card.doomedCollapse })}
            />
            <Toggle
              label="I flamed / typed"
              danger
              on={card.flamed}
              onClick={() => setCard({ ...card, flamed: !card.flamed })}
            />
            <Toggle
              label="Muted appropriately"
              on={card.mutedAppropriately}
              onClick={() =>
                setCard({ ...card, mutedAppropriately: !card.mutedAppropriately })
              }
            />
            <Toggle
              label="Reviewed the game"
              on={card.reviewed}
              onClick={() => setCard({ ...card, reviewed: !card.reviewed })}
            />
          </div>
        </div>

        {/* Objective / manual */}
        <div className="card">
          <h2>{source === "manual" ? "The Numbers" : "The Numbers (optional overrides)"}</h2>
          <p className="muted" style={{ fontSize: "0.83rem" }}>
            {source === "manual"
              ? "Fill what you remember. Blanks are fine — the engine renormalizes."
              : "The Riot pull fills these on save. Only enter values here to override (e.g. LP across a promo)."}
          </p>

          <ObjInputs obj={obj} setObj={setObj} manual={source === "manual"} />
        </div>
      </div>

      <div className="flex mt-lg">
        <button onClick={submit} disabled={saving}>
          {saving ? "Logging…" : "Log the game →"}
        </button>
        <span className="muted">
          {source === "latest"
            ? "Pulls your most recent unlogged ranked game."
            : source === "specific"
            ? "Pulls the selected game."
            : "Saves exactly what you entered."}
        </span>
      </div>
    </>
  );
}

function ObjInputs({
  obj,
  setObj,
  manual,
}: {
  obj: Partial<ObjectiveData>;
  setObj: (o: Partial<ObjectiveData>) => void;
  manual: boolean;
}) {
  const num = (k: keyof ObjectiveData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setObj({ ...obj, [k]: e.target.value === "" ? undefined : Number(e.target.value) });
  return (
    <>
      {manual && (
        <>
          <div className="field-row">
            <div className="field">
              <label>Champion</label>
              <input
                value={obj.champion ?? ""}
                onChange={(e) => setObj({ ...obj, champion: e.target.value || undefined })}
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select
                value={obj.role ?? ""}
                onChange={(e) => setObj({ ...obj, role: (e.target.value || undefined) as any })}
              >
                <option value="">—</option>
                {["TOP", "JUNGLE", "MID", "BOT", "SUPPORT"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Result</label>
            <div className="seg">
              <button className={obj.win === true ? "on" : ""} onClick={() => setObj({ ...obj, win: true })}>
                Win
              </button>
              <button className={obj.win === false ? "on" : ""} onClick={() => setObj({ ...obj, win: false })}>
                Loss
              </button>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Kills</label>
              <input type="number" value={obj.kills ?? ""} onChange={num("kills")} />
            </div>
            <div className="field">
              <label>Deaths</label>
              <input type="number" value={obj.deaths ?? ""} onChange={num("deaths")} />
            </div>
            <div className="field">
              <label>Assists</label>
              <input type="number" value={obj.assists ?? ""} onChange={num("assists")} />
            </div>
          </div>
        </>
      )}
      <div className="field-row">
        <div className="field">
          <label>CS @ 10</label>
          <input type="number" value={obj.csAt10 ?? ""} onChange={num("csAt10")} />
        </div>
        <div className="field">
          <label>Deaths before 15</label>
          <input type="number" value={obj.deathsBefore15 ?? ""} onChange={num("deathsBefore15")} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Gold diff @ 15</label>
          <input type="number" value={obj.goldDiffAt15 ?? ""} onChange={num("goldDiffAt15")} />
        </div>
        <div className="field">
          <label>LP change</label>
          <input type="number" value={obj.lpDelta ?? ""} onChange={num("lpDelta")} />
        </div>
      </div>
    </>
  );
}

function TiltScale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="tilt-scale">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={value === n ? "on" : ""} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  on,
  onClick,
  danger,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`chip-toggle ${on ? "on" : ""}`}
      style={on && danger ? { borderColor: "#4d2626", background: "#1f1010", color: "var(--red)" } : undefined}
      onClick={onClick}
    >
      {on ? "●" : "○"} {label}
    </button>
  );
}

function verdictLine(m: EnrichedMatch) {
  return {
    clean_win: "Clean win.",
    good_loss: "Good loss — that's XP, not failure.",
    bad_win: "Bad win — review it anyway.",
    deserved_loss: "Deserved loss. The tape knows why.",
    standard: "Logged.",
  }[m.verdict];
}

function ResultView({
  result,
  onAnother,
}: {
  result: { match: EnrichedMatch; warnings: string[] };
  onAnother: () => void;
}) {
  const m = result.match;
  const o = m.objective;
  const xpTotal = m.xpAwarded.reduce((a, x) => a + x.amount, 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {o.champion ?? "Game"} · <Verdict v={m.verdict} />
          </h1>
          <div className="sub">
            {o.win === true ? "Win" : o.win === false ? "Loss" : "Result unknown"}
            {o.kills != null && ` · ${o.kills}/${o.deaths}/${o.assists}`}
            {o.lpDelta != null && ` · ${o.lpDelta >= 0 ? "+" : ""}${o.lpDelta} LP`}
          </div>
        </div>
        <button onClick={onAnother}>Log another →</button>
      </div>

      {result.warnings.map((w, i) => (
        <div className="banner caution" key={i}>
          <div className="icon">▲</div>
          <div className="msg" style={{ color: "var(--text)" }}>
            {w}
          </div>
        </div>
      ))}

      <div className="grid cols-3">
        <div className="card stat">
          <span className="label">Process Score</span>
          <span
            className="value"
            style={{ color: m.process.score >= 65 ? "var(--green)" : m.process.score >= 45 ? "var(--gold)" : "var(--red)" }}
          >
            {m.process.score}
          </span>
          <span className="hint">independent of the result</span>
        </div>
        <div className="card stat">
          <span className="label">XP Earned</span>
          <span className="value" style={{ color: "var(--gold)" }}>
            +{xpTotal}
          </span>
          <span className="hint">for process, not the win</span>
        </div>
        <div className="card stat">
          <span className="label">Early Game</span>
          <span className="value sm">
            {o.csAt10 != null ? `${o.csAt10} cs@10` : "—"}
          </span>
          <span className="hint">
            {o.deathsBefore15 != null ? `${o.deathsBefore15} deaths pre-15` : "no timeline"}
            {o.goldDiffAt15 != null ? ` · ${o.goldDiffAt15 >= 0 ? "+" : ""}${o.goldDiffAt15}g@15` : ""}
          </span>
        </div>
      </div>

      {m.flags.map((f, i) => (
        <div className="mt" key={i}>
          <FlagBanner flag={f} />
        </div>
      ))}

      <div className="card mt">
        <h2>Process Breakdown</h2>
        <p className="muted" style={{ fontSize: "0.83rem" }}>
          Sub-metrics that had data, weighted by your identity.
        </p>
        {Object.entries(m.process.subMetrics).map(([k, v]) => (
          <div className="row" key={k}>
            <div className="name">{prettyMetric(k)}</div>
            <div className="flex" style={{ width: 220 }}>
              <div style={{ flex: 1 }}>
                <div className="bar green">
                  <div style={{ width: `${(v as number) * 100}%` }} />
                </div>
              </div>
              <span className="faint" style={{ width: 34, textAlign: "right" }}>
                {Math.round((v as number) * 100)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="card mt">
        <h2>XP Awards</h2>
        {m.xpAwarded.map((x, i) => (
          <div className="row" key={i}>
            <div className="name">{x.reason}</div>
            <span className="pill gold">+{x.amount}</span>
          </div>
        ))}
      </div>

      <div className="flex mt-lg">
        <button onClick={onAnother}>Log another →</button>
        <Link to="/">
          <button className="ghost">Back to dashboard</button>
        </Link>
      </div>
    </>
  );
}

function prettyMetric(k: string) {
  return {
    earlyStability: "Early-game stability",
    deathDiscipline: "Death discipline",
    objectiveMacro: "Objective / macro",
    teamfight: "Teamfighting",
    mental: "Mental & comms",
    review: "Review completeness",
  }[k] ?? k;
}
