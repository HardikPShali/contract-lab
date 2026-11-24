/**
 * POST /api/ai/migration: streams an AI-written migration guide for one endpoint change.
 *
 * The API key lives only in the Worker's environment (a Cloudflare secret), never in the browser.
 * Defaults to Google's free Gemini API tier through its OpenAI-compatible endpoint, and works with
 * any other OpenAI-compatible provider (OpenAI, Azure OpenAI, Groq) by changing AI_BASE_URL.
 */
import { MAX_REQUEST_BYTES, SYSTEM_PROMPT, migrationUserMessage, parseSseChunk, type MigrationRequest } from "../lib/ai/migration.ts";

export interface AiEnv {
  /** Required. A free Gemini key from Google AI Studio, or any provider's key. `npx wrangler secret put AI_API_KEY` */
  AI_API_KEY?: string;
  /** Optional. Defaults to Gemini's OpenAI-compatible endpoint. */
  AI_BASE_URL?: string;
  /** Optional. Defaults to gemini-flash-latest. */
  AI_MODEL?: string;
  /** Optional, Azure only, e.g. 2024-10-21. */
  AI_API_VERSION?: string;
  /** Older names, still accepted. */
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function isMigrationRequest(value: unknown): value is MigrationRequest {
  const v = value as MigrationRequest;
  return !!v && typeof v.endpoint === "string" && typeof v.service === "string" && Array.isArray(v.changes) && Array.isArray(v.consumers) && v.changes.length <= 40 && v.consumers.length <= 40;
}

export async function handleAiMigration(request: Request, env: AiEnv): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return json(503, { error: "AI drafting is not configured on this deployment." });

  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BYTES) return json(413, { error: "This change is too large to summarise." });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid JSON." });
  }
  if (!isMigrationRequest(body)) return json(400, { error: "Missing change details." });

  const base = (env.AI_BASE_URL || env.OPENAI_BASE_URL || GEMINI_BASE_URL).replace(/\/$/, "");
  const isAzure = base.includes(".azure.com");
  const isGemini = base.includes("generativelanguage.googleapis.com");
  const url = `${base}/chat/completions${isAzure ? `?api-version=${env.AI_API_VERSION || "2024-10-21"}` : ""}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isAzure) headers["api-key"] = apiKey;
  else headers.authorization = `Bearer ${apiKey}`;

  const upstream = await fetch(url, {
    method: "POST",
    headers,
    signal: request.signal,
    body: JSON.stringify({
      model: env.AI_MODEL || env.OPENAI_MODEL || "gemini-flash-latest",
      // Gemini models think before answering; keep that short so the token budget goes to the answer.
      ...(isGemini ? { reasoning_effort: "low" } : {}),
      stream: true,
      temperature: 0.2,
      max_tokens: 1000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: migrationUserMessage(body) },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    // Log the provider's error server-side; never forward it, since it can echo account details.
    console.error("AI migration upstream error", upstream.status, await upstream.text().catch(() => ""));
    const status = upstream.status === 429 ? 429 : 502;
    return json(status, { error: status === 429 ? "The AI service is busy. Try again in a minute." : "The AI service did not respond." });
  }

  // Re-stream only the text deltas as plain text, so the client needs no SSE parsing.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const stream = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const { text, rest } = parseSseChunk(buffer + decoder.decode(chunk, { stream: true }));
        buffer = rest;
        if (text) controller.enqueue(encoder.encode(text));
      },
      flush(controller) {
        const { text } = parseSseChunk(`${buffer}\n`);
        if (text) controller.enqueue(encoder.encode(text));
      },
    }),
  );

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
