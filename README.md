# Spotify Review Analysis System

Live insights, themes, and AI-powered analysis across streamed Spotify user reviews. A single-page dashboard that ingests a corpus of pre-classified reviews, computes aggregations and keyword statistics client-side, and provides an AI Q&A tab powered by Groq (via a Supabase Edge Function proxy).

## Features

- **Overview tab** — reviews-by-source bars, rating distribution, and a scaled tag cloud of the top terms across all reviews.
- **Themes tab** — live-updating breakdown of topics, pains, goals, behaviors, opportunities, root causes, personas, unmet needs, and sentiment mix. A simulated stream progressively ingests the corpus for a live-analysis feel.
- **Explorer tab** — filter and browse individual reviews by source.
- **AI Insights tab** — ask questions over the review corpus. Uses a lightweight client-side BM25-style token retriever to pick relevant reviews, then calls Groq (`llama-3.1-8b-instant`) with the retrieved context.
- **Suggested questions**, in-session chat history (localStorage), and a live ticker of incoming review snippets in the header.
- **Light / dark theme toggle**, persisted to localStorage.

## Tech stack

- [TanStack Start](https://tanstack.com/start) v1 (React 19, SSR, file-based routing)
- [Vite](https://vitejs.dev) 8 with `@lovable.dev/vite-tanstack-config`
- [TanStack Router](https://tanstack.com/router) + [TanStack Query](https://tanstack.com/query)
- [Tailwind CSS](https://tailwindcss.com) v4 (`@tailwindcss/vite`)
- [shadcn/ui](https://ui.shadcn.com) primitives (Radix UI + `class-variance-authority`)
- [Supabase JS client](https://github.com/supabase/supabase-js) — used only to reach the Edge Function proxy
- [Groq](https://groq.com) — LLM provider (`llama-3.1-8b-instant`) via the `groq-proxy` Supabase Edge Function
- TypeScript (strict), ESLint, Prettier

## Project structure

```
src/
  App.tsx                       # Main SPA — tabs, retrieval, aggregations, AI chat
  routes/
    __root.tsx                  # Root layout + head metadata
    index.tsx                   # Renders <App /> at "/"
  hooks/
    useTheme.ts                 # Light/dark toggle, persisted
    useChatHistory.ts           # LocalStorage-backed conversations
  lib/
    ai.ts                       # Groq client with retry/backoff + in-session cache
  integrations/supabase/
    client.ts                   # Supabase client (handles new/legacy API key formats)
    types.ts                    # Generated DB types
  data/reviews.json             # Pre-classified review corpus
  styles.css                    # Tailwind v4 entry + theme tokens
supabase/
  config.toml
  functions/groq-proxy/         # Edge function that forwards to api.groq.com
```

## Getting started

Prerequisites: [Bun](https://bun.sh) (or Node 20+ with npm).

```bash
bun install
bun run dev
```

The app runs at `http://localhost:8080`.

### Environment variables

Create a `.env` at the project root:

```env
VITE_SUPABASE_URL="https://<project>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon or publishable key>"
VITE_SUPABASE_PROJECT_ID="<project-id>"
```

These are read by `src/integrations/supabase/client.ts` and `src/lib/ai.ts` to reach the `groq-proxy` Edge Function.

### Groq Edge Function

The Groq API key stays server-side. It is read from the `GROQ_API_KEY` environment variable inside `supabase/functions/groq-proxy/index.ts`. Set it on the Supabase project:

```bash
supabase secrets set GROQ_API_KEY=<your-groq-key>
supabase functions deploy groq-proxy
```

The function has `verify_jwt = false` (see `supabase/config.toml`) so the client can call it with only the publishable key.

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start the Vite dev server |
| `bun run build` | Production build |
| `bun run build:dev` | Development-mode build |
| `bun run preview` | Preview the production build |
| `bun run lint` | Run ESLint |
| `bun run format` | Format with Prettier |

## How the AI tab works

1. The user asks a question (or picks a suggested one).
2. `retrieveRelevant()` in `src/App.tsx` tokenizes the query and scores each review by term-frequency match against `reviews.json`, boosting low-rated reviews slightly.
3. The top-ranked reviews are passed as context to `chatCompletion()` in `src/lib/ai.ts`.
4. `chatCompletion()` POSTs to the `groq-proxy` Edge Function, which forwards the payload to `https://api.groq.com/openai/v1/chat/completions`. The client handles 429/503 with exponential backoff (honoring `Retry-After`) and caches identical requests for the session.
5. The assistant response is rendered and appended to the conversation, which is persisted to `localStorage` via `useChatHistory`.

## Deployment

The project targets an edge runtime (Cloudflare Workers) via Nitro, configured through `@lovable.dev/vite-tanstack-config`. Build with `bun run build` and deploy the generated output.

## License

No license specified.
