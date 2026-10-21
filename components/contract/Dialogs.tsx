"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { GitMerge, RotateCcw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { Confirm, Modal } from "@/components/ui/dialog";
import { allChanges, endpointChanges, gateFor, nextVersion } from "@/lib/contract/diff";
import { endpointIdFor } from "@/lib/contract/reducer";
import type { Endpoint, Method, Schema } from "@/lib/contract/types";
import { MethodTag } from "./shared";
import { parseSchema, useContracts } from "./store";

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function EndpointModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const { state, dispatch } = useContracts();
  const [method, setMethod] = useState<Method>("GET");
  const [path, setPath] = useState("/v1/");
  const [label, setLabel] = useState("");
  const pathOk = /^\/[A-Za-z0-9_\-/{}.]*$/.test(path.trim()) && path.trim().length > 1;
  const exists = state.endpoints.some((e) => e.method === method && e.path === path.trim());
  const valid = pathOk && !exists;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const uid = dispatch({ type: "endpoint/create", method, path, label });
    onCreated(endpointIdFor(uid));
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add endpoint" description={`The endpoint is added to ${state.project.branch}. Adding an endpoint is never breaking.`}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label>Method<select value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="grow">
            Path
            <input autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="/v1/shipments/{id}" aria-invalid={!valid} />
          </label>
        </div>
        {exists ? <small className="error">{method} {path} already exists.</small> : !pathOk ? <small className="error">Use a path like /v1/shipments/&#123;id&#125;.</small> : null}
        <label>Name<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Get shipment" maxLength={40} /></label>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => onOpenChange(false)}>Cancel</button>
          <button className="primary" disabled={!valid}>Add endpoint</button>
        </div>
      </form>
    </Modal>
  );
}

function parseDraft(text: string): { schema?: Schema; error?: string } {
  if (!text.trim()) return {};
  try {
    return { schema: parseSchema(JSON.parse(text)) };
  } catch (e) {
    const err = e as Error & { issues?: { path: (string | number)[]; message: string }[] };
    if (err.issues?.length) return { error: err.issues.map((i) => `${i.path.join(".") || "schema"}: ${i.message}`).slice(0, 3).join(" · ") };
    return { error: err.message };
  }
}

export function EditorModal({ endpoint, open, onOpenChange }: { endpoint: Endpoint; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, dispatch } = useContracts();
  const proposed = endpoint.proposed;
  const [side, setSide] = useState<"request" | "response">(proposed?.request ? "request" : "response");
  const [drafts, setDrafts] = useState({
    request: proposed?.request ? JSON.stringify(proposed.request, null, 2) : "",
    response: proposed ? JSON.stringify(proposed.response, null, 2) : "",
  });
  const [status, setStatus] = useState(proposed?.status ?? 200);
  const [removing, setRemoving] = useState(false);
  const parsed = { request: parseDraft(drafts.request), response: parseDraft(drafts.response) };
  const valid = !parsed.request.error && !parsed.response.error && !!parsed.response.schema && status >= 100 && status <= 599;

  // Preview the review findings the edit would produce before saving it.
  const preview = useMemo(() => {
    if (!valid) return null;
    const next: Endpoint = { ...endpoint, proposed: { status, request: parsed.request.schema, response: parsed.response.schema! } };
    const changes = endpointChanges(next);
    return { breaking: changes.filter((c) => c.severity === "breaking").length, total: changes.length };
  }, [valid, endpoint, status, parsed.request.schema, parsed.response.schema]);

  if (!proposed) return null;

  const save = () => {
    if (!valid) return;
    dispatch({ type: "schema/edit", endpointId: endpoint.id, request: parsed.request.schema, response: parsed.response.schema!, status });
    toast.success("Proposal updated", { description: preview ? `${preview.total} change${preview.total === 1 ? "" : "s"}, ${preview.breaking} breaking.` : undefined });
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Edit proposal · ${endpoint.method} ${endpoint.path}`} description={`Changes apply to ${state.project.branch}; main stays untouched until merge.`} wide>
      <div className="editor-tabs">
        <div className="segmented" role="group" aria-label="Schema">
          <button aria-pressed={side === "request"} onClick={() => setSide("request")}>Request body</button>
          <button aria-pressed={side === "response"} onClick={() => setSide("response")}>Response</button>
        </div>
        <label className="status-field">Success status<input type="number" min={100} max={599} value={status} onChange={(e) => setStatus(Number(e.target.value))} /></label>
      </div>
      <textarea className="schema-input" spellCheck={false} value={drafts[side]} aria-label={`${side} schema`}
        placeholder={side === "request" ? "Leave empty for no request body" : "{ \"type\": \"object\" }"}
        onChange={(e) => setDrafts({ ...drafts, [side]: e.target.value })} />
      <div className="validation">
        {parsed[side].error ? <p className="bad">{parsed[side].error}</p> : side === "response" && !parsed.response.schema ? <p className="bad">A response schema is required.</p> : <p className="good">Valid schema</p>}
        {preview ? <p className={preview.breaking ? "warn" : "good"}>After saving: {preview.total} change{preview.total === 1 ? "" : "s"} against main, {preview.breaking} breaking.</p> : null}
      </div>
      <div className="modal-actions">
        <div>
          {endpoint.current ? <button className="ghost" onClick={() => { dispatch({ type: "endpoint/restore", endpointId: endpoint.id }); onOpenChange(false); toast("Reverted to main"); }}><RotateCcw />Revert to main</button> : null}
          <button className="ghost danger-text" onClick={() => setRemoving(true)}><Trash2 />Remove endpoint</button>
        </div>
        <div>
          <button className="secondary" onClick={() => onOpenChange(false)}>Cancel</button>
          <button className="primary" onClick={save} disabled={!valid}>Save proposal</button>
        </div>
      </div>
      <Confirm open={removing} onOpenChange={setRemoving} danger confirmLabel="Remove"
        title={`Remove ${endpoint.method} ${endpoint.path}?`}
        description={endpoint.current ? "Removal is a breaking change for every consumer of this endpoint. You can revert it until merge." : "This draft endpoint only exists on the branch and will be discarded."}
        onConfirm={() => { dispatch({ type: "endpoint/remove", endpointId: endpoint.id }); onOpenChange(false); }} />
    </Modal>
  );
}

export function ReviewModal({ open, onOpenChange, onOpenEndpoint }: { open: boolean; onOpenChange: (o: boolean) => void; onOpenEndpoint: (id: string, tab: "impact") => void }) {
  const { state, dispatch } = useContracts();
  const changes = allChanges(state);
  const rows = state.endpoints
    .map((e) => ({ endpoint: e, changes: endpointChanges(e), gate: gateFor(e, state) }))
    .filter((r) => r.changes.length);
  const blocked = rows.filter((r) => r.gate.blocked.length);
  const version = nextVersion(state.project.baseVersion, changes);

  const merge = () => {
    dispatch({ type: "merge" });
    toast.success(`Merged as ${version}`, { description: `${state.project.branch} is now the main contract.` });
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Review ${state.project.branch}`} description={`Merging into main ${state.project.baseVersion} would release ${version}.`} wide>
      {!rows.length ? <p className="muted-note">The branch has no contract changes. Edit an endpoint&apos;s proposal to start a review.</p> : (
        <table className="review">
          <thead><tr><th>Endpoint</th><th>Changes</th><th>Breaking</th><th>Gate</th></tr></thead>
          <tbody>
            {rows.map(({ endpoint: e, changes: c, gate }) => (
              <tr key={e.id}>
                <th><MethodTag method={e.method} /> <code>{e.path}</code></th>
                <td>{c.length}</td>
                <td className={gate.breaking ? "bad" : ""}>{gate.breaking}</td>
                <td>
                  {gate.blocked.length ? (
                    <button className="link bad" onClick={() => { onOpenEndpoint(e.id, "impact"); onOpenChange(false); }}><ShieldAlert />{gate.blocked.length} awaiting acknowledgement</button>
                  ) : <span className="good"><ShieldCheck />Clear</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <p className={blocked.length ? "bad" : "good"}>
          {blocked.length ? `Merge is blocked by ${blocked.length} endpoint${blocked.length === 1 ? "" : "s"}.` : rows.length ? "Every gate is clear." : ""}
        </p>
        <div>
          <button className="secondary" onClick={() => onOpenChange(false)}>Close</button>
          <button className="primary" disabled={!rows.length || blocked.length > 0} onClick={merge}><GitMerge />Merge as {version}</button>
        </div>
      </div>
    </Modal>
  );
}
