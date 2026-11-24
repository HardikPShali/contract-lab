import { endpointChanges, impactFor, nextVersion } from "../contract/diff.ts";
import type { Consumer, Endpoint, Project } from "../contract/types.ts";

/** Hard cap on the request body the worker accepts. */
export const MAX_REQUEST_BYTES = 24_000;
const MAX_CHANGES = 40;

export type MigrationRequest = {
  service: string;
  endpoint: string;
  fromVersion: string;
  toVersion: string;
  changes: { severity: string; direction: string; path: string; title: string; detail: string }[];
  consumers: { name: string; owner: string; sends: string[]; reads: string[]; affectedBy: string[] }[];
};

/**
 * Builds the compact, model-ready summary of one endpoint's proposed change and who it affects.
 * Only consumers touched by at least one change are included. Pure and unit-tested.
 */
export function buildMigrationRequest(endpoint: Endpoint, consumers: Consumer[], project: Project): MigrationRequest {
  const changes = endpointChanges(endpoint);
  const impacts = impactFor(endpoint, consumers, changes).filter((i) => i.changes.length > 0);
  return {
    service: project.service,
    endpoint: `${endpoint.method} ${endpoint.path}`,
    fromVersion: project.baseVersion,
    toVersion: nextVersion(project.baseVersion, changes),
    changes: changes.slice(0, MAX_CHANGES).map(({ severity, direction, path, title, detail }) => ({ severity, direction, path: path || "(body)", title, detail })),
    consumers: impacts.map((i) => {
      const use = i.consumer.uses.find((u) => u.endpointId === endpoint.id);
      return {
        name: i.consumer.name,
        owner: i.consumer.owner,
        sends: use?.sends ?? [],
        reads: use?.reads ?? [],
        affectedBy: i.changes.map((c) => c.title),
      };
    }),
  };
}

export const SYSTEM_PROMPT = `You are a senior API platform engineer writing a migration guide for a proposed API contract change.
Use only the changes and consumers you are given. Never invent fields, endpoints or teams.
Write plain text (no markdown tables, no code fences), under 260 words, with exactly these headings on their own lines:
Summary
Migration steps
Message to owners
Under "Summary", explain in two or three sentences what changes and why it is a major, minor or patch release.
Under "Migration steps", list each affected consumer by name with one or two concrete steps, referring to the exact field paths.
Under "Message to owners", write a short, friendly message the API team can paste into Slack, asking owners to acknowledge before merge.`;

export function migrationUserMessage(req: MigrationRequest): string {
  return [
    `Service: ${req.service}`,
    `Endpoint: ${req.endpoint}`,
    `Version: ${req.fromVersion} -> ${req.toVersion}`,
    `Changes:\n${req.changes.map((c) => `- [${c.severity}] ${c.direction} ${c.path}: ${c.title}. ${c.detail}`).join("\n") || "- none"}`,
    `Affected consumers:\n${
      req.consumers
        .map((c) => `- ${c.name} (owner: ${c.owner}); sends: ${c.sends.join(", ") || "nothing"}; reads: ${c.reads.join(", ") || "nothing"}; affected by: ${c.affectedBy.join("; ")}`)
        .join("\n") || "- none"
    }`,
  ].join("\n\n");
}

/**
 * Extracts the text deltas from a chunk of an OpenAI-compatible server-sent event stream.
 * Returns the text found and any incomplete trailing line to prepend to the next chunk.
 */
export function parseSseChunk(buffer: string): { text: string; rest: string; done: boolean } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  let text = "";
  let done = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    } catch {
      // Ignore keep-alives and malformed lines rather than breaking the stream.
    }
  }
  return { text, rest, done };
}
