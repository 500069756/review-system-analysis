import { createFileRoute } from "@tanstack/react-router";

const EVAL_TOOL = {
  type: "function",
  function: {
    name: "trust_evaluation",
    description:
      "Evaluate an AI primary response across cross-model validation, evidence verification, reasoning completeness, and risk. Return a single confidence score 0-100.",
    parameters: {
      type: "object",
      properties: {
        primary: {
          type: "string",
          description: "The candidate primary AI answer to the user's prompt (1-3 short paragraphs).",
        },
        category: {
          type: "string",
          description: "Topic category, e.g. Medical, Business strategy, Brainstorming, Legal, Technical.",
        },
        risk: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        confidence: {
          type: "number",
          description: "Overall confidence/accuracy 0-100 synthesizing all checks.",
        },
        models: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              name: { type: "string", enum: ["gpt-primary", "claude-verifier", "domain-eval"] },
              verdict: { type: "string" },
              stance: { type: "string", enum: ["agree", "partial", "dissent"] },
            },
            required: ["name", "verdict", "stance"],
            additionalProperties: false,
          },
        },
        evidence: {
          type: "array",
          minItems: 3,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              dimension: { type: "string" },
              status: { type: "string", enum: ["ok", "weak", "missing"] },
              note: { type: "string" },
            },
            required: ["dimension", "status", "note"],
            additionalProperties: false,
          },
        },
        reasoningGaps: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: { type: "string" },
        },
        warnings: {
          type: "array",
          minItems: 0,
          maxItems: 3,
          items: { type: "string" },
        },
      },
      required: [
        "primary",
        "category",
        "risk",
        "confidence",
        "models",
        "evidence",
        "reasoningGaps",
        "warnings",
      ],
      additionalProperties: false,
    },
  },
} as const;

export const Route = createFileRoute("/api/evaluate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { prompt } = (await request.json()) as { prompt?: string };
          if (!prompt || typeof prompt !== "string" || prompt.length > 2000) {
            return Response.json({ error: "Invalid prompt" }, { status: 400 });
          }

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json({ error: "AI not configured" }, { status: 500 });
          }

          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                {
                  role: "system",
                  content:
                    "You are the Trust Evaluation Layer. For the user's prompt: (1) draft a concise primary AI answer in `primary` (2-4 sentences). (2) Then critically evaluate that primary answer through cross-model perspectives, evidence verification, reasoning completeness, risk level, and a final confidence 0-100. Be honest about uncertainty. High-risk domains (medical, legal, financial) must lower confidence and add warnings. Always call the trust_evaluation tool.",
                },
                { role: "user", content: prompt },
              ],
              tools: [EVAL_TOOL],
              tool_choice: { type: "function", function: { name: "trust_evaluation" } },
            }),
          });

          if (!res.ok) {
            if (res.status === 429) {
              return Response.json(
                { error: "Rate limit exceeded. Please try again in a moment." },
                { status: 429 },
              );
            }
            if (res.status === 402) {
              return Response.json(
                { error: "AI credits exhausted. Add credits in Workspace settings." },
                { status: 402 },
              );
            }
            const text = await res.text();
            console.error("AI gateway error", res.status, text);
            return Response.json({ error: "AI gateway error" }, { status: 500 });
          }

          const json = await res.json();
          const call = json.choices?.[0]?.message?.tool_calls?.[0];
          if (!call?.function?.arguments) {
            return Response.json({ error: "No structured output returned" }, { status: 500 });
          }

          const parsed = JSON.parse(call.function.arguments);
          return Response.json(parsed);
        } catch (e) {
          console.error(e);
          return Response.json(
            { error: e instanceof Error ? e.message : "Unknown error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
