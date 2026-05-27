import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Trust Layer — AI Chat with Evaluation" },
      {
        name: "description",
        content:
          "ChatGPT-style interface with a built-in post-generation trust evaluation layer: cross-model validation, evidence checks, reasoning gaps, and confidence scoring.",
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
    label: "Launch new feature next week?",
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
    warnings: ["Medium-risk business decision: surface uncertainty before acting."],
  },
  {
    id: "med",
    label: "Ibuprofen dosing question",
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
    label: "Coffee subscription names",
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
      { dimension: "Trademark check", status: "weak", note: "'Bean Post' and 'Origin Box' are in use by real brands." },
      { dimension: "Domain availability", status: "missing", note: "Not verified in this run." },
      { dimension: "Brief alignment", status: "ok", note: "Tone matches specialty coffee market." },
    ],
    reasoningGaps: ["No rationale provided for each name."],
    warnings: ["Low-risk creative task — light evaluation, surface trademark caveats."],
  },
];

type EvalResult = {
  primary: string;
  category: string;
  risk: RiskLevel;
  confidence: number;
  models: Scenario["models"];
  evidence: Scenario["evidence"];
  reasoningGaps: string[];
  warnings: string[];
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  evalData?: Scenario & { confidence?: number };
  stage?: number; // -1 idle, 0..4 in progress, 5 done
};

function Index() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const timers = useRef<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const updateLastAssistant = (patch: Partial<Message>) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = { ...next[i], ...patch };
          break;
        }
      }
      return next;
    });
  };

  const animatePipeline = (opts?: { fast?: boolean }) => {
    const stepDelay = opts?.fast ? 220 : 600;
    const startDelay = opts?.fast ? 150 : 380;
    [0, 1, 2, 3, 4].forEach((i) => {
      const t = window.setTimeout(
        () => updateLastAssistant({ stage: i }),
        startDelay + i * stepDelay,
      );
      timers.current.push(t);
    });
    const tEnd = window.setTimeout(() => {
      updateLastAssistant({ stage: 5 });
      setRunning(false);
    }, startDelay + 5 * stepDelay);
    timers.current.push(tEnd);
  };

  const send = async (prompt: string, scenario?: Scenario) => {
    if (running) return;
    const text = prompt.trim();
    if (!text) return;

    timers.current.forEach(clearTimeout);
    timers.current = [];
    setError(null);
    setInput("");
    setRunning(true);
    setSidebarOpen(false);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      stage: -1,
      evalData: scenario,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    if (scenario) {
      animatePipeline({ fast: true });
      return;
    }

    animatePipeline();
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Evaluation failed");
      const r = data as EvalResult;
      updateLastAssistant({
        evalData: {
          id: "live",
          label: "Custom prompt",
          prompt: text,
          risk: r.risk,
          category: r.category,
          primary: r.primary,
          models: r.models,
          evidence: r.evidence,
          reasoningGaps: r.reasoningGaps,
          warnings: r.warnings,
          confidence: r.confidence,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed");
    }
  };

  const newChat = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setMessages([]);
    setInput("");
    setRunning(false);
    setError(null);
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex w-64 flex-col bg-[var(--sidebar)] border-r border-border transition-transform md:relative md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground text-sm font-semibold">T</div>
            <span className="text-sm font-medium">Trust Layer</span>
          </div>
          <button
            onClick={newChat}
            title="New chat"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
        </div>

        <button
          onClick={newChat}
          className="mx-3 mb-3 flex items-center justify-between rounded-lg border border-border bg-transparent px-3 py-2 text-sm hover:bg-muted"
        >
          New chat
          <span className="text-muted-foreground">＋</span>
        </button>

        <div className="px-3 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Examples
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => send(s.prompt, s)}
              disabled={running}
              className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground/90 hover:bg-muted disabled:opacity-50"
            >
              <span className="truncate">{s.label}</span>
              <RiskDot risk={s.risk} />
            </button>
          ))}
        </nav>

        <div className="border-t border-border p-3 text-[11px] text-muted-foreground">
          Post-generation evaluation prototype
        </div>
      </aside>

      {/* Main */}
      <main className="relative flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:px-6">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Trust Layer</span>
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              gemini-3-flash
            </span>
          </div>
          <div className="w-8" />
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <EmptyState onPick={(s) => send(s.prompt, s)} />
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
              {messages.map((m) => (
                <ChatBubble key={m.id} message={m} />
              ))}
              {error && (
                <div className="mt-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-4 py-2 text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border bg-background px-4 py-4 md:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm focus-within:border-primary"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Message Trust Layer…"
              className="max-h-48 min-h-[24px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={running || !input.trim()}
              className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground transition disabled:opacity-40"
              title="Send"
            >
              {running ? (
                <span className="block h-3 w-3 animate-pulse rounded-sm bg-primary-foreground" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              )}
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">
            Every response is cross-validated, evidence-checked, and confidence-scored before you see it.
          </p>
        </div>
      </main>

      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="absolute inset-0 z-20 bg-black/40 md:hidden"
        />
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: Scenario) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-4 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground text-xl font-semibold">
        T
      </div>
      <h1 className="mt-4 font-display text-4xl">How can I help — verifiably?</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Ask anything. Every answer runs through a 5-layer trust evaluation before it's shown.
      </p>
      <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-muted-foreground/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {s.category}
              </span>
              <RiskBadge risk={s.risk} />
            </div>
            <p className="mt-2 text-sm">{s.prompt}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="mb-6 flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="mb-6 flex gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground text-xs font-semibold">
        T
      </div>
      <div className="flex-1 min-w-0">
        <AssistantContent message={message} />
      </div>
    </div>
  );
}

function AssistantContent({ message }: { message: Message }) {
  const stage = message.stage ?? -1;
  const done = stage === 5;
  const data = message.evalData;

  const confidence = useMemo(() => {
    if (!data) return 0;
    if (data.confidence != null) return Math.round(data.confidence);
    const base = data.risk === "high" ? 38 : data.risk === "medium" ? 64 : 82;
    const dissent = data.models.filter((m) => m.stance !== "agree").length;
    const missing = data.evidence.filter((e) => e.status !== "ok").length;
    return Math.max(8, base - dissent * 8 - missing * 6);
  }, [data]);

  const riskColor =
    data?.risk === "high"
      ? "text-[var(--danger)]"
      : data?.risk === "medium"
      ? "text-[var(--warning)]"
      : "text-[var(--success)]";

  return (
    <div className="space-y-3">
      {/* Pipeline progress (always shown, compact when done) */}
      <PipelineCompact stage={stage} confidence={done ? confidence : null} riskColor={riskColor} />

      {done && data && (
        <>
          <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed">
            {data.primary}
          </div>

          {data.warnings.map((w, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-xs"
            >
              ⚠ {w}
            </div>
          ))}

          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
              <span>Evaluation details</span>
              <span className="transition group-open:rotate-180">▾</span>
            </summary>
            <div className="space-y-4 border-t border-border px-4 py-4">
              <Section title="Cross-model validation">
                <ul className="space-y-2">
                  {data.models.map((m) => (
                    <li
                      key={m.name}
                      className="rounded-lg border border-border bg-background/40 p-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px]">{m.name}</span>
                        <StanceBadge stance={m.stance} />
                      </div>
                      <p className="mt-1 text-xs">{m.verdict}</p>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section title="Evidence verification">
                <ul className="space-y-2">
                  {data.evidence.map((e) => (
                    <li
                      key={e.dimension}
                      className="rounded-lg border border-border bg-background/40 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{e.dimension}</span>
                        <EvidenceBadge status={e.status} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{e.note}</p>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section title="Reasoning gaps">
                <ul className="space-y-1.5">
                  {data.reasoningGaps.map((g, i) => (
                    <li key={i} className="text-xs">
                      <span className="mr-2 font-mono text-[var(--warning)]">·</span>
                      {g}
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function PipelineCompact({
  stage,
  confidence,
  riskColor,
}: {
  stage: number;
  confidence: number | null;
  riskColor: string;
}) {
  const steps = [
    "Primary response",
    "Cross-model validation",
    "Evidence verification",
    "Reasoning completeness",
    "Risk + confidence",
  ];
  const done = stage === 5;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Trust pipeline
          </span>
          {done ? (
            <span className="text-[11px] text-[var(--success)]">5/5 layers ✓</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {Math.max(0, stage + 1)}/5 layers
            </span>
          )}
        </div>
        {confidence != null && (
          <div className="text-right">
            <span className={`font-display text-2xl leading-none ${riskColor}`}>
              {confidence}%
            </span>
            <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              accuracy
            </span>
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-1">
        {steps.map((label, i) => {
          const active = stage === i;
          const complete = stage > i;
          return (
            <div
              key={label}
              title={label}
              className={`h-1.5 flex-1 rounded-full transition ${
                complete
                  ? "bg-[var(--success)]"
                  : active
                  ? "bg-primary animate-pulse"
                  : "bg-muted"
              }`}
            />
          );
        })}
      </div>
      {!done && stage >= 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {steps[Math.min(stage, 4)]}…
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function RiskDot({ risk }: { risk: RiskLevel }) {
  const c =
    risk === "high"
      ? "bg-[var(--danger)]"
      : risk === "medium"
      ? "bg-[var(--warning)]"
      : "bg-[var(--success)]";
  return <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />;
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
