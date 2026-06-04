// Centralized AI client for OpenRouter.
// SECURITY NOTE: VITE_* variables are bundled into the client JS and visible to
// anyone who loads the site. For production, proxy these calls through a
// server-side endpoint (e.g. a Vercel Function) and keep the key server-only.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4";
const DEFAULT_MAX_TOKENS = 2000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  model?: string;
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
};

function getApiKey(): string {
  const key = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;
  if (!key || !key.trim()) {
    throw new Error(
      "Missing VITE_OPENROUTER_API_KEY. Add it to your .env file (local) or Vercel project env vars (deploy).",
    );
  }
  return key;
}

export async function chatCompletion(opts: ChatOptions): Promise<any> {
  const apiKey = getApiKey();

  const model = opts.model ?? DEFAULT_MODEL;
  const max_tokens = Math.min(opts.max_tokens ?? DEFAULT_MAX_TOKENS, 4000);

  if (!Array.isArray(opts.messages) || opts.messages.length === 0) {
    throw new Error("chatCompletion: `messages` must be a non-empty array.");
  }

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;

  if (import.meta.env.DEV) {
    console.debug("[ai] →", { url: OPENROUTER_URL, model, max_tokens, messages: opts.messages });
  }

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "",
        "X-Title": "Trust Evaluation Layer",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Network error calling OpenRouter: ${msg}`);
  }

  const raw = await res.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    const providerMsg = json?.error?.message || raw?.slice(0, 300) || res.statusText;
    if (res.status === 401) throw new Error(`OpenRouter 401: invalid or missing API key. ${providerMsg}`);
    if (res.status === 402) throw new Error(`OpenRouter 402: insufficient credits. ${providerMsg}`);
    if (res.status === 429) throw new Error(`OpenRouter 429: rate limited. ${providerMsg}`);
    throw new Error(`OpenRouter ${res.status}: ${providerMsg}`);
  }

  if (!json || typeof json !== "object") {
    throw new Error("OpenRouter returned a malformed (non-JSON) response.");
  }

  if (import.meta.env.DEV) {
    console.debug("[ai] ←", json);
  }

  return json;
}
