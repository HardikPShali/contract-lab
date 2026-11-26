/**
 * Vercel Edge Function for POST /api/ai/migration.
 *
 * The live site is deployed on Vercel, which does not run worker/index.ts, so this file exposes the
 * same tested handler there. The key comes from the AI_API_KEY environment variable in the Vercel
 * project settings and never reaches the browser.
 */
import { handleAiMigration } from "../../worker/ai.ts";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  const env = process.env;
  return handleAiMigration(request, {
    AI_API_KEY: env.AI_API_KEY,
    AI_BASE_URL: env.AI_BASE_URL,
    AI_MODEL: env.AI_MODEL,
    AI_API_VERSION: env.AI_API_VERSION,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_BASE_URL: env.OPENAI_BASE_URL,
    OPENAI_MODEL: env.OPENAI_MODEL,
  });
}
