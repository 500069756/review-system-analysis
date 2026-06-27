import { useEffect, useMemo, useState } from "react";
import { claudeMessage, extractJson } from "@/lib/claude";

type Familiarity = "FAMILIAR" | "DISCOVERY";
type Track = {
  id: string;
  title: string;
  artist: string;
  genre: string;
  energy: number;
  familiarity: Familiarity;
  reason: string;
  duration: string;
};
type SessionData = {
  sessionSummary: string;
  sessionMood: string;
  tracks: Track[];
};
type Screen = "input" | "loading" | "reveal" | "session" | "refining" | "saved";
type Reaction = "loved" | "rejected" | null;

const MOOD_CHIPS = [
  "Post-work wind-down",
  "Gym session",
  "Late night drive",
  "Morning focus",
  "Weekend chill",
  "Feeling nostalgic",
];

const SESSION_SYSTEM = `You are a music discovery engine. Given a user's current mood or activity, you will:
1. Interpret what emotional state and energy level they are in
2. Identify what kind of music would match this moment AND gently stretch their taste
3. Generate exactly 6 track recommendations (mix of familiar-sounding and genuinely new)
4. For each track provide: title, artist, genre, energy (1-10), familiarity tag (FAMILIAR or DISCOVERY), and a single plain-English reason why this track fits this moment (max 15 words)
5. Also write a 2-sentence session summary explaining what kind of session you built and why

Respond ONLY in this exact JSON format, no markdown, no preamble:
{
  "sessionSummary": "Two sentence explanation of this session",
  "sessionMood": "3-word mood label e.g. Calm But Curious",
  "tracks": [
    {
      "id": "1",
      "title": "Track Title",
      "artist": "Artist Name",
      "genre": "Genre",
      "energy": 6,
      "familiarity": "FAMILIAR",
      "reason": "Plain English reason max 15 words",
      "duration": "3:42"
    }
  ]
}`;

const REFINE_SYSTEM = `You are a music discovery engine refining a session based on user feedback. Respond ONLY in JSON, no markdown, no preamble.`;

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

function LoadingState({ messages }: { messages: string[] }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (idx >= messages.length - 1) return;
    const t = setTimeout(() => setIdx((i) => i + 1), 1200);
    return () => clearTimeout(t);
  }, [idx, messages.length]);
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24">
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full border-2 border-[#1DB954]/20" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[#1DB954]" />
      </div>
      <div className="text-lg text-white transition-opacity duration-500" key={idx}>
        {messages[idx]}
      </div>
    </div>
  );
}

function EnergyBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(10, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#2a2a2a]">
        <div className="h-full rounded-full bg-[#1DB954]" style={{ width: `${v * 10}%` }} />
      </div>
      <span className="font-mono text-xs text-[#B3B3B3]">{v}/10</span>
    </div>
  );
}

function TrackCard({
  track,
  reaction,
  onReact,
  isNew,
}: {
  track: Track;
  reaction: Reaction;
  onReact: (r: Reaction) => void;
  isNew?: boolean;
}) {
  const borderClass =
    reaction === "loved"
      ? "border-[#1DB954] shadow-[0_0_24px_-4px_rgba(29,185,84,0.5)]"
      : reaction === "rejected"
        ? "border-red-500/60"
        : "border-white/5";
  return (
    <div
      className={`rounded-xl border-2 bg-[#1E1E1E] p-5 transition-all duration-300 ${borderClass} ${isNew ? "animate-in fade-in slide-in-from-bottom-3 duration-500" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-white">{track.title}</h3>
          <p className="truncate text-sm text-[#B3B3B3]">{track.artist}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${
            track.familiarity === "DISCOVERY"
              ? "bg-[#1DB954] text-black"
              : "bg-[#2a2a2a] text-[#B3B3B3]"
          }`}
        >
          {track.familiarity}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="rounded-full bg-[#2a2a2a] px-2 py-0.5 text-[11px] text-[#B3B3B3]">
          {track.genre}
        </span>
        <span className="font-mono text-[11px] text-[#B3B3B3]">{track.duration}</span>
      </div>

      <div className="mt-3">
        <EnergyBar value={track.energy} />
      </div>

      <p className="mt-3 text-sm italic text-[#B3B3B3]">"{track.reason}"</p>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onReact(reaction === "loved" ? null : "loved")}
          className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
            reaction === "loved"
              ? "bg-[#1DB954] text-black"
              : "border border-white/10 text-white hover:border-[#1DB954]/50"
          }`}
        >
          ♥ Love it
        </button>
        <button
          onClick={() => onReact(reaction === "rejected" ? null : "rejected")}
          className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
            reaction === "rejected"
              ? "bg-red-500/30 text-red-200 border border-red-500/60"
              : "border border-white/10 text-white hover:border-red-500/40"
          }`}
        >
          ✕ Not quite
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("input");
  const [context, setContext] = useState("");
  const [contextError, setContextError] = useState("");
  const [session, setSession] = useState<SessionData | null>(null);
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});
  const [newTrackIds, setNewTrackIds] = useState<Set<string>>(new Set());
  const [refinementNote, setRefinementNote] = useState("");
  const [error, setError] = useState("");

  const reactedCount = useMemo(
    () => Object.values(reactions).filter((r) => r !== null).length,
    [reactions],
  );

  async function buildSession() {
    if (!context.trim()) {
      setContextError("Tell us your moment to build your session");
      return;
    }
    setContextError("");
    setError("");
    setScreen("loading");
    try {
      const text = await claudeMessage({
        system: SESSION_SYSTEM,
        messages: [{ role: "user", content: context.trim() }],
        max_tokens: 1500,
      });
      const data = extractJson<SessionData>(text);
      if (!data?.tracks?.length) throw new Error("Empty session");
      setSession(data);
      setReactions({});
      setNewTrackIds(new Set());
      setRefinementNote("");
      setScreen("reveal");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setScreen("input");
    }
  }

  async function refineSession() {
    if (!session) return;
    const loved = session.tracks.filter((t) => reactions[t.id] === "loved");
    const rejected = session.tracks.filter((t) => reactions[t.id] === "rejected");
    setScreen("refining");
    try {
      const userMsg = `Original context: ${context}
Original session mood: ${session.sessionMood}
Tracks the user loved: ${loved.map((t) => `"${t.title}" by ${t.artist}`).join(", ") || "(none)"}
Tracks the user rejected: ${rejected.map((t) => `"${t.title}" by ${t.artist}`).join(", ") || "(none)"}

Based on this feedback, generate ${Math.max(rejected.length, 3)} NEW replacement tracks for the rejected ones. Adjust the session direction based on what the user responded to.

Respond ONLY in this JSON format (no markdown, no preamble):
{
  "refinementNote": "One sentence: what I adjusted based on your reactions",
  "tracks": [
    { "id": "r1", "title": "...", "artist": "...", "genre": "...", "energy": 6, "familiarity": "DISCOVERY", "reason": "...", "duration": "3:42" }
  ]
}`;
      const text = await claudeMessage({
        system: REFINE_SYSTEM,
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 1200,
      });
      const data = extractJson<{ refinementNote: string; tracks: Track[] }>(text);
      const replacementsNeeded = rejected.length;
      const fresh = (data.tracks || []).slice(0, Math.max(replacementsNeeded, 1)).map((t, i) => ({
        ...t,
        id: `new-${Date.now()}-${i}`,
      }));

      // Build new track list: keep loved + neutral, replace rejected
      const kept = session.tracks.filter((t) => reactions[t.id] !== "rejected");
      const merged = [...kept];
      // Replace rejected slots with fresh
      fresh.forEach((f) => merged.push(f));

      const newIds = new Set(fresh.map((f) => f.id));
      setSession({ ...session, tracks: merged });
      setNewTrackIds(newIds);
      setRefinementNote(data.refinementNote || "Adjusted based on your reactions.");
      // Clear reactions on rejected (since gone), keep loved
      const nextReactions: Record<string, Reaction> = {};
      for (const t of merged) {
        nextReactions[t.id] = reactions[t.id] === "loved" ? "loved" : null;
      }
      setReactions(nextReactions);
      setScreen("session");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refinement failed");
      setScreen("session");
    }
  }

  function reset() {
    setScreen("input");
    setContext("");
    setSession(null);
    setReactions({});
    setNewTrackIds(new Set());
    setRefinementNote("");
    setError("");
  }

  const familiarCount = session?.tracks.filter((t) => t.familiarity === "FAMILIAR").length ?? 0;
  const discoveryCount = session?.tracks.filter((t) => t.familiarity === "DISCOVERY").length ?? 0;

  return (
    <div className="min-h-screen bg-[#121212] text-white" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <header className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-6">
        <SpotifyLogo className="h-8 w-8" />
        <div>
          <div className="text-sm font-semibold tracking-tight">Spotify</div>
          <div className="text-xs text-[#B3B3B3]">Context-First Discovery Mode</div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        {/* SCREEN 1 */}
        {screen === "input" && (
          <section className="animate-in fade-in duration-300">
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
              What's your moment right now?
            </h1>
            <p className="mt-3 text-[#B3B3B3]">
              Tell us where you are. We'll build a session for this exact moment — not your listening history.
            </p>

            <textarea
              value={context}
              onChange={(e) => {
                setContext(e.target.value);
                if (contextError) setContextError("");
              }}
              placeholder="e.g. winding down after a long day, need something calm but not boring"
              className="mt-8 min-h-[110px] w-full resize-none rounded-xl border border-white/10 bg-[#1E1E1E] p-4 text-white placeholder:text-[#6a6a6a] focus:border-[#1DB954] focus:outline-none"
            />
            {contextError && (
              <p className="mt-2 text-sm text-red-400">{contextError}</p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {MOOD_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => setContext(chip)}
                  className="rounded-full border border-[#1DB954]/40 px-4 py-1.5 text-sm text-white transition-colors hover:bg-[#1DB954]/10"
                >
                  {chip}
                </button>
              ))}
            </div>

            {error && (
              <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                Having trouble reading your moment — {error}
              </div>
            )}

            <button
              onClick={buildSession}
              className="mt-8 rounded-full bg-[#1DB954] px-8 py-3 font-semibold text-black transition-transform hover:scale-[1.02]"
            >
              Build my session →
            </button>
          </section>
        )}

        {/* SCREEN 2a */}
        {screen === "loading" && (
          <LoadingState
            messages={["Reading your moment...", "Finding your edge...", "Building your session..."]}
          />
        )}

        {/* SCREEN 2b */}
        {screen === "reveal" && session && (
          <section className="animate-in fade-in duration-500 py-12 text-center">
            <div className="text-xs uppercase tracking-[0.3em] text-[#B3B3B3]">Your session mood</div>
            <h1 className="mt-3 text-5xl font-bold tracking-tight text-[#1DB954] md:text-6xl">
              {session.sessionMood}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg italic text-white/90">
              {session.sessionSummary}
            </p>
            <div className="mx-auto mt-10 max-w-xl rounded-lg border border-white/5 bg-[#1E1E1E] p-4 text-sm text-[#B3B3B3]">
              Traditional recommendations would show you more of what you've already played.
              This session was built for where you are <span className="text-white">right now</span>.
            </div>
            <button
              onClick={() => setScreen("session")}
              className="mt-10 rounded-full bg-[#1DB954] px-8 py-3 font-semibold text-black transition-transform hover:scale-[1.02]"
            >
              Start session →
            </button>
          </section>
        )}

        {/* SCREEN 3 */}
        {screen === "session" && session && (
          <section className="animate-in fade-in duration-300">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-[#B3B3B3]">Now playing session</div>
                <h1 className="mt-1 text-3xl font-bold text-[#1DB954] md:text-4xl">
                  {session.sessionMood}
                </h1>
                <p className="mt-1 text-sm text-[#B3B3B3]">
                  {familiarCount} familiar · {discoveryCount} discovery tracks · AI-curated for your moment
                </p>
              </div>
            </div>

            {refinementNote && (
              <div className="mt-6 rounded-lg border border-[#1DB954]/40 bg-[#1DB954]/10 p-4 text-sm text-white">
                <span className="font-semibold text-[#1DB954]">Claude adjusted:</span>{" "}
                {refinementNote}
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {session.tracks.map((t) => (
                <TrackCard
                  key={t.id}
                  track={t}
                  reaction={reactions[t.id] ?? null}
                  isNew={newTrackIds.has(t.id)}
                  onReact={(r) => setReactions((prev) => ({ ...prev, [t.id]: r }))}
                />
              ))}
            </div>

            {refinementNote && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={() => setScreen("saved")}
                  className="rounded-full bg-[#1DB954] px-8 py-3 font-semibold text-black transition-transform hover:scale-[1.02]"
                >
                  Save this session
                </button>
              </div>
            )}

            {reactedCount >= 2 && !refinementNote && (
              <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#181818]/95 px-6 py-4 backdrop-blur">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-[#B3B3B3]">
                    <span className="text-white">Claude is learning from your reactions</span> →
                  </div>
                  <button
                    onClick={refineSession}
                    className="rounded-full bg-[#1DB954] px-6 py-2 text-sm font-semibold text-black"
                  >
                    Refine session
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* SCREEN 4 loading */}
        {screen === "refining" && (
          <LoadingState messages={["Adjusting based on your reactions..."]} />
        )}

        {/* SCREEN 5 */}
        {screen === "saved" && session && (
          <section className="animate-in fade-in duration-500">
            <div className="flex flex-col items-center py-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#1DB954] animate-in zoom-in duration-500">
                <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10">
                  <path d="M5 13l4 4L19 7" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h1 className="mt-6 text-3xl font-bold md:text-4xl">Your discovery session is saved</h1>
              <p className="mt-2 text-[#B3B3B3]">{session.sessionMood} · {session.tracks.length} tracks</p>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/5 bg-[#1E1E1E]">
              {session.tracks.map((t, i) => (
                <div
                  key={t.id}
                  className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-b-0"
                >
                  <div className="w-6 text-right font-mono text-sm text-[#B3B3B3]">{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">{t.title}</div>
                    <div className="truncate text-xs text-[#B3B3B3]">{t.artist} · {t.genre}</div>
                  </div>
                  <span
                    className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline ${
                      t.familiarity === "DISCOVERY" ? "bg-[#1DB954] text-black" : "bg-[#2a2a2a] text-[#B3B3B3]"
                    }`}
                  >
                    {t.familiarity}
                  </span>
                  <div className="w-12 text-right font-mono text-xs text-[#B3B3B3]">{t.duration}</div>
                </div>
              ))}
            </div>

            {/* Comparison */}
            <div className="mt-12">
              <h2 className="text-center text-2xl font-bold">Why this is different from Discover Weekly</h2>
              <div className="mt-6 grid grid-cols-1 overflow-hidden rounded-xl border border-white/10 md:grid-cols-2">
                <div className="border-b border-white/10 bg-[#181818] md:border-b-0 md:border-r">
                  <div className="border-b border-white/10 bg-[#1E1E1E] px-5 py-3 text-sm font-semibold uppercase tracking-wider text-[#B3B3B3]">
                    Traditional recommendation
                  </div>
                  <ul className="space-y-3 px-5 py-5 text-sm text-[#B3B3B3]">
                    <li>• Based on your listening history</li>
                    <li>• Same pool of 100–200 songs cycled weekly</li>
                    <li>• No explanation for why tracks were chosen</li>
                    <li>• Cannot adjust mid-session</li>
                    <li>• Optimises for what you've enjoyed before</li>
                  </ul>
                </div>
                <div className="bg-[#181818]">
                  <div className="border-b border-white/10 bg-[#1E1E1E] px-5 py-3 text-sm font-semibold uppercase tracking-wider text-[#1DB954]">
                    Context-First Discovery (AI)
                  </div>
                  <ul className="space-y-3 px-5 py-5 text-sm text-white">
                    <li>• Based on your current moment</li>
                    <li>• Introduces genuinely unfamiliar tracks</li>
                    <li>• Every track has a plain-English reason</li>
                    <li>• Adjusts in real time from your reactions</li>
                    <li>• Optimises for what you're ready to hear next</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="mt-10 flex justify-center">
              <button
                onClick={reset}
                className="rounded-full border border-white/20 px-8 py-3 font-semibold text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954]"
              >
                Start a new session
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
