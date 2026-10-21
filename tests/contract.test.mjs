import { test } from "node:test";
import assert from "node:assert/strict";
import { allChanges, endpointChanges, gateFor, impactFor, nextVersion, related } from "../lib/contract/diff.ts";
import { reducer, simulateRequest } from "../lib/contract/reducer.ts";
import { alignLines, printSchema, sample, validate } from "../lib/contract/schema.ts";
import { createSeed } from "../lib/contract/seed.ts";

const NOW = new Date("2026-10-21T12:00:00Z");
let n = 0;
const run = (state, action) => reducer(state, { ...action, at: new Date(NOW.getTime() + ++n * 1000).toISOString(), uid: `u${n}` });
const ep = (contractA, contractB) => ({ id: "e", method: "POST", path: "/x", label: "x", current: contractA, proposed: contractB });
const kinds = (e) => endpointChanges(e).map((c) => `${c.direction}:${c.path}:${c.kind}:${c.severity}`);
const obj = (properties, required) => ({ type: "object", properties, ...(required ? { required } : {}) });

test("request and response follow opposite compatibility rules", () => {
  const before = obj({ a: { type: "string" } });
  const after = obj({ a: { type: "string" }, b: { type: "string" } }, ["b"]);
  assert.deepEqual(kinds(ep({ status: 200, request: before, response: before }, { status: 200, request: after, response: after })), [
    "request:b:required-added:breaking",
    "response:b:added:safe",
  ]);
  // Removing a field: readers break, senders are merely ignored unless the object is closed.
  const removed = kinds(ep({ status: 200, request: after, response: after }, { status: 200, request: before, response: before }));
  assert.ok(removed.includes("response:b:removed:breaking"));
  assert.ok(removed.includes("request:b:removed:warning"));
});

test("enum, format and constraint changes", () => {
  const a = { status: 200, request: obj({ s: { type: "string", enum: ["x", "y"] }, id: { type: "string" }, n: { type: "integer", maximum: 5 } }), response: obj({ s: { type: "string", enum: ["x"] } }) };
  const b = { status: 200, request: obj({ s: { type: "string", enum: ["x", "z"] }, id: { type: "string", format: "uuid" }, n: { type: "number", maximum: 10 } }), response: obj({ s: { type: "string", enum: ["x", "w"] } }) };
  const k = kinds(ep(a, b));
  assert.ok(k.includes("request:s:enum-removed:breaking"));
  assert.ok(k.includes("request:s:enum-added:safe"));
  assert.ok(k.includes("request:id:format:breaking"));
  assert.ok(k.includes("request:n:type:safe"), "integer → number widens a request");
  assert.ok(k.includes("response:s:enum-added:warning"));
});

test("nested arrays and endpoint-level changes", () => {
  const item = (props) => ({ type: "array", items: obj(props) });
  const k = kinds(ep({ status: 200, response: obj({ data: item({ id: { type: "string" }, name: { type: "string" } }) }) }, { status: 201, response: obj({ data: item({ id: { type: "string" } }) }) }));
  assert.ok(k.includes("response::status:breaking"));
  assert.ok(k.includes("response:data[].name:removed:breaking"));
  assert.equal(endpointChanges(ep({ status: 200, response: {} }, null))[0].kind, "endpoint-removed");
  assert.equal(endpointChanges(ep(null, { status: 200, response: {} }))[0].severity, "safe");
});

test("path overlap", () => {
  assert.ok(related("items", "items[].sku"));
  assert.ok(related("data[].email", "data"));
  assert.ok(!related("items", "itemsCount"));
});

test("seed impact matches field usage", () => {
  const s = createSeed(NOW);
  const patch = s.endpoints.find((e) => e.id === "update-order");
  const impacts = Object.fromEntries(impactFor(patch, s.consumers).map((i) => [i.consumer.id, i.breaking.map((c) => c.kind).sort()]));
  assert.deepEqual(impacts["warehouse-sync"], ["enum-removed"]);
  assert.deepEqual(impacts["mobile-app"], ["enum-removed", "removed"]);
  const refunds = s.endpoints.find((e) => e.id === "create-refund");
  assert.equal(gateFor(refunds, s).blocked.length, 0);
});

test("merge is gated, acknowledgements go stale when changes move, and merging bumps the major version", () => {
  let s = createSeed(NOW);
  const blocked = run(s, { type: "merge" });
  assert.equal(blocked, s, "merge refused while consumers are unacknowledged");

  for (const e of s.endpoints) {
    for (const i of impactFor(e, s.consumers).filter((x) => x.breaking.length)) {
      s = run(s, { type: "ack", consumerId: i.consumer.id, endpointId: e.id, fingerprint: i.fingerprint });
    }
  }
  assert.ok(s.endpoints.every((e) => gateFor(e, s).blocked.length === 0));

  // Editing the proposal changes the breaking set, which invalidates the earlier acknowledgement.
  const create = s.endpoints.find((e) => e.id === "create-order");
  const edited = { ...create.proposed.request, properties: { ...create.proposed.request.properties, couponCode: { type: "string" } }, additionalProperties: false };
  const stale = run(s, { type: "schema/edit", endpointId: "create-order", request: edited, response: create.proposed.response, status: 201 });
  assert.ok(gateFor(stale.endpoints.find((e) => e.id === "create-order"), stale).blocked.length > 0);

  const merged = run(s, { type: "merge" });
  assert.equal(merged.project.baseVersion, "v2.0.0");
  assert.equal(allChanges(merged).length, 0);
  assert.deepEqual(merged.acks, {});
  assert.match(merged.history[0].summary, /merged feature\/order-v2 as v2\.0\.0/);
});

test("version bumps", () => {
  assert.equal(nextVersion("v1.8.2", [{ severity: "safe", kind: "added" }]), "v1.9.0");
  assert.equal(nextVersion("v1.8.2", [{ severity: "safe", kind: "enum-removed" }]), "v1.8.3");
  assert.equal(nextVersion("v1.8.2", []), "v1.8.2");
});

test("validator", () => {
  const schema = obj({ id: { type: "string", format: "uuid" }, items: { type: "array", minItems: 1, items: obj({ qty: { type: "integer", minimum: 1 } }, ["qty"]) }, cur: { enum: ["EUR"] } }, ["id", "items"]);
  const errors = validate({ id: "cus_1", items: [{ qty: 0 }], cur: "GBP" }, schema).map((e) => `${e.path} ${e.message}`);
  assert.deepEqual(errors, ["id must be a valid uuid", "items[0].qty must be ≥ 1", 'cur must be one of "EUR"']);
  assert.deepEqual(validate({ items: [] }, schema).map((e) => e.path), ["id", "items"]);
  assert.deepEqual(validate(sample(schema), schema), [], "generated samples are valid");
});

test("request simulation returns 400, 422, 404 and success", () => {
  const s = createSeed(NOW);
  const create = s.endpoints.find((e) => e.id === "create-order");
  const legacy = JSON.stringify({ customerId: "cus_8291", items: [{ sku: "CHAIR-01", qty: 1 }] });
  assert.equal(simulateRequest(create, "main", legacy, 1).status, 201);
  const branch = simulateRequest(create, "branch", legacy, 1);
  assert.equal(branch.status, 422);
  assert.deepEqual(branch.body.details.map((d) => d.path).sort(), ["currency", "customerId"]);
  assert.equal(simulateRequest(create, "branch", "{", 1).status, 400);
  const ok = simulateRequest(create, "branch", JSON.stringify(sample(create.proposed.request)), 1);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.currency, "EUR", "response echoes request fields with matching names");
  assert.equal(simulateRequest({ ...create, proposed: null }, "branch", legacy, 1).status, 404);
});

test("printer tags field lines and alignment pairs edits", () => {
  const lines = printSchema(obj({ a: { type: "array", items: obj({ b: { type: "string" } }) } }));
  assert.equal(lines.find((l) => l.path === "a[].b").text.trim(), '"b": {');
  const rows = alignLines(printSchema(obj({ a: { type: "string" } })), printSchema(obj({ a: { type: "integer" } })));
  assert.ok(rows.some((r) => r.kind === "changed" && r.left.text.includes("string") && r.right.text.includes("integer")));
});
