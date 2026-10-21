"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { z } from "zod";
import { reducer, type ActionInput, type ContractAction } from "@/lib/contract/reducer";
import { createSeed } from "@/lib/contract/seed";
import type { ContractState, Schema } from "@/lib/contract/types";

const STORAGE_KEY = "contract-lab:workspace:v1";

const schemaShape: z.ZodType<Schema> = z.lazy(() =>
  z.object({
    type: z.enum(["object", "array", "string", "number", "integer", "boolean"]).optional(),
    description: z.string().optional(),
    properties: z.record(schemaShape).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
    items: schemaShape.optional(),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
    format: z.enum(["uuid", "email", "date-time", "uri"]).optional(),
    minItems: z.number().optional(), maxItems: z.number().optional(),
    minLength: z.number().optional(), maxLength: z.number().optional(),
    minimum: z.number().optional(), maximum: z.number().optional(),
    example: z.unknown().optional(),
  }).strict(),
);

/** Validates a schema typed by hand in the editor; unknown keywords are rejected so typos surface. */
export function parseSchema(input: unknown): Schema {
  return schemaShape.parse(input);
}

const contractShape = z.object({ status: z.number().int().min(100).max(599), request: schemaShape.optional(), response: schemaShape });
const stateShape = z.object({
  schema: z.literal(1),
  project: z.object({ name: z.string(), service: z.string(), branch: z.string(), baseVersion: z.string(), user: z.string() }),
  endpoints: z.array(z.object({
    id: z.string(), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: z.string(), label: z.string(),
    current: contractShape.nullable(), proposed: contractShape.nullable(),
  })),
  consumers: z.array(z.object({
    id: z.string(), name: z.string(), owner: z.string(), lastCall: z.string(),
    uses: z.array(z.object({ endpointId: z.string(), sends: z.array(z.string()), reads: z.array(z.string()) })),
  })),
  acks: z.record(z.object({ by: z.string(), at: z.string(), fingerprint: z.string() })),
  notified: z.record(z.string()),
  history: z.array(z.object({ id: z.string(), at: z.string(), actor: z.string(), kind: z.enum(["ack", "notify", "edit", "merge", "endpoint", "request", "settings"]), summary: z.string(), detail: z.string() })),
  requests: z.array(z.object({
    id: z.string(), at: z.string(), endpointId: z.string(), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: z.string(),
    target: z.enum(["main", "branch"]), body: z.string(), status: z.number(), latencyMs: z.number(), response: z.string(),
  })),
});

export function parseState(input: unknown): ContractState {
  return stateShape.parse(input) as ContractState;
}

export function makeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type Store = {
  state: ContractState;
  /** Applies an action and returns its unique id (new entities derive their id from it). */
  dispatch: (action: ActionInput) => string;
  reset: () => void;
};

const StoreContext = createContext<Store | null>(null);

function load(): ContractState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return parseState(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage falls back to the demo workspace.
  }
  return createSeed();
}

export function ContractProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, load);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage may be full or blocked; the session still works in memory.
    }
  }, [state]);

  const dispatch = useCallback((action: ActionInput) => {
    const uid = makeId();
    rawDispatch({ ...action, at: new Date().toISOString(), uid } as ContractAction);
    return uid;
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: "state/replace", state: createSeed(), reason: "reset the demo workspace" });
  }, [dispatch]);

  const value = useMemo(() => ({ state, dispatch, reset }), [state, dispatch, reset]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useContracts(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useContracts must be used inside ContractProvider");
  return store;
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
