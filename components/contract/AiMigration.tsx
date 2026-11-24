"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleStop, Copy, RotateCcw, Sparkles } from "lucide-react";
import { buildMigrationRequest } from "@/lib/ai/migration";
import type { Endpoint } from "@/lib/contract/types";
import { useContracts } from "./store";

type Status = "idle" | "streaming" | "done" | "error";

/** Streams an AI-written migration guide for this endpoint's proposed change. */
export function AiMigration({ endpoint }: { endpoint: Endpoint }) {
  const { state } = useContracts();
  const [status, setStatus] = useState<Status>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Cancel an in-flight request on unmount; the parent keys this component by endpoint id.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("streaming");
    setText("");
    setError("");
    try {
      const res = await fetch("/api/ai/migration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildMigrationRequest(endpoint, state.consumers, state.project)),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setText((t) => t + decoder.decode(value, { stream: true }));
      }
      setStatus("done");
    } catch (e) {
      if (controller.signal.aborted) {
        setStatus("done");
        return;
      }
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Migration guide copied");
    } catch {
      toast.error("Copy failed. Select the text instead.");
    }
  }

  return (
    <section className="ai-migration" aria-labelledby="ai-migration-title">
      <div className="ai-migration-head">
        <div>
          <h3 id="ai-migration-title"><Sparkles />AI migration guide</h3>
          <p>Drafts a release summary, concrete steps for each affected consumer and a message to send to their owners.</p>
        </div>
        <div className="actions">
          {status === "done" && text ? <button className="secondary" onClick={copy}><Copy />Copy</button> : null}
          {status === "streaming" ? (
            <button className="secondary" onClick={() => abortRef.current?.abort()}><CircleStop />Stop</button>
          ) : (
            <button className="secondary primary" onClick={start}>
              {status === "idle" ? <><Sparkles />Draft migration guide</> : <><RotateCcw />Draft again</>}
            </button>
          )}
        </div>
      </div>
      <div aria-live="polite" aria-busy={status === "streaming"}>
        {status === "error" ? <p className="ai-error" role="alert">{error}</p> : null}
        {text ? <pre className="ai-output">{text}{status === "streaming" ? <span className="caret" aria-hidden="true">▍</span> : null}</pre> : null}
        {status === "streaming" && !text ? <p className="note">Reading the diff…</p> : null}
      </div>
    </section>
  );
}
