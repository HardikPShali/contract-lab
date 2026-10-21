/** The JSON Schema subset Contract Lab understands. */
export type Schema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: (string | number)[];
  format?: "uuid" | "email" | "date-time" | "uri";
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  example?: unknown;
};

export type Contract = { request?: Schema; response: Schema; status: number };

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Endpoint = {
  id: string;
  method: Method;
  path: string;
  label: string;
  /** null means the endpoint is new on the branch. */
  current: Contract | null;
  /** null means the branch removes the endpoint. */
  proposed: Contract | null;
};

export type Direction = "request" | "response";
export type Severity = "breaking" | "warning" | "safe";

export type Change = {
  id: string;
  endpointId: string;
  direction: Direction;
  /** Dotted field path; array items are written as `items[]`. Empty for the whole body. */
  path: string;
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
};

export type Usage = { endpointId: string; sends: string[]; reads: string[] };

export type Consumer = {
  id: string;
  name: string;
  owner: string;
  lastCall: string;
  uses: Usage[];
};

/** An acknowledgement is only valid for the exact set of breaking changes it was given for. */
export type Ack = { by: string; at: string; fingerprint: string };

export type HistoryEvent = {
  id: string;
  at: string;
  actor: string;
  kind: "ack" | "notify" | "edit" | "merge" | "endpoint" | "request" | "settings";
  summary: string;
  detail: string;
};

export type SentRequest = {
  id: string;
  at: string;
  endpointId: string;
  method: Method;
  path: string;
  target: "main" | "branch";
  body: string;
  status: number;
  latencyMs: number;
  response: string;
};

export type Project = {
  name: string;
  service: string;
  branch: string;
  baseVersion: string;
  user: string;
};

export type ContractState = {
  schema: 1;
  project: Project;
  endpoints: Endpoint[];
  consumers: Consumer[];
  /** Keyed by `${consumerId}:${endpointId}`. */
  acks: Record<string, Ack>;
  notified: Record<string, string>;
  history: HistoryEvent[];
  requests: SentRequest[];
};
