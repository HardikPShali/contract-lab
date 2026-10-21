import { joinPath } from "./schema.ts";
import type { Change, ContractState, Consumer, Direction, Endpoint, Schema, Severity } from "./types.ts";

type Emit = (path: string, kind: string, severity: Severity, title: string, detail: string) => void;

const show = (v: unknown) => JSON.stringify(v);
const label = (path: string) => path || "body";

/**
 * Compatibility rules differ by direction. Requests are written by consumers, so anything that
 * rejects input they used to send is breaking. Responses are read by consumers, so anything that
 * removes or loosens data they relied on is breaking.
 */
function compare(a: Schema, b: Schema, dir: Direction, path: string, emit: Emit) {
  const req = dir === "request";

  if (a.type && b.type && a.type !== b.type) {
    const widening = req ? a.type === "integer" && b.type === "number" : a.type === "number" && b.type === "integer";
    emit(path, "type", widening ? "safe" : "breaking", widening ? "Type widened" : "Type changed",
      `${label(path)} changed from ${a.type} to ${b.type}`);
    return;
  }

  if (a.format !== b.format) {
    if (b.format && req) emit(path, "format", "breaking", "Format narrowed", `${label(path)} must now be a ${b.format}${a.format ? ` (was ${a.format})` : ""}`);
    else if (b.format) emit(path, "format", "safe", "Format documented", `${label(path)} is now guaranteed to be a ${b.format}`);
    else if (req) emit(path, "format", "safe", "Format relaxed", `${label(path)} no longer has to be a ${a.format}`);
    else emit(path, "format", "warning", "Format no longer guaranteed", `${label(path)} may not be a ${a.format} any more`);
  }

  if (a.enum || b.enum) {
    if (!a.enum) {
      emit(path, "enum", req ? "breaking" : "safe", req ? "Values restricted" : "Values documented", `${label(path)} is limited to ${b.enum!.map(show).join(", ")}`);
    } else if (!b.enum) {
      emit(path, "enum", req ? "safe" : "warning", req ? "Values unrestricted" : "Values no longer fixed", `${label(path)} accepts any ${b.type ?? "value"}`);
    } else {
      const removed = a.enum.filter((v) => !b.enum!.includes(v));
      const added = b.enum.filter((v) => !a.enum!.includes(v));
      if (removed.length) {
        emit(path, "enum-removed", req ? "breaking" : "safe", req ? "Accepted value removed" : "Value no longer returned", `${label(path)} drops ${removed.map(show).join(", ")}`);
      }
      if (added.length) {
        emit(path, "enum-added", req ? "safe" : "warning", req ? "Accepted value added" : "New value may be returned", `${label(path)} adds ${added.map(show).join(", ")}`);
      }
    }
  }

  const bounds: [keyof Schema, "min" | "max", string][] = [
    ["minItems", "min", "items"], ["maxItems", "max", "items"], ["minLength", "min", "characters"],
    ["maxLength", "max", "characters"], ["minimum", "min", ""], ["maximum", "max", ""],
  ];
  for (const [key, side, unit] of bounds) {
    const was = a[key] as number | undefined;
    const now = b[key] as number | undefined;
    if (was === now) continue;
    const tightened = now !== undefined && (was === undefined || (side === "min" ? now > was : now < was));
    const text = `${label(path)} ${key} ${was ?? "unset"} → ${now ?? "unset"}${unit ? ` ${unit}` : ""}`;
    if (tightened) emit(path, key, req ? "warning" : "safe", req ? "Validation tightened" : "Range narrowed", text);
    else emit(path, key, req ? "safe" : "warning", req ? "Validation relaxed" : "Range widened", text);
  }

  if (req && a.additionalProperties !== false && b.additionalProperties === false) {
    emit(path, "closed", "breaking", "Unknown fields rejected", `${label(path)} no longer accepts fields outside the schema`);
  }

  const aProps = a.properties ?? {};
  const bProps = b.properties ?? {};
  const aReq = new Set(a.required ?? []);
  const bReq = new Set(b.required ?? []);
  for (const name of Object.keys(aProps)) {
    const p = joinPath(path, name);
    if (!(name in bProps)) {
      if (!req) emit(p, "removed", "breaking", "Field removed", `${p} is no longer returned`);
      else if (b.additionalProperties === false) emit(p, "removed", "breaking", "Field no longer accepted", `Requests that send ${p} are rejected`);
      else emit(p, "removed", "warning", "Field ignored", `${p} is accepted but silently ignored`);
      continue;
    }
    if (req && !aReq.has(name) && bReq.has(name)) emit(p, "became-required", "breaking", "Field became required", `${p} must now be sent`);
    if (req && aReq.has(name) && !bReq.has(name)) emit(p, "became-optional", "safe", "Field became optional", `${p} may now be omitted`);
    if (!req && aReq.has(name) && !bReq.has(name)) emit(p, "may-be-missing", "breaking", "Field may be missing", `${p} is no longer guaranteed in responses`);
    if (!req && !aReq.has(name) && bReq.has(name)) emit(p, "guaranteed", "safe", "Field guaranteed", `${p} is now always returned`);
    compare(aProps[name]!, bProps[name]!, dir, p, emit);
  }
  for (const name of Object.keys(bProps)) {
    if (name in aProps) continue;
    const p = joinPath(path, name);
    if (req && bReq.has(name)) emit(p, "required-added", "breaking", "Required field added", `${p} is new and required`);
    else emit(p, "added", "safe", req ? "Optional field added" : "Field added", `${p} is new${req ? " and optional" : ""}`);
  }

  if (a.items && b.items) compare(a.items, b.items, dir, `${path}[]`, emit);
}

export function endpointChanges(endpoint: Endpoint): Change[] {
  const changes: Change[] = [];
  const make = (dir: Direction): Emit => (path, kind, severity, title, detail) =>
    changes.push({ id: `${endpoint.id}:${dir}:${path}:${kind}`, endpointId: endpoint.id, direction: dir, path, kind, severity, title, detail });
  const { current: a, proposed: b } = endpoint;

  if (!a && !b) return changes;
  if (!a) {
    make("response")("", "endpoint-added", "safe", "Endpoint added", `${endpoint.method} ${endpoint.path} is new`);
    return changes;
  }
  if (!b) {
    make("response")("", "endpoint-removed", "breaking", "Endpoint removed", `${endpoint.method} ${endpoint.path} will return 404`);
    return changes;
  }
  if (a.status !== b.status) make("response")("", "status", "breaking", "Status code changed", `Success status ${a.status} → ${b.status}`);
  if (a.request && b.request) compare(a.request, b.request, "request", "", make("request"));
  else if (!a.request && b.request) {
    const required = (b.request.required ?? []).length > 0;
    make("request")("", "body-added", required ? "breaking" : "safe", "Request body introduced", required ? "Callers must now send a body" : "An optional body is now accepted");
  } else if (a.request && !b.request) make("request")("", "body-removed", "warning", "Request body dropped", "Any body sent is ignored");
  compare(a.response, b.response, "response", "", make("response"));
  return changes;
}

export function allChanges(state: Pick<ContractState, "endpoints">): Change[] {
  return state.endpoints.flatMap(endpointChanges);
}

/** True when two field paths overlap: one equals, contains or sits inside the other. */
export function related(a: string, b: string): boolean {
  if (!a || !b || a === b) return true;
  const inside = (x: string, y: string) => x.startsWith(`${y}.`) || x.startsWith(`${y}[]`);
  return inside(a, b) || inside(b, a);
}

/** Request changes that hit every caller regardless of which fields they send. */
const AFFECTS_ALL_SENDERS = new Set(["required-added", "became-required", "closed", "body-added"]);

export function affects(change: Change, consumer: Consumer): boolean {
  const usage = consumer.uses.find((u) => u.endpointId === change.endpointId);
  if (!usage) return false;
  if (change.kind === "endpoint-removed" || change.kind === "status") return true;
  if (change.direction === "request") {
    if (AFFECTS_ALL_SENDERS.has(change.kind)) return usage.sends.length > 0 || change.kind === "body-added";
    return usage.sends.some((p) => related(p, change.path));
  }
  return usage.reads.some((p) => related(p, change.path));
}

export type Impact = { consumer: Consumer; changes: Change[]; breaking: Change[]; fingerprint: string };

export function fingerprint(changes: Change[]): string {
  // Small stable hash (FNV-1a) so an acknowledgement is tied to an exact set of breaking changes.
  let h = 0x811c9dc5;
  for (const ch of changes.map((c) => c.id).sort().join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function impactFor(endpoint: Endpoint, consumers: Consumer[], changes = endpointChanges(endpoint)): Impact[] {
  return consumers
    .filter((c) => c.uses.some((u) => u.endpointId === endpoint.id))
    .map((consumer) => {
      const hits = changes.filter((ch) => ch.severity !== "safe" && affects(ch, consumer));
      const breaking = hits.filter((ch) => ch.severity === "breaking");
      return { consumer, changes: hits, breaking, fingerprint: fingerprint(breaking) };
    });
}

export const ackKey = (consumerId: string, endpointId: string) => `${consumerId}:${endpointId}`;

export type Gate = { blocked: Impact[]; acknowledged: Impact[]; breaking: number; unconsumedBreaking: number };

/** An endpoint can merge when every consumer hit by a breaking change has acknowledged that exact change set. */
export function gateFor(endpoint: Endpoint, state: Pick<ContractState, "consumers" | "acks">): Gate {
  const changes = endpointChanges(endpoint);
  const impacts = impactFor(endpoint, state.consumers, changes).filter((i) => i.breaking.length);
  const valid = (i: Impact) => state.acks[ackKey(i.consumer.id, endpoint.id)]?.fingerprint === i.fingerprint;
  const breakingChanges = changes.filter((c) => c.severity === "breaking");
  const consumed = new Set(impacts.flatMap((i) => i.breaking.map((c) => c.id)));
  return {
    blocked: impacts.filter((i) => !valid(i)),
    acknowledged: impacts.filter(valid),
    breaking: breakingChanges.length,
    unconsumedBreaking: breakingChanges.filter((c) => !consumed.has(c.id)).length,
  };
}

export function nextVersion(version: string, changes: Change[]): string {
  const [major = 1, minor = 0, patch = 0] = version.replace(/^v/, "").split(".").map(Number);
  if (changes.some((c) => c.severity === "breaking")) return `v${major + 1}.0.0`;
  if (changes.some((c) => c.kind === "added" || c.kind === "endpoint-added" || c.kind === "enum-added")) return `v${major}.${minor + 1}.0`;
  if (changes.length) return `v${major}.${minor}.${patch + 1}`;
  return `v${major}.${minor}.${patch}`;
}
