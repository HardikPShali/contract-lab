"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Code2, ListChecks } from "lucide-react";
import { Modal } from "@/components/ui/dialog";
import { endpointChanges, impactFor } from "@/lib/contract/diff";
import { alignLines, printSchema } from "@/lib/contract/schema";
import type { Change, Direction, Endpoint } from "@/lib/contract/types";
import { Empty, SeverityTag } from "./shared";
import { useContracts } from "./store";

const ORDER = { breaking: 0, warning: 1, safe: 2 } as const;

export function DiffTab({ endpoint, onOpenImpact }: { endpoint: Endpoint; onOpenImpact: () => void }) {
  const { state } = useContracts();
  const changes = useMemo(() => endpointChanges(endpoint).sort((a, b) => ORDER[a.severity] - ORDER[b.severity]), [endpoint]);
  const hasRequest = !!(endpoint.current?.request || endpoint.proposed?.request);
  const firstDir = changes[0]?.direction ?? (hasRequest ? "request" : "response");
  const [direction, setDirection] = useState<Direction>(firstDir);
  const [focus, setFocus] = useState<Change | null>(null);
  const [json, setJson] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // Named `base` because the React Compiler treats any `.current` read as a ref access.
  const { current: base, proposed } = endpoint;
  const rows = useMemo(() => {
    const side = (c: Endpoint["current"]) => (c ? (direction === "request" ? c.request : c.response) : undefined);
    return alignLines(printSchema(side(base)), printSchema(side(proposed)));
  }, [base, proposed, direction]);

  // Scroll the inspected field's line into view once its direction is showing.
  useEffect(() => {
    if (!focus || focus.direction !== direction) return;
    scroller.current?.querySelector(".row.focus")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, direction]);

  const inspect = (c: Change) => {
    setDirection(c.direction);
    setFocus(c);
  };
  const focused = (path?: string) => !!focus && focus.direction === direction && !!path && path === focus.path;
  const affected = impactFor(endpoint, state.consumers, changes).filter((i) => i.changes.length);
  const counts = { breaking: changes.filter((c) => c.severity === "breaking").length, other: changes.filter((c) => c.severity !== "breaking").length };

  return (
    <div className="compare-layout">
      <section className="diff">
        <div className="diff-toolbar">
          <div className="segmented" role="group" aria-label="Schema">
            <button aria-pressed={direction === "request"} disabled={!hasRequest} onClick={() => setDirection("request")}>Request body</button>
            <button aria-pressed={direction === "response"} onClick={() => setDirection("response")}>Response {endpoint.proposed?.status ?? endpoint.current?.status}</button>
          </div>
          <span className="legend"><i className="removed" />removed <i className="added" />added</span>
        </div>
        <div className="diff-head">
          <div><span>Current</span><b>main · {state.project.baseVersion}</b></div>
          <div><span>Proposed</span><b>{state.project.branch}</b></div>
        </div>
        <div className="editors" ref={scroller} role="table" aria-label={`${direction} schema diff`}>
          {rows.map((r, i) => (
            <div key={i} className={`row ${r.kind}${focused(r.left?.path) || focused(r.right?.path) ? " focus" : ""}`} role="row">
              <div className={`line${r.left ? "" : " blank"}`} role="cell"><span>{r.leftNo ?? ""}</span><code>{r.left?.text ?? ""}</code></div>
              <div className={`line${r.right ? "" : " blank"}`} role="cell"><span>{r.rightNo ?? ""}</span><code>{r.right?.text ?? ""}</code></div>
            </div>
          ))}
        </div>
      </section>

      <aside className="findings" aria-label="Review findings">
        <div className="find-head">
          <div><span>Review findings</span><b>{changes.length}</b></div>
          <button onClick={() => setJson(true)} disabled={!changes.length}><Code2 />JSON</button>
        </div>
        {!changes.length ? <Empty title="No contract changes">This endpoint is identical on both branches.</Empty> : null}
        {changes.length ? <p className="find-summary">{counts.breaking} breaking · {counts.other} other</p> : null}
        {changes.map((c) => (
          <article key={c.id} className={`${c.severity}${focus?.id === c.id ? " active" : ""}`}>
            <div>
              <small><SeverityTag severity={c.severity} /> · {c.direction}</small>
              <h2>{c.title}</h2>
              <p>{c.detail}</p>
              <button onClick={() => inspect(c)}>Inspect change <ChevronRight /></button>
            </div>
          </article>
        ))}
        {affected.length ? (
          <section className="consumer">
            <span>Affected consumers</span>
            {affected.map((i) => (
              <div key={i.consumer.id}><b>{i.consumer.name}</b><small>{i.breaking.length ? `${i.breaking.length} breaking` : `${i.changes.length} risky`}</small></div>
            ))}
            <button onClick={onOpenImpact}><ListChecks />Review consumer impact</button>
          </section>
        ) : null}
      </aside>

      <Modal open={json} onOpenChange={setJson} title="Findings as JSON" description="Machine-readable output, suitable for a CI check." wide>
        <pre className="raw">{JSON.stringify(changes.map((c) => ({ severity: c.severity, direction: c.direction, path: c.path, kind: c.kind, title: c.title, detail: c.detail })), null, 2)}</pre>
      </Modal>
    </div>
  );
}
