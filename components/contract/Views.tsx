"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, RotateCcw, RotateCw, Search, Upload } from "lucide-react";
import { Confirm } from "@/components/ui/dialog";
import { toOpenApi } from "@/lib/contract/openapi";
import type { HistoryEvent, Project } from "@/lib/contract/types";
import { Empty, MethodTag, timeAgo } from "./shared";
import { download, parseState, useContracts } from "./store";

export function RequestsView({ onReplay }: { onReplay: (endpointId: string, body: string) => void }) {
  const { state } = useContracts();
  const [open, setOpen] = useState<string | null>(null);
  if (!state.requests.length) {
    return <section className="page"><Empty title="No requests sent yet">Use the Request lab on any endpoint. Every call is recorded here so you can compare and replay it.</Empty></section>;
  }
  return (
    <section className="page">
      <div className="card">
        <div className="card-head"><div><h2>Request history</h2><p>The last {state.requests.length} simulated calls, newest first.</p></div></div>
        <ul className="request-log">
          {state.requests.map((r) => {
            const exists = state.endpoints.some((e) => e.id === r.endpointId);
            return (
              <li key={r.id}>
                <button className="request-row" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                  <MethodTag method={r.method} />
                  <code>{r.path}</code>
                  <span className="target">{r.target}</span>
                  <b className={r.status < 300 ? "good" : "bad"}>{r.status}</b>
                  <span className="muted">{r.latencyMs}ms · {timeAgo(r.at)}</span>
                </button>
                {open === r.id ? (
                  <div className="request-detail">
                    <div><span>Request body</span><pre>{r.body || "(none)"}</pre></div>
                    <div><span>Response</span><pre>{r.response}</pre></div>
                    <button className="secondary" disabled={!exists} onClick={() => onReplay(r.endpointId, r.body)}><RotateCw />Open in Request lab</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const KINDS: { id: HistoryEvent["kind"]; label: string }[] = [
  { id: "edit", label: "Edits" },
  { id: "endpoint", label: "Endpoints" },
  { id: "ack", label: "Acknowledgements" },
  { id: "notify", label: "Notifications" },
  { id: "merge", label: "Merges" },
  { id: "settings", label: "Settings" },
];

export function HistoryView() {
  const { state } = useContracts();
  const [kind, setKind] = useState<"" | HistoryEvent["kind"]>("");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const events = state.history.filter((e) => (!kind || e.kind === kind) && (!q || `${e.summary} ${e.detail}`.toLowerCase().includes(q)));
  return (
    <section className="page">
      <div className="card">
        <div className="toolbar">
          <label className="search"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search history" aria-label="Search history" /></label>
        </div>
        <div className="filters" role="group" aria-label="Filter history">
          <button className={!kind ? "pill active" : "pill"} onClick={() => setKind("")}>All <b>{state.history.length}</b></button>
          {KINDS.map((k) => (
            <button key={k.id} className={kind === k.id ? "pill active" : "pill"} onClick={() => setKind(k.id)}>{k.label} <b>{state.history.filter((e) => e.kind === k.id).length}</b></button>
          ))}
        </div>
        {!events.length ? <Empty title="Nothing matches" /> : null}
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id} className={e.kind}>
              <time dateTime={e.at}>{timeAgo(e.at)}</time>
              <p><b>{e.summary}</b><small>{e.detail}</small></p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function SettingsView() {
  const { state, dispatch, reset } = useContracts();
  const [form, setForm] = useState<Project>(state.project);
  const [resetting, setResetting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(state.project);
  const valid = form.name.trim() && form.service.trim() && /^[\w./-]+$/.test(form.branch.trim()) && form.user.trim();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    dispatch({ type: "project/update", patch: { name: form.name.trim(), service: form.service.trim(), branch: form.branch.trim(), user: form.user.trim() } });
    toast.success("Project settings saved");
  };

  const importFile = async (f: File) => {
    try {
      dispatch({ type: "state/replace", state: parseState(JSON.parse(await f.text())), reason: `imported ${f.name}` });
      toast.success("Workspace imported");
    } catch {
      toast.error("That file is not a valid Contract Lab backup.");
    }
  };

  return (
    <section className="page">
      <form className="card form" onSubmit={save}>
        <div className="card-head"><div><h2>Project</h2><p>Identity of the API under review.</p></div></div>
        <div className="form-grid">
          <label>Project name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} /></label>
          <label>Service<input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} maxLength={40} /></label>
          <label>Review branch<input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} maxLength={60} aria-invalid={!/^[\w./-]+$/.test(form.branch.trim())} /></label>
          <label>Your name<input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} maxLength={40} /></label>
          <label>Main version<input value={state.project.baseVersion} disabled /><small className="hint">Bumped automatically on merge (semver: breaking → major).</small></label>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" disabled={!dirty} onClick={() => setForm(state.project)}>Cancel</button>
          <button className="primary" disabled={!dirty || !valid}>Save</button>
        </div>
      </form>
      <div className="card">
        <div className="card-head"><div><h2>Export</h2><p>OpenAPI 3.1 documents for either side, or a full backup of this workspace.</p></div></div>
        <div className="data-actions">
          <button className="secondary" onClick={() => download(`${state.project.service}-main.openapi.json`, JSON.stringify(toOpenApi(state, "current"), null, 2), "application/json")}><Download />OpenAPI · main</button>
          <button className="secondary" onClick={() => download(`${state.project.service}-branch.openapi.json`, JSON.stringify(toOpenApi(state, "proposed"), null, 2), "application/json")}><Download />OpenAPI · {state.project.branch}</button>
          <button className="secondary" onClick={() => download("contract-lab-backup.json", JSON.stringify(state, null, 2), "application/json")}><Download />Backup</button>
          <button className="secondary" onClick={() => file.current?.click()}><Upload />Import backup</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
          <button className="secondary danger-text" onClick={() => setResetting(true)}><RotateCcw />Reset demo data</button>
        </div>
      </div>
      <Confirm open={resetting} onOpenChange={setResetting} danger confirmLabel="Reset" title="Reset the demo workspace?"
        description="Endpoints, consumers, acknowledgements and history return to the sample data." onConfirm={() => { reset(); toast.success("Workspace reset"); }} />
    </section>
  );
}
