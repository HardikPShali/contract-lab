"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Play, TerminalSquare, Wand2 } from "lucide-react";
import { simulateRequest } from "@/lib/contract/reducer";
import { sample, validate, type ValidationError } from "@/lib/contract/schema";
import type { Endpoint } from "@/lib/contract/types";
import { useContracts } from "./store";

type Result = { status: number; latencyMs: number; body: string; target: "main" | "branch" };

/** Example body for one side; with no side given, prefer what today's callers send (main). */
function exampleBody(endpoint: Endpoint, target?: "main" | "branch"): string {
  const schema = target === "branch" ? endpoint.proposed?.request : target === "main" ? endpoint.current?.request : (endpoint.current?.request ?? endpoint.proposed?.request);
  return schema ? JSON.stringify(sample(schema), null, 2) : "";
}

export function RequestTab({ endpoint, initialBody }: { endpoint: Endpoint; initialBody?: string }) {
  const { state, dispatch } = useContracts();
  const [target, setTarget] = useState<"main" | "branch">(endpoint.proposed ? "branch" : "main");
  const [body, setBody] = useState(initialBody ?? exampleBody(endpoint));
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState<"" | "body" | "curl">("");

  const contract = target === "main" ? endpoint.current : endpoint.proposed;
  const takesBody = !!contract?.request;

  // Live preview of what each side of the contract would say about the current body.
  const check = useMemo(() => {
    const run = (schema = contract?.request): { parse?: string; errors: ValidationError[] } => {
      if (!schema) return { errors: [] };
      try {
        return { errors: body.trim() ? validate(JSON.parse(body), schema) : [{ path: "body", message: "is required" }] };
      } catch (e) {
        return { parse: (e as Error).message, errors: [] };
      }
    };
    return { here: run(), main: run(endpoint.current?.request), branch: run(endpoint.proposed?.request) };
  }, [body, contract, endpoint]);

  const send = () => {
    setPending(true);
    const seed = Math.floor(Math.random() * 1000);
    const res = simulateRequest(endpoint, target, body, seed);
    const text = JSON.stringify(res.body, null, 2);
    // Show the simulated latency so the panel behaves like a real round trip.
    window.setTimeout(() => {
      setResult({ status: res.status, latencyMs: res.latencyMs, body: text, target });
      setPending(false);
      dispatch({ type: "request/send", endpointId: endpoint.id, target, body: takesBody ? body : "", status: res.status, latencyMs: res.latencyMs, response: text });
    }, res.latencyMs);
  };

  const curl = () => {
    const url = `https://api.northstar.io${endpoint.path.replace(/\{(\w+)\}/g, "ord_9812")}`;
    const data = takesBody ? ` \\\n  -H 'Content-Type: application/json' \\\n  -d '${body.replace(/'/g, "'\\''")}'` : "";
    return `curl -X ${endpoint.method} '${url}'${data}`;
  };

  const copy = (what: "body" | "curl") => {
    void navigator.clipboard?.writeText(what === "body" ? body : curl());
    setCopied(what);
    window.setTimeout(() => setCopied(""), 1000);
  };

  const compat = takesBody && endpoint.current?.request && endpoint.proposed?.request && !check.main.parse
    ? check.main.errors.length === 0 && check.branch.errors.length > 0
      ? "This body works on main but fails on the branch — an existing caller sending it would break."
      : check.main.errors.length > 0 && check.branch.errors.length === 0
        ? "This body fails on main but passes on the branch."
        : null
    : null;

  return (
    <div className="request-lab">
      <section>
        <div className="request-head">
          <span>Request</span>
          <div className="segmented small" role="group" aria-label="Target">
            <button aria-pressed={target === "main"} disabled={!endpoint.current} onClick={() => setTarget("main")}>main</button>
            <button aria-pressed={target === "branch"} disabled={!endpoint.proposed} onClick={() => setTarget("branch")}>{state.project.branch}</button>
          </div>
        </div>
        {takesBody ? (
          <>
            <div className="request-tools">
              <button onClick={() => setBody(exampleBody(endpoint, target))} title={`Generate a valid body for ${target}`}><Wand2 />Example for {target}</button>
              <button onClick={() => copy("body")}>{copied === "body" ? <Check /> : <Copy />}{copied === "body" ? "Copied" : "Copy"}</button>
              <button onClick={() => copy("curl")}>{copied === "curl" ? <Check /> : <TerminalSquare />}{copied === "curl" ? "Copied" : "cURL"}</button>
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} aria-label="Request body" aria-invalid={!!check.here.parse || check.here.errors.length > 0} />
            <div className="validation" aria-live="polite">
              {check.here.parse ? <p className="bad">Invalid JSON: {check.here.parse}</p>
                : check.here.errors.length ? check.here.errors.map((e) => <p key={`${e.path}${e.message}`} className="bad"><code>{e.path}</code> {e.message}</p>)
                  : <p className="good"><Check />Valid against {target === "main" ? "main" : "the proposed"} contract</p>}
              {compat ? <p className="warn">{compat}</p> : null}
            </div>
          </>
        ) : (
          <div className="no-body">
            <p>{contract ? `${endpoint.method} requests take no body.` : `This endpoint does not exist on ${target}.`}</p>
            <button onClick={() => copy("curl")}>{copied === "curl" ? <Check /> : <TerminalSquare />}{copied === "curl" ? "Copied" : "Copy cURL"}</button>
          </div>
        )}
        <button className="send" onClick={send} disabled={pending}><Play />{pending ? "Sending…" : `Send to ${target === "main" ? "main" : "branch"}`}</button>
      </section>
      <section className="response">
        <div>
          <span>Response</span>
          {result ? <b className={result.status < 300 ? "good" : "bad"}>{result.status} · {result.latencyMs}ms · {result.target}</b> : null}
        </div>
        {result ? <pre className={result.status < 300 ? "" : "error"}>{result.body}</pre> : (
          <div className="response-empty"><Play /><p>{pending ? "Waiting for response…" : "Send the request to inspect the response."}</p></div>
        )}
      </section>
    </div>
  );
}
