import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { chatCompletion } from "@/lib/ai";
import reviewsData from "@/data/reviews.json";

type Review = {
  id: string;
  source: string;
  rating: number | null;
  text: string;
  date: string | null;
  username?: string | null;
};

const REVIEWS = reviewsData as Review[];

const SUGGESTED_QUESTIONS = [
  "Why do users struggle to discover new music?",
  "What are the most common frustrations with recommendations?",
  "What listening behaviors are users trying to achieve?",
  "What causes users to repeatedly listen to the same content?",
  "Which user segments experience different discovery challenges?",
  "What unmet needs emerge consistently across reviews?",
];

const STOPWORDS = new Set(
  "a an the and or but if then so of to in on for with at by from is are was were be been being have has had do does did i you he she it we they me him her us them my your his its our their this that these those not no nor as about into over under more most less few many much very can will just like get got go going make made out up down".split(
    " ",
  ),
);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z']{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
}

type Scored = { review: Review; score: number };

function retrieveRelevant(query: string, pool: Review[], k = 60): Scored[] {
  const qTokens = Array.from(new Set(tokenize(query)));
  if (qTokens.length === 0) {
    // fallback: random-ish sample
    return pool.slice(0, k).map((r) => ({ review: r, score: 0 }));
  }
  const scored: Scored[] = pool.map((r) => {
    const text = r.text.toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      // term frequency
      let idx = 0;
      while ((idx = text.indexOf(t, idx)) !== -1) {
        score += 1;
        idx += t.length;
      }
    }
    // gentle boost for low-rating reviews when query mentions frustration/problem words
    if (r.rating !== null && r.rating <= 2) score *= 1.05;
    return { review: r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, k);
  if (top.length >= 10) return top;
  // pad with sample
  const rest = scored.filter((s) => s.score === 0).slice(0, k - top.length);
  return [...top, ...rest];
}

function aggregate(pool: Review[]) {
  const bySource: Record<string, number> = {};
  const byRating: Record<string, number> = {};
  const ratingSumBySource: Record<string, { sum: number; n: number }> = {};
  for (const r of pool) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    const k = r.rating == null ? "n/a" : String(r.rating);
    byRating[k] = (byRating[k] ?? 0) + 1;
    if (r.rating != null) {
      const s = (ratingSumBySource[r.source] ??= { sum: 0, n: 0 });
      s.sum += r.rating;
      s.n += 1;
    }
  }
  const avgBySource = Object.fromEntries(
    Object.entries(ratingSumBySource).map(([k, v]) => [k, +(v.sum / v.n).toFixed(2)]),
  );
  return { total: pool.length, bySource, byRating, avgBySource };
}

function topKeywords(pool: Review[], n = 30): { term: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const r of pool) {
    const seen = new Set<string>();
    for (const t of tokenize(r.text)) {
      if (seen.has(t)) continue;
      seen.add(t);
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// ─────────────────────────── UI ───────────────────────────

type Tab = "overview" | "explorer" | "ai";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("overview");

  const agg = useMemo(() => aggregate(REVIEWS), []);
  const sources = useMemo(() => Object.keys(agg.bySource), [agg]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-sidebar">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <div className="font-display text-2xl leading-none">Review Intelligence</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {agg.total.toLocaleString()} reviews · {sources.length} sources · AI-powered analysis
            </div>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex rounded-md border border-border bg-card p-1 text-sm">
              {(["overview", "explorer", "ai"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-3 py-1.5 capitalize transition ${
                    tab === t
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "ai" ? "AI Insights" : t}
                </button>
              ))}
            </nav>
            <button
              onClick={toggleTheme}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {tab === "overview" && <Overview agg={agg} />}
        {tab === "explorer" && <Explorer sources={sources} />}
        {tab === "ai" && <AIInsights sources={sources} />}
      </main>

      <footer className="border-t border-border bg-sidebar">
        <div className="mx-auto max-w-7xl px-6 py-4 text-xs text-muted-foreground">
          Powered by OpenRouter · claude-sonnet-4 · client-side retrieval over {agg.total} reviews
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────── Overview ───────────────────────────

function Overview({ agg }: { agg: ReturnType<typeof aggregate> }) {
  const keywords = useMemo(() => topKeywords(REVIEWS, 28), []);
  const maxKw = keywords[0]?.count ?? 1;
  const sourceMax = Math.max(...Object.values(agg.bySource));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Reviews by source" className="lg:col-span-2">
        <div className="space-y-3">
          {Object.entries(agg.bySource)
            .sort((a, b) => b[1] - a[1])
            .map(([source, n]) => (
              <div key={source}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{source}</span>
                  <span className="text-muted-foreground">
                    {n} · avg {agg.avgBySource[source] ?? "—"}★
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${(n / sourceMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
        </div>
      </Card>

      <Card title="Rating distribution">
        <div className="space-y-2">
          {["5", "4", "3", "2", "1", "n/a"].map((k) => {
            const n = agg.byRating[k] ?? 0;
            const pct = (n / agg.total) * 100;
            return (
              <div key={k} className="flex items-center gap-3 text-sm">
                <span className="w-8 text-muted-foreground">{k === "n/a" ? "—" : `${k}★`}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className={`h-full ${
                      k === "5" || k === "4"
                        ? "bg-success"
                        : k === "3"
                          ? "bg-warning"
                          : "bg-danger"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 text-right text-muted-foreground">{n}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Top terms across reviews" className="lg:col-span-3">
        <div className="flex flex-wrap gap-2">
          {keywords.map((k) => {
            const scale = 0.75 + (k.count / maxKw) * 0.9;
            return (
              <span
                key={k.term}
                className="rounded-full border border-border bg-card px-3 py-1 text-muted-foreground"
                style={{ fontSize: `${scale}rem` }}
                title={`${k.count} reviews`}
              >
                {k.term}{" "}
                <span className="text-xs opacity-60">{k.count}</span>
              </span>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-card p-5 ${className}`}>
      <h2 className="mb-4 font-display text-lg">{title}</h2>
      {children}
    </section>
  );
}

// ─────────────────────────── Explorer ───────────────────────────

function Explorer({ sources }: { sources: string[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>("");
  const [rating, setRating] = useState<string>("");
  const [limit, setLimit] = useState(50);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return REVIEWS.filter((r) => {
      if (source && r.source !== source) return false;
      if (rating && String(r.rating ?? "") !== rating) return false;
      if (q && !r.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, source, rating]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(50);
          }}
          placeholder="Search reviews…"
          className="min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">All ratings</option>
          {["5", "4", "3", "2", "1"].map((r) => (
            <option key={r} value={r}>
              {r}★
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">{filtered.length} matches</span>
      </div>

      <div className="space-y-3">
        {filtered.slice(0, limit).map((r) => (
          <ReviewCard key={r.id} review={r} highlight={query} />
        ))}
        {filtered.length > limit && (
          <button
            onClick={() => setLimit((n) => n + 50)}
            className="w-full rounded-md border border-border bg-card py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ review, highlight }: { review: Review; highlight?: string }) {
  const text = review.text;
  let body: React.ReactNode = text;
  if (highlight && highlight.trim()) {
    const h = highlight.trim();
    const re = new RegExp(`(${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    const parts = text.split(re);
    body = parts.map((p, i) =>
      re.test(p) ? (
        <mark key={i} className="bg-warning/30 text-foreground">
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  }
  const ratingColor =
    review.rating == null
      ? "text-muted-foreground"
      : review.rating >= 4
        ? "text-success"
        : review.rating === 3
          ? "text-warning"
          : "text-danger";
  return (
    <article className="rounded-lg border border-border bg-card p-4 text-sm">
      <header className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-2 py-0.5">{review.source}</span>
        <span className={ratingColor}>{review.rating == null ? "—" : `${review.rating}★`}</span>
        {review.username && <span>· {review.username}</span>}
        {review.date && <span>· {review.date}</span>}
        <span className="ml-auto font-mono opacity-60">{review.id.slice(0, 8)}</span>
      </header>
      <p className="leading-relaxed">{body}</p>
    </article>
  );
}

// ─────────────────────────── AI Insights ───────────────────────────

type Insight = {
  question: string;
  answer: string;
  citedIds: string[];
  contextSize: number;
  error?: string;
};

function AIInsights({ sources }: { sources: string[] }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [filterSource, setFilterSource] = useState<string>("");

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setInsight(null);
    try {
      const pool = filterSource
        ? REVIEWS.filter((r) => r.source === filterSource)
        : REVIEWS;
      const top = retrieveRelevant(q, pool, 60);
      const agg = aggregate(pool);

      const contextLines = top.map(
        ({ review }) =>
          `[${review.id}] (${review.source}, ${review.rating ?? "—"}★) ${review.text.slice(0, 600)}`,
      );

      const system = `You are a senior product researcher analyzing user feedback for a music streaming product.
You will be given a question and a sample of real user reviews (most-relevant first), plus aggregate statistics.
Your job:
- Synthesize a clear, evidence-based answer to the question.
- Surface concrete themes, pain points, and unmet needs.
- When you make a claim, cite supporting reviews by their bracketed ID, e.g. [AS51776]. Cite 3–8 IDs total.
- If the sample is insufficient to answer, say so explicitly.
- Output well-structured markdown with short headings and bullets. No preamble.`;

      const user = `Question: ${q}

Dataset scope: ${agg.total} reviews across ${Object.keys(agg.bySource).join(", ")}.
Rating distribution: ${JSON.stringify(agg.byRating)}.
Avg rating by source: ${JSON.stringify(agg.avgBySource)}.

Most relevant reviews (id, source, rating, text):
${contextLines.join("\n")}`;

      const res = await chatCompletion({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 1800,
        temperature: 0.3,
      });

      const answer: string = res?.choices?.[0]?.message?.content ?? "";
      const cited = Array.from(
        new Set(
          (answer.match(/\[([A-Za-z0-9\-]{4,})\]/g) ?? []).map((m) => m.slice(1, -1)),
        ),
      );
      setInsight({
        question: q,
        answer: answer || "(empty response)",
        citedIds: cited,
        contextSize: top.length,
      });
    } catch (e) {
      setInsight({
        question: q,
        answer: "",
        citedIds: [],
        contextSize: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-display text-lg">Ask the reviews</h2>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask(question);
              }}
              placeholder="e.g. What are the most common frustrations with recommendations?"
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => ask(question)}
              disabled={loading || !question.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Retrieves the most relevant reviews from the dataset and sends them to the model with
            aggregate stats. Answers cite review IDs.
          </p>
        </div>

        {insight && (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-2 text-xs text-muted-foreground">
              Q · {insight.question}
              {insight.contextSize > 0 && ` · ${insight.contextSize} reviews in context`}
            </div>
            {insight.error ? (
              <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                {insight.error}
              </div>
            ) : (
              <>
                <Markdownish text={insight.answer} />
                {insight.citedIds.length > 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                      Cited reviews
                    </div>
                    <div className="space-y-2">
                      {insight.citedIds.map((id) => {
                        const r = REVIEWS.find((x) => x.id === id);
                        if (!r) return null;
                        return <ReviewCard key={id} review={r} />;
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-3 font-display text-base">Suggested questions</h3>
          <div className="space-y-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuestion(q);
                  ask(q);
                }}
                disabled={loading}
                className="block w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary/60 hover:text-foreground disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">How it works</div>
          Each question is matched against all {REVIEWS.length} reviews via keyword scoring; the top
          ~60 most-relevant reviews and aggregate stats are sent to claude-sonnet-4 via OpenRouter.
          The model must cite review IDs, shown below the answer.
        </div>
      </aside>
    </div>
  );
}

// Minimal markdown-ish renderer: headings, bullets, bold, code-ids
function Markdownish({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = () => {
    if (listBuf.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="mb-3 ml-5 list-disc space-y-1 text-sm">
          {listBuf.map((l, i) => (
            <li key={i}>{renderInline(l)}</li>
          ))}
        </ul>,
      );
      listBuf = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^#{1,3}\s+/.test(line)) {
      flushList();
      const level = line.match(/^#+/)![0].length;
      const content = line.replace(/^#+\s+/, "");
      const cls =
        level === 1
          ? "font-display text-xl mt-4 mb-2"
          : level === 2
            ? "font-display text-lg mt-4 mb-2"
            : "font-medium mt-3 mb-1";
      out.push(
        <div key={i} className={cls}>
          {renderInline(content)}
        </div>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      listBuf.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      out.push(
        <p key={i} className="mb-2 text-sm leading-relaxed">
          {renderInline(line)}
        </p>,
      );
    }
  });
  flushList();
  return <div>{out}</div>;
}

function renderInline(s: string): React.ReactNode {
  // bold **x**, code `x`, ids [XYZ]
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[A-Za-z0-9\-]{4,}\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded bg-muted px-1 font-mono text-xs">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(
        <span
          key={key++}
          className="rounded bg-primary/15 px-1 font-mono text-xs text-primary"
        >
          {tok.slice(1, -1)}
        </span>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

// Force re-import-side effect for useEffect (no-op kept for HMR friendliness)
void useEffect;
