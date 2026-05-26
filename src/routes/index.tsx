import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Trust Layer — Interactive AI Evaluation Prototype" },
      {
        name: "description",
        content:
          "Interactive prototype of a post-generation AI trust evaluation layer: cross-model validation, evidence checks, reasoning gaps, risk scoring, and confidence synthesis.",
      },
    ],
  }),
});

type RiskLevel = "low" | "medium" | "high";

type Scenario = {
  id: string;
  label: string;
  prompt: string;
  risk: RiskLevel;
  category: string;
  primary: string;
  models: { name: string; verdict: string; stance: "agree" | "partial" | "dissent" }[];
  evidence: { dimension: string; status: "ok" | "weak" | "missing"; note: string }[];
  reasoningGaps: string[];
  warnings: string[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "launch",
    label: "Should we launch the new feature next week?",
    prompt: "Should we launch the new checkout feature next week?",
    risk: "medium",
    category: "Business strategy",
    primary:
      "Yes — launch next week. Early metrics from the beta show strong engagement and the team is ready to ship.",
    models: [
      { name: "gpt-primary", verdict: "Launch immediately.", stance: "agree" },
      { name: "claude-verifier", verdict: "Requires another round of load testing before launch.", stance: "partial" },
      { name: "domain-eval", verdict: "Scalability risk at 3× current traffic is unaddressed.", stance: "dissent" },
    ],
    evidence: [
      { dimension: "Beta engagement claim", status: "ok", note: "Matches internal analytics for the last 14 days." },
      { dimension: "Load test data", status: "missing", note: "No referenced load test above 1.2× current peak." },
      { dimension: "Rollback plan", status: "weak", note: "Mentioned but not described." },
    ],
    reasoningGaps: [
      "No causal link between beta engagement and post-launch retention.",
      "Assumes infra capacity without citing observability data.",
    ],
    warnings: ["Medium-risk business decision: surface uncertainty to the decision-maker before acting."],
  },
  {
    id: "med",
    label: "Is 600mg ibuprofen safe every 4 hours?",
    prompt: "Is taking 600mg of ibuprofen every 4 hours safe for an adult?",
    risk: "high",
    category: "Medical",
    primary:
      "Adults can typically take ibuprofen for pain — common dosing is 200–400mg every 4–6 hours, not to exceed 1200mg/day OTC.",
    models: [
      { name: "gpt-primary", verdict: "Provides general dosing guidance.", stance: "partial" },
      { name: "claude-verifier", verdict: "Flags that 600mg every 4h exceeds OTC max and requires clinician input.", stance: "dissent" },
      { name: "medical-eval", verdict: "Strongly recommends consulting a licensed clinician; not safe to generalize.", stance: "dissent" },
    ],
    evidence: [
      { dimension: "OTC daily max", status: "ok", note: "1200mg/day OTC limit verified against FDA labeling." },
      { dimension: "Individual factors", status: "missing", note: "No assessment of weight, kidney function, or other meds." },
      { dimension: "Citation", status: "weak", note: "No primary source linked in the answer." },
    ],
    reasoningGaps: [
      "Answer does not address the specific dose asked about.",
      "No discussion of contraindications or interactions.",
    ],
    warnings: [
      "High-risk medical query — do NOT act on AI output alone.",
      "Stricter evaluation triggered: blocked recommendation, surfaced clinician referral.",
    ],
  },
  {
    id: "brain",
    label: "Brainstorm names for a coffee subscription",
    prompt: "Give me 10 creative names for a specialty coffee subscription service.",
    risk: "low",
    category: "Brainstorming",
    primary:
      "Here are ten name ideas: Dailygrind, Bean Post, Roast Letters, Cupboard, North Pour, Slow Drip Club, Cofounders, Brew Mail, Origin Box, Morning Index.",
    models: [
      { name: "gpt-primary", verdict: "Generated 10 names.", stance: "agree" },
      { name: "claude-verifier", verdict: "Names are coherent and on-brief.", stance: "agree" },
      { name: "domain-eval", verdict: "Two names overlap with existing trademarks — flag.", stance: "partial" },
    ],
    evidence: [
      { dimension: "Trademark check", status: "weak", note: "‘Bean Post’ and ‘Origin Box’ are in use by real brands." },
      { dimension: "Domain availability", status: "missing", note: "Not verified in this run." },
      { dimension: "Brief alignment", status: "ok", note: "Tone matches specialty coffee market." },
    ],
    reasoningGaps: ["No rationale provided for each name."],
    warnings: ["Low-risk creative task — light evaluation, surface trademark caveats."],
  },
];

function Index() {
  const [scenarioId, setScenarioId] = useState<string>(SCENARIOS[0].id);
  const [customPrompt, setCustomPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<number>(-1);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0],
    [scenarioId],
  );

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStage(-1);
    setDone(false);
    setRunning(false);
  };

  const run = (opts?: { fast?: boolean }) => {
    reset();
    setRunning(true);
    const stepDelay = opts?.fast ? 180 : 700;
    const startDelay = opts?.fast ? 120 : 450;
    const steps = [0, 1, 2, 3, 4];
    steps.forEach((i) => {
      const t = window.setTimeout(() => setStage(i), startDelay + i * stepDelay);
      timers.current.push(t);
    });
    const tEnd = window.setTimeout(() => {
      setDone(true);
      setRunning(false);
    }, startDelay + steps.length * stepDelay);
    timers.current.push(tEnd);
  };

  const confidence = useMemo(() => {
    const base =
      scenario.risk === "high" ? 38 : scenario.risk === "medium" ? 64 : 82;
    const dissent = scenario.models.filter((m) => m.stance !== "agree").length;
    const missing = scenario.evidence.filter((e) => e.status !== "ok").length;
    return Math.max(8, base - dissent * 8 - missing * 6);
  }, [scenario]);

  const riskColor =
    scenario.risk === "high"
      ? "text-[var(--danger)]"
      : scenario.risk === "medium"
      ? "text-[var(--warning)]"
      : "text-[var(--success)]";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        <Header />

        <section className="mt-10 grid gap-8 lg:grid-cols-[1.05fr_1.4fr]">
          {/* Prompt panel */}
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              01 — Prompt
            </p>
            <h2 className="mt-2 font-display text-3xl leading-tight">
              Pick a prompt, run the trust layer.
            </h2>

            <div className="mt-6 space-y-2">
              {SCENARIOS.map((s) => {
                const active = s.id === scenarioId && !customPrompt;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setScenarioId(s.id);
                      setCustomPrompt("");
                      reset();
                    }}
                    className={`w-full text-left rounded-lg border px-4 py-3 transition ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/40 hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">{s.label}</span>
                      <RiskBadge risk={s.risk} />
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                or write your own
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => {
                  setCustomPrompt(e.target.value);
                  reset();
                }}
                rows={3}
                placeholder="Ask anything — we'll evaluate it the same way."
                className="mt-2 w-full resize-none rounded-lg border border-border bg-muted/40 px-4 py-3 font-mono text-sm outline-none focus:border-primary"
              />
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={run}
                disabled={running}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {running ? "Evaluating…" : done ? "Re-run evaluation" : "Run trust layer"}
              </button>
              {done && (
                <button
                  onClick={reset}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="mt-6 rounded-lg border border-dashed border-border bg-background/40 p-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Active prompt
              </p>
              <p className="mt-1 font-mono text-sm">
                {customPrompt || scenario.prompt}
              </p>
            </div>
          </div>

          {/* Pipeline panel */}
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              02 — Evaluation Pipeline
            </p>
            <h2 className="mt-2 font-display text-3xl leading-tight">
              Five layers, one verdict.
            </h2>

            <ol className="mt-6 space-y-3">
              <PipelineStep idx={0} stage={stage} title="Primary AI response" desc="Generate the candidate answer." />
              <PipelineStep idx={1} stage={stage} title="Cross-model validation" desc="Compare against verifier + domain models." />
              <PipelineStep idx={2} stage={stage} title="Evidence verification" desc="Check claims against sources & retrieval." />
              <PipelineStep idx={3} stage={stage} title="Reasoning completeness" desc="Detect gaps, missing assumptions, leaps." />
              <PipelineStep idx={4} stage={stage} title="Risk + confidence synthesis" desc="Score, warn, and route to the user." />
            </ol>

            {done && (
              <div className="mt-6 rounded-lg border border-border bg-background/40 p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Primary AI response
                </p>
                <p className="mt-2 text-sm leading-relaxed">{scenario.primary}</p>
              </div>
            )}
          </div>
        </section>

        {done && (
          <section className="mt-12 space-y-8">
            {/* Confidence */}
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Confidence synthesis
                  </p>
                  <p className="mt-2 font-display text-6xl">{confidence}%</p>
                  <p className={`mt-1 text-sm ${riskColor}`}>
                    {scenario.category} · {scenario.risk.toUpperCase()} risk
                  </p>
                </div>
                <div className="w-full max-w-md">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-700"
                      style={{ width: `${confidence}%` }}
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <span>Unreliable</span>
                    <span>Verified</span>
                  </div>
                </div>
              </div>

              {scenario.warnings.map((w, i) => (
                <div
                  key={i}
                  className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm"
                >
                  ⚠ {w}
                </div>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Cross-model */}
              <div className="rounded-xl border border-border bg-card p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Cross-model validation
                </p>
                <ul className="mt-4 space-y-3">
                  {scenario.models.map((m) => (
                    <li key={m.name} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs">{m.name}</span>
                        <StanceBadge stance={m.stance} />
                      </div>
                      <p className="mt-1 text-sm">{m.verdict}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Evidence */}
              <div className="rounded-xl border border-border bg-card p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Evidence verification
                </p>
                <ul className="mt-4 space-y-3">
                  {scenario.evidence.map((e) => (
                    <li key={e.dimension} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{e.dimension}</span>
                        <EvidenceBadge status={e.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Reasoning */}
              <div className="rounded-xl border border-border bg-card p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Reasoning gaps
                </p>
                <ul className="mt-4 space-y-3">
                  {scenario.reasoningGaps.map((g, i) => (
                    <li key={i} className="rounded-lg border border-border bg-background/40 p-3 text-sm">
                      <span className="mr-2 font-mono text-[var(--warning)]">·</span>
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
          Prototype · post-generation trust evaluation layer · interactive demo
        </footer>
      </div>
    </main>
  );
}

function Header() {
  return (
    <header className="flex items-start justify-between gap-6">
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Trust Layer
        </div>
        <h1 className="mt-3 font-display text-5xl leading-[1.05] md:text-6xl">
          Don't just generate.
          <br />
          <span className="text-primary">Evaluate.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          An interactive prototype of a post-generation evaluation system that sits between
          AI output and the user's decision — exposing agreement, evidence, gaps and risk.
        </p>
      </div>
    </header>
  );
}

function PipelineStep({
  idx,
  stage,
  title,
  desc,
}: {
  idx: number;
  stage: number;
  title: string;
  desc: string;
}) {
  const active = stage === idx;
  const complete = stage > idx;
  return (
    <li
      className={`flex items-start gap-4 rounded-lg border px-4 py-3 transition ${
        complete
          ? "border-[var(--success)]/40 bg-[var(--success)]/5"
          : active
          ? "border-primary bg-primary/10"
          : "border-border bg-background/30"
      }`}
    >
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${
          complete
            ? "border-[var(--success)] text-[var(--success)]"
            : active
            ? "border-primary text-primary animate-pulse"
            : "border-border text-muted-foreground"
        }`}
      >
        {complete ? "✓" : idx + 1}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}

function RiskBadge({ risk }: { risk: RiskLevel }) {
  const map = {
    low: ["border-[var(--success)]/40", "text-[var(--success)]"],
    medium: ["border-[var(--warning)]/40", "text-[var(--warning)]"],
    high: ["border-[var(--danger)]/40", "text-[var(--danger)]"],
  } as const;
  const [b, t] = map[risk];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${b} ${t}`}>
      {risk}
    </span>
  );
}

function StanceBadge({ stance }: { stance: "agree" | "partial" | "dissent" }) {
  const map = {
    agree: ["bg-[var(--success)]/15", "text-[var(--success)]", "Agrees"],
    partial: ["bg-[var(--warning)]/15", "text-[var(--warning)]", "Partial"],
    dissent: ["bg-[var(--danger)]/15", "text-[var(--danger)]", "Dissents"],
  } as const;
  const [bg, t, label] = map[stance];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${bg} ${t}`}>
      {label}
    </span>
  );
}

function EvidenceBadge({ status }: { status: "ok" | "weak" | "missing" }) {
  const map = {
    ok: ["bg-[var(--success)]/15", "text-[var(--success)]", "Verified"],
    weak: ["bg-[var(--warning)]/15", "text-[var(--warning)]", "Weak"],
    missing: ["bg-[var(--danger)]/15", "text-[var(--danger)]", "Missing"],
  } as const;
  const [bg, t, label] = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${bg} ${t}`}>
      {label}
    </span>
  );
}
