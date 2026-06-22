// Centralized AI client for Groq.
// SECURITY NOTE: VITE_* variables are bundled into the client JS and visible to
// anyone who loads the site. For production, proxy these calls through a
// server-side endpoint and keep the key server-only.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_MAX_TOKENS = 1500;
const DEFAULT_TEMPERATURE = 0.3;

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
  const key = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
  if (!key || !key.trim()) {
    throw new Error(
      "Missing VITE_GROQ_API_KEY. Add it to your .env file (local) or your deployment env vars.",
    );
  }
  return key;
}

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

  if (import.meta.env.DEV) {
    console.debug("[ai] →", { url: GROQ_URL, model, max_tokens, temperature, messages: opts.messages });
  }

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
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Network error calling Groq: ${msg}`);
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
    if (res.status === 401) throw new Error(`Groq 401: invalid or missing API key. ${providerMsg}`);
    if (res.status === 403) throw new Error(`Groq 403: forbidden. ${providerMsg}`);
    if (res.status === 429) throw new Error(`Groq 429: rate limited. ${providerMsg}`);
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
  if (content == null || (typeof content === "string" && content.trim() === "")) {
    if (!choices[0]?.message?.tool_calls) {
      throw new Error("Groq returned an empty message content.");
    }
  }

  if (import.meta.env.DEV) {
    console.debug("[ai] ←", json);
  }

  return json;
}
