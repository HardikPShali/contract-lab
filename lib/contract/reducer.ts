import { allChanges, gateFor, nextVersion } from "./diff.ts";
import { sample, validate } from "./schema.ts";
import type { Contract, ContractState, Endpoint, HistoryEvent, Method, Project, Schema } from "./types.ts";

/** Every action carries a timestamp and a unique id stamped by the caller, which keeps the reducer pure. */
type Stamp = { at: string; uid: string };

export type ContractAction = Stamp &
  (
    | { type: "ack"; consumerId: string; endpointId: string; fingerprint: string }
    | { type: "unack"; consumerId: string; endpointId: string }
    | { type: "notify"; consumerId: string; endpointId: string }
    | { type: "schema/edit"; endpointId: string; request: Schema | undefined; response: Schema; status: number }
    | { type: "endpoint/create"; method: Method; path: string; label: string }
    | { type: "endpoint/remove"; endpointId: string }
    | { type: "endpoint/restore"; endpointId: string }
    | { type: "request/send"; endpointId: string; target: "main" | "branch"; body: string; status: number; latencyMs: number; response: string }
    | { type: "merge" }
    | { type: "project/update"; patch: Partial<Project> }
    | { type: "state/replace"; state: ContractState; reason: string }
  );

export type ActionInput = ContractAction extends infer A ? (A extends ContractAction ? Omit<A, "at" | "uid"> : never) : never;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const first = (name: string) => name.split(" ")[0] ?? name;
const label = (e: Endpoint) => `${e.method} ${e.path}`;

export const endpointIdFor = (uid: string) => `ep_${uid}`;

function log(state: ContractState, a: Stamp, kind: HistoryEvent["kind"], summary: string, detail: string): ContractState {
  const actor = state.project.user;
  return { ...state, history: [{ id: `h_${a.uid}`, at: a.at, actor, kind, summary: `${first(actor)} ${summary}`, detail }, ...state.history] };
}

function updateEndpoint(state: ContractState, id: string, fn: (e: Endpoint) => Endpoint): ContractState {
  return { ...state, endpoints: state.endpoints.map((e) => (e.id === id ? fn(e) : e)) };
}

export function reducer(state: ContractState, action: ContractAction): ContractState {
  const endpoint = "endpointId" in action ? state.endpoints.find((e) => e.id === action.endpointId) : undefined;
  const consumer = "consumerId" in action ? state.consumers.find((c) => c.id === action.consumerId) : undefined;

  switch (action.type) {
    case "ack": {
      if (!endpoint || !consumer) return state;
      const key = `${consumer.id}:${endpoint.id}`;
      const next = { ...state, acks: { ...state.acks, [key]: { by: state.project.user, at: action.at, fingerprint: action.fingerprint } } };
      return log(next, action, "ack", `acknowledged ${label(endpoint)} for ${consumer.name}`, `${consumer.owner} confirmed they can absorb the breaking changes`);
    }
    case "unack": {
      if (!endpoint || !consumer) return state;
      const acks = { ...state.acks };
      delete acks[`${consumer.id}:${endpoint.id}`];
      return log({ ...state, acks }, action, "ack", `withdrew acknowledgement for ${consumer.name}`, label(endpoint));
    }
    case "notify": {
      if (!endpoint || !consumer) return state;
      const next = { ...state, notified: { ...state.notified, [`${consumer.id}:${endpoint.id}`]: action.at } };
      return log(next, action, "notify", `notified ${consumer.owner}`, `${consumer.name} is affected by ${label(endpoint)}`);
    }
    case "schema/edit": {
      if (!endpoint?.proposed) return state;
      const proposed: Contract = { status: action.status, response: action.response };
      if (action.request) proposed.request = action.request;
      const before = endpoint.proposed;
      const parts = [
        JSON.stringify(before.request) !== JSON.stringify(action.request) && "request schema",
        JSON.stringify(before.response) !== JSON.stringify(action.response) && "response schema",
        before.status !== action.status && `status ${before.status} → ${action.status}`,
      ].filter(Boolean);
      if (!parts.length) return state;
      const next = updateEndpoint(state, endpoint.id, (e) => ({ ...e, proposed }));
      return log(next, action, "edit", `edited ${label(endpoint)}`, `Updated ${parts.join(", ")}`);
    }
    case "endpoint/create": {
      const created: Endpoint = {
        id: endpointIdFor(action.uid),
        method: action.method,
        path: action.path.trim(),
        label: action.label.trim() || action.path.trim(),
        current: null,
        proposed: {
          status: action.method === "POST" ? 201 : 200,
          request: ["POST", "PUT", "PATCH"].includes(action.method) ? { type: "object", properties: {} } : undefined,
          response: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        },
      };
      return log({ ...state, endpoints: [...state.endpoints, created] }, action, "endpoint", `added ${label(created)}`, "New endpoint on the branch");
    }
    case "endpoint/remove": {
      if (!endpoint) return state;
      // An endpoint that only exists on the branch is simply discarded.
      const next = endpoint.current
        ? updateEndpoint(state, endpoint.id, (e) => ({ ...e, proposed: null }))
        : { ...state, endpoints: state.endpoints.filter((e) => e.id !== endpoint.id) };
      return log(next, action, "endpoint", `removed ${label(endpoint)}`, endpoint.current ? "Marked for removal on the branch" : "Draft endpoint discarded");
    }
    case "endpoint/restore": {
      if (!endpoint?.current) return state;
      const next = updateEndpoint(state, endpoint.id, (e) => ({ ...e, proposed: clone(e.current) }));
      return log(next, action, "edit", `reverted ${label(endpoint)}`, "Proposal reset to the main branch contract");
    }
    case "request/send": {
      if (!endpoint) return state;
      const sent = {
        id: `rq_${action.uid}`, at: action.at, endpointId: endpoint.id, method: endpoint.method, path: endpoint.path,
        target: action.target, body: action.body, status: action.status, latencyMs: action.latencyMs, response: action.response,
      };
      return { ...state, requests: [sent, ...state.requests].slice(0, 50) };
    }
    case "merge": {
      const changes = allChanges(state);
      // Never merge past the gate: every consumer hit by a breaking change must have acknowledged it.
      if (!changes.length || state.endpoints.some((e) => gateFor(e, state).blocked.length)) return state;
      const version = nextVersion(state.project.baseVersion, changes);
      const endpoints = state.endpoints
        .filter((e) => e.proposed)
        .map((e) => ({ ...e, current: clone(e.proposed), proposed: clone(e.proposed) }));
      const breaking = changes.filter((c) => c.severity === "breaking").length;
      const next = { ...state, endpoints, acks: {}, notified: {}, project: { ...state.project, baseVersion: version } };
      return log(next, action, "merge", `merged ${state.project.branch} as ${version}`,
        `${new Set(changes.map((c) => c.endpointId)).size} endpoints changed, ${breaking} breaking change${breaking === 1 ? "" : "s"} acknowledged`);
    }
    case "project/update": {
      const changed = (Object.keys(action.patch) as (keyof Project)[]).filter((k) => action.patch[k] !== state.project[k]);
      if (!changed.length) return state;
      return log({ ...state, project: { ...state.project, ...action.patch } }, action, "settings", "updated project settings",
        changed.map((k) => `${k}: ${String(action.patch[k])}`).join("; "));
    }
    case "state/replace":
      return log(action.state, action, "settings", action.reason, `${action.state.endpoints.length} endpoints`);
  }
}

export type SimulatedResponse = { status: number; latencyMs: number; body: unknown };

/** Runs a request body against one side of the contract: 400 for bad JSON, 422 for schema errors, otherwise a sample. */
export function simulateRequest(endpoint: Endpoint, target: "main" | "branch", rawBody: string, seed: number): SimulatedResponse {
  const contract = target === "main" ? endpoint.current : endpoint.proposed;
  const latencyMs = 90 + (seed % 140);
  if (!contract) return { status: 404, latencyMs: 30 + (seed % 20), body: { error: "not_found", message: `${endpoint.method} ${endpoint.path} does not exist on ${target}` } };
  let body: unknown = undefined;
  if (contract.request) {
    try {
      body = rawBody.trim() ? JSON.parse(rawBody) : undefined;
    } catch (e) {
      return { status: 400, latencyMs: 20 + (seed % 15), body: { error: "invalid_json", message: (e as Error).message } };
    }
    const errors = body === undefined ? [{ path: "body", message: "is required" }] : validate(body, contract.request);
    if (errors.length) return { status: 422, latencyMs: 40 + (seed % 30), body: { error: "validation_failed", details: errors } };
  }
  const echo = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return { status: contract.status, latencyMs, body: sample(contract.response, echo) };
}
