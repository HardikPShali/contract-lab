import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REQUEST_BYTES, buildMigrationRequest, migrationUserMessage, parseSseChunk } from "../lib/ai/migration.ts";
import { endpointChanges } from "../lib/contract/diff.ts";
import { createSeed } from "../lib/contract/seed.ts";

const seed = createSeed(new Date("2026-10-21T12:00:00Z"));
const changed = seed.endpoints.find((e) => endpointChanges(e).some((c) => c.severity === "breaking"));

test("seed has an endpoint with a breaking change to describe", () => {
  assert.ok(changed);
});

test("migration request includes every change and only affected consumers", () => {
  const req = buildMigrationRequest(changed, seed.consumers, seed.project);
  assert.equal(req.changes.length, endpointChanges(changed).length);
  assert.ok(req.consumers.every((c) => c.affectedBy.length > 0));
  assert.match(req.endpoint, new RegExp(changed.path.replace(/[{}]/g, ".")));
  assert.notEqual(req.toVersion, req.fromVersion);
  assert.ok(JSON.stringify(req).length < MAX_REQUEST_BYTES);
});

test("user message lists changes with severity and consumers with their fields", () => {
  const msg = migrationUserMessage(buildMigrationRequest(changed, seed.consumers, seed.project));
  assert.match(msg, /\[breaking\]/);
  assert.match(msg, /Affected consumers:/);
});

test("SSE parser joins deltas and keeps partial lines", () => {
  const a = parseSseChunk('data: {"choices":[{"delta":{"content":"Sum"}}]}\ndata: {"choices":[{"delta":{"content":"mary"}}]}\ndata: {"ch');
  assert.equal(a.text, "Summary");
  const b = parseSseChunk(a.rest + 'oices":[{"delta":{"content":"!"}}]}\ndata: [DONE]\n');
  assert.equal(b.text, "!");
  assert.equal(b.done, true);
});
