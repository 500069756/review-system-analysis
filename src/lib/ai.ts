// Centralized AI client for Groq.
// SECURITY NOTE: VITE_* variables are bundled into the client JS and visible to
// anyone who loads the site. For production, proxy these calls through a
// server-side endpoint and keep the key server-only.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Lighter, faster model — much lower TPM cost than llama-3.3-70b.
const DEFAULT_MODEL = "llama-3.1-8b-instant";
const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_TEMPERATURE = 0.3;

// Retry config for 429 / transient failures.
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1500;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  model?: string;
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
  /** When set, identical requests in the same session return cached responses. */
  cacheKey?: string;
};

function getApiKey(): string {
  const key = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
  if (!key || !key.trim()) {
    throw new Error(
      "Missing VITE_GROQ_API_KEY. Add it to your .env file (local) or your deployment env vars.",
    );
  }
  return key;
}

// In-memory session cache for identical requests.
const responseCache = new Map<string, any>();

function makeCacheKey(body: Record<string, unknown>, explicit?: string): string {
  if (explicit) return explicit;
  try {
    return JSON.stringify({ m: body.model, t: body.temperature, msgs: body.messages });
  } catch {
    return Math.random().toString(36);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chatCompletion(opts: ChatOptions): Promise<any> {
  const apiKey = getApiKey();

  const model = opts.model ?? DEFAULT_MODEL;
  const max_tokens = Math.min(opts.max_tokens ?? DEFAULT_MAX_TOKENS, 8000);
  const temperature = typeof opts.temperature === "number" ? opts.temperature : DEFAULT_TEMPERATURE;

  if (!Array.isArray(opts.messages) || opts.messages.length === 0) {
    throw new Error("chatCompletion: `messages` must be a non-empty array.");
  }

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens,
    temperature,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;

  const cacheKey = makeCacheKey(body, opts.cacheKey);
  if (responseCache.has(cacheKey)) {
    if (import.meta.env.DEV) console.debug("[ai] cache hit", cacheKey.slice(0, 60));
    return responseCache.get(cacheKey);
  }

  if (import.meta.env.DEV) {
    console.debug("[ai] →", { model, max_tokens, temperature, msgs: opts.messages.length });
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      // network error — backoff and retry
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Network error calling Groq: ${msg}`);
    }

    const raw = await res.text();
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      /* non-JSON */
    }

    if (res.status === 429 || res.status === 503) {
      // Exponential backoff, honoring Retry-After if present.
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : BASE_BACKOFF_MS * Math.pow(2, attempt);
      if (attempt < MAX_RETRIES) {
        if (import.meta.env.DEV) console.debug(`[ai] ${res.status} — backoff ${wait}ms (attempt ${attempt + 1})`);
        await sleep(wait);
        continue;
      }
      const providerMsg = json?.error?.message || raw?.slice(0, 300) || res.statusText;
      throw new Error(`Groq ${res.status}: rate limited after ${MAX_RETRIES + 1} attempts. ${providerMsg}`);
    }

    if (!res.ok) {
      const providerMsg = json?.error?.message || raw?.slice(0, 300) || res.statusText;
      if (res.status === 401) throw new Error(`Groq 401: invalid or missing API key. ${providerMsg}`);
      if (res.status === 403) throw new Error(`Groq 403: forbidden. ${providerMsg}`);
      throw new Error(`Groq ${res.status}: ${providerMsg}`);
    }

    if (!json || typeof json !== "object") {
      throw new Error("Groq returned a malformed (non-JSON) response.");
    }
    const choices = json?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("Groq returned an empty response (no choices).");
    }
    const content = choices[0]?.message?.content;
    if (
      (content == null || (typeof content === "string" && content.trim() === "")) &&
      !choices[0]?.message?.tool_calls
    ) {
      throw new Error("Groq returned an empty message content.");
    }

    responseCache.set(cacheKey, json);
    return json;
  }

  // Should not reach here.
  throw lastErr instanceof Error ? lastErr : new Error("Groq request failed.");
}
