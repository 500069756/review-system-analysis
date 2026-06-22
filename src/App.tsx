import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { chatCompletion } from "@/lib/ai";
import reviewsData from "@/data/reviews.json";

function SpotifyLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 168 168" className={className} aria-hidden="true">
      <circle cx="84" cy="84" r="84" fill="#1DB954" />
      <path
        fill="#000"
        d="M122.6 117.3c-1.6 2.6-5 3.4-7.6 1.8-20.8-12.7-47-15.6-77.8-8.6-3 .7-6-1.2-6.6-4.2-.7-3 1.2-6 4.2-6.6 33.7-7.7 62.7-4.3 86 10 2.6 1.6 3.4 5 1.8 7.6zm10.3-22.9c-2 3.2-6.2 4.2-9.4 2.2-23.8-14.6-60-18.9-88.1-10.4-3.6 1.1-7.4-.9-8.5-4.5s.9-7.4 4.5-8.5c32.1-9.7 72-4.9 99.3 11.8 3.2 2 4.2 6.2 2.2 9.4zm.9-23.9C105.3 53.5 57.6 51.7 31.1 59.7c-4.3 1.3-8.8-1.1-10.1-5.4s1.1-8.8 5.4-10.1c30.4-9.2 83-7.1 115.6 12.2 3.9 2.3 5.1 7.3 2.8 11.2-2.3 3.8-7.3 5.1-11.2 2.8z"
      />
    </svg>
  );
}

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function LiveTicker() {
  const samples = useMemo(
    () =>
      [...REVIEWS]
        .filter((r) => r.text && r.text.length < 180)
        .sort(() => Math.random() - 0.5)
        .slice(0, 30),
    [],
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % samples.length), 3500);
    return () => clearInterval(id);
  }, [samples.length]);
  const r = samples[idx];
  if (!r) return null;
  return (
    <div className="flex items-center gap-3 overflow-hidden border-b border-border bg-card/50 px-6 py-2 text-xs">
      <span className="shrink-0 rounded bg-[#1DB954]/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#1DB954]">
        Incoming
      </span>
      <span className="shrink-0 text-muted-foreground">{r.source}</span>
      <span className="shrink-0 text-muted-foreground">
        {r.rating == null ? "—" : `${r.rating}★`}
      </span>
      <span className="truncate text-foreground/90">"{r.text}"</span>
    </div>
  );
}

type Review = {
  id: string;
  source: string;
  rating: number | null;
  text: string;
  date: string | null;
  username?: string | null;
  sentiment?: string;
  topic?: string;
  pain?: string;
  goal?: string;
  behavior?: string;
  opportunity?: string;
  rootCause?: string;
  persona?: string;
  unmetNeed?: string;
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

function countField(pool: Review[], field: keyof Review, n = 20) {
  const counts: Record<string, number> = {};
  for (const r of pool) {
    const v = (r[field] as string | undefined)?.trim();
    if (!v) continue;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function sentimentMix(pool: Review[]) {
  const m: Record<string, number> = {};
  for (const r of pool) {
    const s = (r.sentiment || "Unknown").split("(")[0].trim() || "Unknown";
    m[s] = (m[s] ?? 0) + 1;
  }
  return m;
}

// ─────────────────────────── UI ───────────────────────────

type Tab = "overview" | "themes" | "explorer" | "ai";

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("overview");

  const agg = useMemo(() => aggregate(REVIEWS), []);
  const sources = useMemo(() => Object.keys(agg.bySource), [agg]);

  const now = useLiveClock();
  const liveCount = useMemo(
    () => agg.total + Math.floor((Date.now() / 60000) % 47),
    [now.getMinutes()],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-sidebar">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <SpotifyLogo className="h-10 w-10 shrink-0" />
            <div>
              <div className="font-display text-2xl leading-none">
                Spotify Review Analysis System
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1DB954] opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1DB954]"></span>
                  </span>
                  <span className="font-mono uppercase tracking-wider text-[#1DB954]">Live</span>
                </span>
                <span>{liveCount.toLocaleString()} reviews streamed</span>
                <span>· {sources.length} sources</span>
                <span className="font-mono">· {now.toLocaleTimeString()}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex rounded-md border border-border bg-card p-1 text-sm">
              {(["overview", "themes", "explorer", "ai"] as const).map((t) => (
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
        <LiveTicker />
      </header>


      <main className="mx-auto max-w-7xl px-6 py-8">
        {tab === "overview" && <Overview agg={agg} />}
        {tab === "themes" && <Themes />}
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

// ─────────────────────────── Themes (from per-review classification) ───────────────────────────

function useLivePool() {
  const total = REVIEWS.length;
  // Shuffle once so the stream order feels organic but stable per session
  const order = useMemo(() => {
    const arr = REVIEWS.map((_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, []);
  const [ingested, setIngested] = useState(() => Math.floor(total * 0.45));
  useEffect(() => {
    const id = setInterval(() => {
      setIngested((n) => {
        if (n >= total) return Math.floor(total * 0.45); // loop for continuous demo
        return Math.min(total, n + 1 + Math.floor(Math.random() * 3));
      });
    }, 1500);
    return () => clearInterval(id);
  }, [total]);
  const pool = useMemo(() => order.slice(0, ingested).map((i) => REVIEWS[i]), [order, ingested]);
  return { pool, ingested, total };
}

function Themes() {
  const { pool, ingested, total } = useLivePool();
  const topics = useMemo(() => countField(pool, "topic", 20), [pool]);
  const pains = useMemo(() => countField(pool, "pain", 20), [pool]);
  const goals = useMemo(() => countField(pool, "goal", 20), [pool]);
  const behaviors = useMemo(() => countField(pool, "behavior", 20), [pool]);
  const opportunities = useMemo(() => countField(pool, "opportunity", 20), [pool]);
  const rootCauses = useMemo(() => countField(pool, "rootCause", 20), [pool]);
  const personas = useMemo(() => countField(pool, "persona", 20), [pool]);
  const unmetNeeds = useMemo(() => countField(pool, "unmetNeed", 20), [pool]);
  const sentiment = useMemo(() => sentimentMix(pool), [pool]);
  const sentTotal = Object.values(sentiment).reduce((a, b) => a + b, 0) || 1;


  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1DB954] opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1DB954]"></span>
          </span>
          <span className="font-mono uppercase tracking-wider text-[#1DB954]">
            Live themes
          </span>
          <span className="text-muted-foreground">
            recomputing as reviews stream in
          </span>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground">
          <span>
            <strong className="text-foreground">{ingested.toLocaleString()}</strong> /{" "}
            {total.toLocaleString()} ingested
          </span>
          <div className="h-1.5 w-32 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-[#1DB954] transition-all duration-700"
              style={{ width: `${(ingested / total) * 100}%` }}
            />
          </div>
        </div>
      </div>


      <Card title="Sentiment mix" className="lg:col-span-2">
        <div className="flex h-3 w-full overflow-hidden rounded">
          {Object.entries(sentiment)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => {
              const color =
                k === "Positive"
                  ? "bg-success"
                  : k === "Negative"
                    ? "bg-danger"
                    : k === "Mixed"
                      ? "bg-warning"
                      : "bg-muted-foreground/40";
              return (
                <div
                  key={k}
                  className={color}
                  style={{ width: `${(n / sentTotal) * 100}%` }}
                  title={`${k}: ${n}`}
                />
              );
            })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {Object.entries(sentiment)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <span key={k}>
                <strong className="text-foreground">{k}</strong> {n} ·{" "}
                {((n / sentTotal) * 100).toFixed(0)}%
              </span>
            ))}
        </div>
      </Card>

      <ThemeList title="Top topics" items={topics} />
      <ThemeList title="Most common pain points" items={pains} />
      <ThemeList title="User goals" items={goals} />
      <ThemeList title="Listening behaviors" items={behaviors} />
      <ThemeList title="Root causes (why discovery fails)" items={rootCauses} />
      <ThemeList title="User personas" items={personas} />
      <ThemeList title="Unmet needs" items={unmetNeeds} />
      <ThemeList title="AI opportunity areas" items={opportunities} className="lg:col-span-2" />
    </div>
  );
}

function ThemeList({
  title,
  items,
  className = "",
}: {
  title: string;
  items: { label: string; count: number }[];
  className?: string;
}) {
  const max = items[0]?.count ?? 1;
  return (
    <Card title={title} className={className}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.label}>
              <div className="mb-1 flex items-start justify-between gap-3 text-sm">
                <span className="leading-snug">{it.label}</span>
                <span className="shrink-0 text-muted-foreground">{it.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary/70"
                  style={{ width: `${(it.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}



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

  // Full analysis state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string }>({
    done: 0,
    total: 0,
    current: "",
  });
  const [report, setReport] = useState<{
    insights: Insight[];
    summary: string;
    summaryError?: string;
  } | null>(null);

  async function analyzeQuestion(q: string, pool: Review[]): Promise<Insight> {
    const top = retrieveRelevant(q, pool, 60);
    const agg = aggregate(pool);
    const contextLines = top.map(({ review }) => {
      const tags = [
        review.sentiment && `sent:${review.sentiment}`,
        review.topic && `topic:${review.topic}`,
        review.pain && `pain:${review.pain}`,
        review.goal && `goal:${review.goal}`,
        review.behavior && `behavior:${review.behavior}`,
      ]
        .filter(Boolean)
        .join(" | ");
      return `[${review.id}] (${review.source}, ${review.rating ?? "—"}★) {${tags}} ${review.text.slice(0, 500)}`;
    });
    const system = `You are a senior product researcher analyzing user feedback for a music streaming product.
You will be given a question and a sample of real user reviews (most-relevant first), plus aggregate statistics.
Your job:
- Synthesize a clear, evidence-based answer to the question.
- Surface concrete themes, pain points, and unmet needs.
- When you make a claim, cite supporting reviews by their bracketed ID, e.g. [AS51776]. Cite 3–8 IDs total.
- If the sample is insufficient to answer, say so explicitly.
- Output well-structured markdown with short headings and bullets. No preamble.`;
    const topTopics = countField(pool, "topic", 10);
    const topPains = countField(pool, "pain", 10);
    const sentiment = sentimentMix(pool);
    const user = `Question: ${q}

Dataset scope: ${agg.total} reviews across ${Object.keys(agg.bySource).join(", ")}.
Rating distribution: ${JSON.stringify(agg.byRating)}.
Avg rating by source: ${JSON.stringify(agg.avgBySource)}.
Sentiment mix: ${JSON.stringify(sentiment)}.
Top topics (pre-classified): ${topTopics.map((t) => `${t.label} (${t.count})`).join("; ")}.
Top pain points (pre-classified): ${topPains.map((t) => `${t.label} (${t.count})`).join("; ")}.

Most relevant reviews (id, source, rating, {classification tags}, text):
${contextLines.join("\n")}`;
    try {
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
        new Set((answer.match(/\[([A-Za-z0-9\-]{4,})\]/g) ?? []).map((m) => m.slice(1, -1))),
      );
      return {
        question: q,
        answer: answer || "(empty response)",
        citedIds: cited,
        contextSize: top.length,
      };
    } catch (e) {
      return {
        question: q,
        answer: "",
        citedIds: [],
        contextSize: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async function ask(q: string) {
    if (!q.trim() || loading || running) return;
    setLoading(true);
    setInsight(null);
    const pool = filterSource ? REVIEWS.filter((r) => r.source === filterSource) : REVIEWS;
    const ins = await analyzeQuestion(q, pool);
    setInsight(ins);
    setLoading(false);
  }

  async function runFullAnalysis() {
    if (running || loading) return;
    setRunning(true);
    setReport(null);
    setInsight(null);
    const pool = filterSource ? REVIEWS.filter((r) => r.source === filterSource) : REVIEWS;
    const insights: Insight[] = [];
    setProgress({ done: 0, total: SUGGESTED_QUESTIONS.length + 1, current: SUGGESTED_QUESTIONS[0] });
    for (let i = 0; i < SUGGESTED_QUESTIONS.length; i++) {
      const q = SUGGESTED_QUESTIONS[i];
      setProgress({ done: i, total: SUGGESTED_QUESTIONS.length + 1, current: q });
      const ins = await analyzeQuestion(q, pool);
      insights.push(ins);
      // partial render so user sees progress
      setReport({ insights: [...insights], summary: "" });
    }

    // Executive summary pass
    setProgress({
      done: SUGGESTED_QUESTIONS.length,
      total: SUGGESTED_QUESTIONS.length + 1,
      current: "Synthesizing executive summary",
    });
    const summaryUser = `You previously answered these research questions over the same review dataset.
Synthesize a concise executive summary (markdown) with:
- **Top themes** (3–5 bullets)
- **Most acute pain points** (3–5 bullets)
- **Unmet needs / opportunities** (3–5 bullets)
- **Recommended next research** (2–3 bullets)
Reference review IDs in [BRACKETS] only when they directly support a point. No preamble.

---
${insights
  .map(
    (ins) => `### ${ins.question}
${ins.error ? `(error: ${ins.error})` : ins.answer}`,
  )
  .join("\n\n")}`;
    let summary = "";
    let summaryError: string | undefined;
    try {
      const res = await chatCompletion({
        messages: [
          {
            role: "system",
            content:
              "You are a senior product researcher producing a tight executive summary from prior analyses. Be specific and concrete.",
          },
          { role: "user", content: summaryUser },
        ],
        max_tokens: 1500,
        temperature: 0.3,
      });
      summary = res?.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      summaryError = e instanceof Error ? e.message : String(e);
    }
    setReport({ insights, summary, summaryError });
    setProgress({
      done: SUGGESTED_QUESTIONS.length + 1,
      total: SUGGESTED_QUESTIONS.length + 1,
      current: "Done",
    });
    setRunning(false);
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
              disabled={running}
              className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
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
              disabled={running}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              onClick={() => ask(question)}
              disabled={loading || running || !question.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
            <button
              onClick={runFullAnalysis}
              disabled={loading || running}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
            >
              {running ? "Running full analysis…" : "Run Full Analysis"}
            </button>
            <p className="text-xs text-muted-foreground">
              Runs all {SUGGESTED_QUESTIONS.length} core questions sequentially, then synthesizes an
              executive summary.
            </p>
          </div>
          {running && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>{progress.current}</span>
                <span>
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {insight && !report && <InsightCard insight={insight} />}

        {report && (
          <div className="space-y-4">
            {(report.summary || report.summaryError) && (
              <div className="rounded-xl border border-accent/40 bg-accent/5 p-5">
                <div className="mb-2 text-xs uppercase tracking-wide text-accent">
                  Executive summary
                </div>
                {report.summaryError ? (
                  <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                    {report.summaryError}
                  </div>
                ) : (
                  <Markdownish text={report.summary} />
                )}
              </div>
            )}
            {report.insights.map((ins, i) => (
              <InsightCard key={i} insight={ins} index={i + 1} />
            ))}
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-3 font-display text-base">Core questions</h3>
          <div className="space-y-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuestion(q);
                  ask(q);
                }}
                disabled={loading || running}
                className="block w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary/60 hover:text-foreground disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">How it works</div>
          Each question retrieves the top ~60 most-relevant reviews from {REVIEWS.length} total and
          sends them to claude-sonnet-4 via OpenRouter. Full Analysis runs all core questions and
          adds an executive summary across them.
        </div>
      </aside>
    </div>
  );
}

function InsightCard({ insight, index }: { insight: Insight; index?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-2 text-xs text-muted-foreground">
        {index ? `Q${index} · ` : "Q · "}
        {insight.question}
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
            <details className="mt-5 border-t border-border pt-4">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground">
                Cited reviews ({insight.citedIds.length})
              </summary>
              <div className="mt-3 space-y-2">
                {insight.citedIds.map((id) => {
                  const r = REVIEWS.find((x) => x.id === id);
                  if (!r) return null;
                  return <ReviewCard key={id} review={r} />;
                })}
              </div>
            </details>
          )}
        </>
      )}
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
