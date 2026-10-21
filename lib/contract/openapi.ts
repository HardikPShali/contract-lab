import type { ContractState, Schema } from "./types.ts";

/** Exports one side of the workspace as an OpenAPI 3.1 document. */
export function toOpenApi(state: ContractState, side: "current" | "proposed") {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of state.endpoints) {
    const contract = e[side];
    if (!contract) continue;
    const op: Record<string, unknown> = {
      operationId: e.id,
      summary: e.label,
      responses: { [String(contract.status)]: { description: e.label, content: { "application/json": { schema: contract.response as Schema } } } },
    };
    if (contract.request) op.requestBody = { required: true, content: { "application/json": { schema: contract.request } } };
    const params = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    if (params.length) op.parameters = params;
    (paths[e.path] ??= {})[e.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.1.0",
    info: { title: `${state.project.name} · ${state.project.service}`, version: side === "current" ? state.project.baseVersion : `${state.project.baseVersion}+${state.project.branch}` },
    paths,
  };
}
