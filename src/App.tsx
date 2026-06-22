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
  sentiment?: string;
  topic?: string;
  pain?: string;
  goal?: string;
  behavior?: string;
  opportunity?: string;
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
    return pool.slice(0, k).map((r) => ({ review: r, score: 0 }));
  }
  const scored: Scored[] = pool.map((r) => {
    const text = r.text.toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      let idx = 0;
      while ((idx = text.indexOf(t, idx)) !== -1) {
        score += 1;
        idx += t.length;
      }
    }
    if (r.rating !== null && r.rating <= 2) score *= 1.05;
    return { review: r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((s) => s.score > 0).slice(0, k);
  if (top.length >= 10) return top;
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

function topKeywords(pool: Review[], n = 30) {
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

// Source palette mapping
const SOURCE_META: Record<string, { color: string; bg: string; label: string; initial: string }> = {
  "App Store": { color: "text-source-appstore", bg: "bg-source-appstore", label: "App Store", initial: "" },
  "Google Play": { color: "text-source-play", bg: "bg-source-play", label: "Google Play", initial: "" },
  "YouTube": { color: "text-source-youtube", bg: "bg-source-youtube", label: "YouTube", initial: "" },
  "Social Media (X)": { color: "text-source-social", bg: "bg-source-social", label: "X / Social", initial: "X" },
};
function sourceMeta(s: string) {
  return SOURCE_META[s] ?? { color: "text-muted-foreground", bg: "bg-muted-foreground", label: s, initial: "" };
}

const SENTIMENT_TONE: Record<string, { dot: string; text: string; bg: string }> = {
  Positive: { dot: "bg-success", text: "text-success", bg: "bg-success/15" },
  Negative: { dot: "bg-danger", text: "text-danger", bg: "bg-danger/15" },
  Mixed: { dot: "bg-warning", text: "text-warning", bg: "bg-warning/15" },
  Neutral: { dot: "bg-muted-foreground", text: "text-muted-foreground", bg: "bg-muted" },
  Unknown: { dot: "bg-muted-foreground/40", text: "text-muted-foreground", bg: "bg-muted" },
};

// ─────────────────────────── App shell ───────────────────────────

type Tab = "overview" | "themes" | "explorer" | "ai";

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: "overview", label: "Overview", desc: "Volume, ratings, vocabulary" },
  { id: "themes", label: "Themes", desc: "Pre-classified dimensions" },
  { id: "explorer", label: "Explorer", desc: "Search & filter reviews" },
  { id: "ai", label: "AI Insights", desc: "Ask grounded questions" },
];

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("overview");
  const agg = useMemo(() => aggregate(REVIEWS), []);
  const sources = useMemo(() => Object.keys(agg.bySource), [agg]);
  const sentiment = useMemo(() => sentimentMix(REVIEWS), []);
  const negPct = Math.round(((sentiment["Negative"] ?? 0) / REVIEWS.length) * 100);
  const topTopic = useMemo(() => countField(REVIEWS, "topic", 1)[0], []);

  return (
    <div className="relative min-h-screen text-foreground">
      <div className="pointer-events-none fixed inset-0 grid-overlay" aria-hidden />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1400px] gap-8 px-6 py-8 lg:flex-row">
        <Sidebar tab={tab} setTab={setTab} theme={theme} toggle={toggleTheme} />
        <main className="flex-1 space-y-8 pb-12">
          <TopHero agg={agg} negPct={negPct} topTopic={topTopic?.label} sentiment={sentiment} />
          {tab === "overview" && <Overview agg={agg} />}
          {tab === "themes" && <Themes />}
          {tab === "explorer" && <Explorer sources={sources} />}
          {tab === "ai" && <AIInsights sources={sources} />}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  tab,
  setTab,
  theme,
  toggle,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  theme: string;
  toggle: () => void;
}) {
  return (
    <aside className="sticky top-8 hidden h-[calc(100vh-4rem)] w-64 shrink-0 flex-col justify-between rounded-2xl border border-border bg-sidebar/80 p-5 backdrop-blur lg:flex">
      <div>
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-glow">
            <span className="font-display text-lg font-semibold text-primary-foreground">R</span>
            <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-sidebar bg-accent" />
          </div>
          <div>
            <div className="font-display text-base leading-tight">Review</div>
            <div className="font-display text-base leading-tight text-muted-foreground">
              Intelligence
            </div>
          </div>
        </div>

        <div className="mt-6 chip">
          <span className="pulse-dot" />
          {REVIEWS.length.toLocaleString()} reviews indexed
        </div>

        <nav className="mt-8 space-y-1">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`group w-full rounded-xl border px-3 py-2.5 text-left transition ${
                  active
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground"
                }`}
              >
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>{t.label}</span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full transition ${
                      active ? "bg-primary" : "bg-transparent group-hover:bg-border-strong"
                    }`}
                  />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground/80">{t.desc}</div>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-3">
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <span>Theme</span>
          <span className="font-mono uppercase tracking-wider">
            {theme === "dark" ? "Dark" : "Light"}
          </span>
        </button>
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">claude-sonnet-4</span> via OpenRouter ·
          client-side retrieval over the corpus.
        </div>
      </div>
    </aside>
  );
}

function TopHero({
  agg,
  negPct,
  topTopic,
  sentiment,
}: {
  agg: ReturnType<typeof aggregate>;
  negPct: number;
  topTopic?: string;
  sentiment: Record<string, number>;
}) {
  const sources = Object.keys(agg.bySource);
  return (
    <header className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="chip mb-3 w-fit">
            <span className="pulse-dot" />
            Multi-source feedback intelligence
          </div>
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight md:text-5xl">
            Listen to <span className="italic text-primary-glow">every review</span>,
            <br className="hidden md:block" /> answer the questions that matter.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            {agg.total.toLocaleString()} reviews from {sources.length} channels — pre-classified
            across sentiment, topic, pain points, user goals, listening behavior, and product
            opportunities.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:hidden">
          {/* mobile nav is handled by Sidebar on desktop; surface a compact selector here */}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat
          label="Total reviews"
          value={agg.total.toLocaleString()}
          hint={`${sources.length} sources`}
        />
        <Stat
          label="Negative share"
          value={`${negPct}%`}
          hint={`${sentiment["Negative"] ?? 0} reviews`}
          tone="danger"
        />
        <Stat
          label="Positive share"
          value={`${Math.round(((sentiment["Positive"] ?? 0) / agg.total) * 100)}%`}
          hint={`${sentiment["Positive"] ?? 0} reviews`}
          tone="success"
        />
        <Stat
          label="Top topic"
          value={topTopic ?? "—"}
          hint="most-tagged across corpus"
          tone="primary"
          small
        />
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
  small = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "success" | "primary";
  small?: boolean;
}) {
  const ring =
    tone === "danger"
      ? "from-danger/40 to-transparent"
      : tone === "success"
        ? "from-success/40 to-transparent"
        : tone === "primary"
          ? "from-primary/40 to-transparent"
          : "from-border-strong/60 to-transparent";
  return (
    <div className="panel relative overflow-hidden p-4">
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${ring}`} />
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div
        className={`mt-2 font-display tracking-tight ${
          small ? "text-lg leading-snug" : "text-3xl leading-none"
        } text-foreground`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ─────────────────────────── Overview ───────────────────────────

function Overview({ agg }: { agg: ReturnType<typeof aggregate> }) {
  const keywords = useMemo(() => topKeywords(REVIEWS, 32), []);
  const maxKw = keywords[0]?.count ?? 1;
  const sourceMax = Math.max(...Object.values(agg.bySource));
  const ratingOrder = ["5", "4", "3", "2", "1", "n/a"];

  return (
    <section className="grid gap-6 lg:grid-cols-3">
      <Panel title="Reviews by source" subtitle="Volume & average rating" className="lg:col-span-2">
        <div className="space-y-4">
          {Object.entries(agg.bySource)
            .sort((a, b) => b[1] - a[1])
            .map(([source, n]) => {
              const meta = sourceMeta(source);
              return (
                <div key={source}>
                  <div className="mb-1.5 flex items-center gap-3 text-sm">
                    <SourceDot source={source} />
                    <span className="font-medium">{meta.label}</span>
                    <span className="ml-auto text-muted-foreground">
                      {n.toLocaleString()} ·{" "}
                      <span className="text-foreground">
                        {agg.avgBySource[source] ? `${agg.avgBySource[source]}★` : "—"}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${meta.bg} opacity-90`}
                      style={{ width: `${(n / sourceMax) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </Panel>

      <Panel title="Rating distribution" subtitle="Across the entire corpus">
        <div className="space-y-2">
          {ratingOrder.map((k) => {
            const n = agg.byRating[k] ?? 0;
            const pct = (n / agg.total) * 100;
            const tone =
              k === "5" || k === "4"
                ? "bg-success"
                : k === "3"
                  ? "bg-warning"
                  : k === "n/a"
                    ? "bg-muted-foreground/40"
                    : "bg-danger";
            return (
              <div key={k} className="flex items-center gap-3 text-sm">
                <span className="w-8 font-mono text-xs text-muted-foreground">
                  {k === "n/a" ? "—" : `${k}★`}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-12 text-right font-mono text-xs text-muted-foreground">
                  {n}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Vocabulary heatmap"
        subtitle="High-frequency terms, sized by document frequency"
        className="lg:col-span-3"
      >
        <div className="flex flex-wrap gap-2">
          {keywords.map((k) => {
            const scale = 0.78 + (k.count / maxKw) * 0.9;
            const intensity = 0.35 + (k.count / maxKw) * 0.55;
            return (
              <span
                key={k.term}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-foreground transition hover:border-primary/40"
                style={{
                  fontSize: `${scale}rem`,
                  background: `color-mix(in oklch, var(--color-primary) ${intensity * 12}%, var(--color-card))`,
                }}
                title={`${k.count} reviews mention "${k.term}"`}
              >
                {k.term}{" "}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{k.count}</span>
              </span>
            );
          })}
        </div>
      </Panel>
    </section>
  );
}

function Panel({
  title,
  subtitle,
  children,
  className = "",
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`panel p-5 ${className}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg leading-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function SourceDot({ source }: { source: string }) {
  const m = sourceMeta(source);
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${m.bg}/20 ring-1 ring-inset ring-current/30 ${m.color}`}
      aria-hidden
    >
      <span className={`h-2 w-2 rounded-sm ${m.bg}`} />
    </span>
  );
}

// ─────────────────────────── Themes ───────────────────────────

function Themes() {
  const topics = useMemo(() => countField(REVIEWS, "topic", 18), []);
  const pains = useMemo(() => countField(REVIEWS, "pain", 18), []);
  const goals = useMemo(() => countField(REVIEWS, "goal", 18), []);
  const behaviors = useMemo(() => countField(REVIEWS, "behavior", 18), []);
  const opportunities = useMemo(() => countField(REVIEWS, "opportunity", 14), []);
  const sentiment = useMemo(() => sentimentMix(REVIEWS), []);
  const sentTotal = Object.values(sentiment).reduce((a, b) => a + b, 0) || 1;
  const sentOrder = ["Positive", "Mixed", "Neutral", "Negative", "Unknown"];

  return (
    <section className="space-y-6">
      <Panel
        title="Sentiment mix"
        subtitle="Classified per review across the full corpus"
      >
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          {sentOrder
            .filter((k) => sentiment[k])
            .map((k) => {
              const t = SENTIMENT_TONE[k] ?? SENTIMENT_TONE.Unknown;
              return (
                <div
                  key={k}
                  className={t.dot}
                  style={{ width: `${(sentiment[k] / sentTotal) * 100}%` }}
                  title={`${k}: ${sentiment[k]}`}
                />
              );
            })}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-5">
          {sentOrder
            .filter((k) => sentiment[k])
            .map((k) => {
              const t = SENTIMENT_TONE[k] ?? SENTIMENT_TONE.Unknown;
              const pct = ((sentiment[k] / sentTotal) * 100).toFixed(0);
              return (
                <div
                  key={k}
                  className={`flex items-center gap-2 rounded-lg ${t.bg} px-3 py-2 text-xs`}
                >
                  <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                  <span className={`font-medium ${t.text}`}>{k}</span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    {sentiment[k]} · {pct}%
                  </span>
                </div>
              );
            })}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <ThemeList title="Top topics" subtitle="What reviewers talk about" items={topics} accent="primary" />
        <ThemeList
          title="Most common pain points"
          subtitle="Concrete frustrations surfaced"
          items={pains}
          accent="danger"
        />
        <ThemeList
          title="User goals"
          subtitle="What people are trying to accomplish"
          items={goals}
          accent="accent"
        />
        <ThemeList
          title="Listening behaviors"
          subtitle="Observed or implied usage patterns"
          items={behaviors}
          accent="success"
        />
      </div>

      <ThemeList
        title="Suggested opportunities"
        subtitle="Product moves implied by reviewer feedback"
        items={opportunities}
        accent="primary"
      />
    </section>
  );
}

function ThemeList({
  title,
  subtitle,
  items,
  accent = "primary",
}: {
  title: string;
  subtitle?: string;
  items: { label: string; count: number }[];
  accent?: "primary" | "danger" | "success" | "accent";
}) {
  const max = items[0]?.count ?? 1;
  const accentBg =
    accent === "danger"
      ? "bg-danger/70"
      : accent === "success"
        ? "bg-success/70"
        : accent === "accent"
          ? "bg-accent/70"
          : "bg-primary/70";
  return (
    <Panel title={title} subtitle={subtitle}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((it) => (
            <div key={it.label} className="group">
              <div className="mb-1 flex items-start justify-between gap-3 text-sm">
                <span className="leading-snug text-foreground">{it.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{it.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${accentBg} transition-all group-hover:opacity-100`}
                  style={{ width: `${(it.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─────────────────────────── Explorer ───────────────────────────

function Explorer({ sources }: { sources: string[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>("");
  const [rating, setRating] = useState<string>("");
  const [limit, setLimit] = useState(40);

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
    <section className="space-y-5">
      <Panel
        title="Explore the corpus"
        subtitle="Search the raw reviews, filter by channel or rating"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
              /
            </span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(40);
              }}
              placeholder="Search reviews…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 pl-7 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={source === ""}
              onClick={() => setSource("")}
              label="All sources"
            />
            {sources.map((s) => {
              const m = sourceMeta(s);
              return (
                <FilterChip
                  key={s}
                  active={source === s}
                  onClick={() => setSource(source === s ? "" : s)}
                  label={m.label}
                  dotClass={m.bg}
                />
              );
            })}
          </div>
          <div className="flex gap-1">
            {["5", "4", "3", "2", "1"].map((r) => (
              <button
                key={r}
                onClick={() => setRating(rating === r ? "" : r)}
                className={`h-8 w-9 rounded-md border text-xs font-mono transition ${
                  rating === r
                    ? "border-primary/50 bg-primary/15 text-foreground"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                {r}★
              </button>
            ))}
          </div>
          <span className="ml-auto chip">
            <span className="pulse-dot" />
            {filtered.length.toLocaleString()} matches
          </span>
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.slice(0, limit).map((r) => (
          <ReviewCard key={r.id} review={r} highlight={query} />
        ))}
      </div>

      {filtered.length > limit && (
        <button
          onClick={() => setLimit((n) => n + 40)}
          className="block w-full rounded-xl border border-border bg-card py-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          Load 40 more · {filtered.length - limit} remaining
        </button>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  dotClass,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dotClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? "border-primary/50 bg-primary/15 text-foreground"
          : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
      }`}
    >
      {dotClass && <span className={`h-2 w-2 rounded-full ${dotClass}`} />}
      {label}
    </button>
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
        <mark key={i} className="bg-primary/25 text-foreground">
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
  const sent = (review.sentiment || "Unknown").split("(")[0].trim() || "Unknown";
  const sentTone = SENTIMENT_TONE[sent] ?? SENTIMENT_TONE.Unknown;

  return (
    <article className="panel flex flex-col gap-3 p-4 text-sm transition hover:border-primary/30">
      <header className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <SourceDot source={review.source} />
        <span className="font-medium text-foreground">{sourceMeta(review.source).label}</span>
        <span className={`font-mono ${ratingColor}`}>
          {review.rating == null ? "—" : `${review.rating}★`}
        </span>
        <span className={`chip ${sentTone.bg} ${sentTone.text} border-transparent`}>
          <span className={`h-1.5 w-1.5 rounded-full ${sentTone.dot}`} />
          {sent}
        </span>
        {review.date && <span className="text-[11px] opacity-70">{review.date.slice(0, 10)}</span>}
        <span className="ml-auto font-mono text-[10px] opacity-60">{review.id}</span>
      </header>
      <p className="leading-relaxed text-foreground/95">{body}</p>
      {(review.topic || review.pain) && (
        <footer className="flex flex-wrap gap-1.5 border-t border-border pt-2 text-[11px]">
          {review.topic && <span className="chip">topic · {review.topic}</span>}
          {review.pain && (
            <span className="chip border-danger/30 bg-danger/10 text-danger">pain · {review.pain}</span>
          )}
          {review.goal && <span className="chip">goal · {review.goal}</span>}
        </footer>
      )}
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
    setReport(null);
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
      setReport({ insights: [...insights], summary: "" });
    }

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
    <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <Panel
          title="Ask the reviews"
          subtitle="Natural-language research grounded in the corpus, with [ID] citations"
          action={
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              disabled={running}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          }
        >
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(question);
                }}
                placeholder="e.g. What causes users to repeatedly listen to the same content?"
                disabled={running}
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              />
              <span className="absolute bottom-2 right-3 font-mono text-[10px] text-muted-foreground">
                ⌘↵ to analyze
              </span>
            </div>
            <div className="flex gap-2 md:flex-col">
              <button
                onClick={() => ask(question)}
                disabled={loading || running || !question.trim()}
                className="flex-1 rounded-xl bg-gradient-to-br from-primary to-primary-glow px-5 py-3 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:shadow-primary/40 disabled:opacity-50"
              >
                {loading ? "Analyzing…" : "Analyze"}
              </button>
              <button
                onClick={runFullAnalysis}
                disabled={loading || running}
                className="flex-1 rounded-xl border border-accent/40 bg-accent/10 px-5 py-3 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                {running ? "Running…" : "Full Analysis"}
              </button>
            </div>
          </div>
          {running && (
            <div className="mt-4">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span className="truncate pr-3">{progress.current}</span>
                <span className="font-mono">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </Panel>

        {insight && !report && <InsightCard insight={insight} />}

        {report && (
          <div className="space-y-5">
            {(report.summary || report.summaryError) && (
              <div className="panel panel-glow p-6">
                <div className="mb-3 flex items-center gap-2">
                  <span className="pulse-dot" />
                  <span className="text-[11px] uppercase tracking-[0.18em] text-primary-glow">
                    Executive summary
                  </span>
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
        <Panel title="Core research questions" subtitle="Click to run a single analysis">
          <div className="space-y-2">
            {SUGGESTED_QUESTIONS.map((q, i) => (
              <button
                key={q}
                onClick={() => {
                  setQuestion(q);
                  ask(q);
                }}
                disabled={loading || running}
                className="group block w-full rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:opacity-50"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 font-mono text-[10px] text-primary/70">
                    Q{String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="leading-snug group-hover:text-foreground">{q}</span>
                </div>
              </button>
            ))}
          </div>
        </Panel>
        <div className="panel p-4 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">How it works</div>
          Each question retrieves the top ~60 most-relevant reviews from {REVIEWS.length} total and
          sends them to claude-sonnet-4 with their classification tags. Full Analysis runs all core
          questions and synthesizes an executive summary.
        </div>
      </aside>
    </section>
  );
}

function InsightCard({ insight, index }: { insight: Insight; index?: number }) {
  return (
    <div className="panel p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-primary">
          {index ? `Q${String(index).padStart(2, "0")}` : "Q"}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="font-medium text-foreground">{insight.question}</span>
        {insight.contextSize > 0 && (
          <span className="ml-auto chip">{insight.contextSize} reviews in context</span>
        )}
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
              <div className="mt-3 grid gap-2 md:grid-cols-2">
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

// Minimal markdown-ish renderer
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
            : "font-medium mt-3 mb-1 text-foreground";
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
          className="rounded bg-primary/15 px-1.5 font-mono text-[11px] text-primary"
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

void useEffect;
