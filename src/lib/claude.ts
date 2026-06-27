// Direct browser Anthropic Claude client.
// SECURITY: VITE_* keys are bundled into the client. For production, proxy via a server.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export type ClaudeMessage = { role: "user" | "assistant"; content: string };

export type ClaudeOptions = {
  system: string;
  messages: ClaudeMessage[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
};

function getKey(): string {
  const k = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
  if (!k || !k.trim()) {
    throw new Error("Missing VITE_ANTHROPIC_API_KEY. Add it to your .env file.");
  }
  return k;
}

export async function claudeMessage(opts: ClaudeOptions): Promise<string> {
  const key = getKey();
  const body = {
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.max_tokens ?? 1500,
    temperature: opts.temperature ?? 0.7,
    system: opts.system,
    messages: opts.messages,
  };

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Network error calling Claude: ${msg}`);
  }

  const raw = await res.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}

  if (!res.ok) {
    const m = json?.error?.message || raw?.slice(0, 300) || res.statusText;
    if (res.status === 401) throw new Error(`Claude 401: invalid API key. ${m}`);
    if (res.status === 429) throw new Error(`Claude 429: rate limited. ${m}`);
    throw new Error(`Claude ${res.status}: ${m}`);
  }

  const text = json?.content?.[0]?.text;
  if (!text || typeof text !== "string") {
    throw new Error("Claude returned an empty response.");
  }
  return text;
}

export function extractJson<T = any>(text: string): T {
  // Tolerate ```json fences or stray prose
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Claude response did not contain JSON.");
  return JSON.parse(candidate.slice(start, end + 1));
}
