"use client";

import { toast } from "sonner";
import { Bell, CheckCircle2, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { ackKey, endpointChanges, gateFor, impactFor } from "@/lib/contract/diff";
import type { Endpoint } from "@/lib/contract/types";
import { Empty, SeverityTag, timeAgo } from "./shared";
import { useContracts } from "./store";

export function ImpactTab({ endpoint }: { endpoint: Endpoint }) {
  const { state, dispatch } = useContracts();
  const changes = endpointChanges(endpoint);
  const impacts = impactFor(endpoint, state.consumers, changes);
  const gate = gateFor(endpoint, state);
  const usage = (consumerId: string) => state.consumers.find((c) => c.id === consumerId)?.uses.find((u) => u.endpointId === endpoint.id);

  if (!impacts.length) return <Empty title="No known consumers">No application has called this endpoint in the last 30 days.</Empty>;

  return (
    <div className="impact-view">
      <div className={gate.blocked.length ? "gate blocked" : "gate clear"}>
        {gate.blocked.length ? <ShieldAlert /> : <ShieldCheck />}
        <div>
          <b>{gate.blocked.length ? `${gate.blocked.length} consumer${gate.blocked.length === 1 ? "" : "s"} must acknowledge before merge` : gate.breaking ? "All affected consumers have acknowledged" : "No consumer is broken by this change"}</b>
          <p>
            {gate.breaking ? `${gate.breaking} breaking change${gate.breaking === 1 ? "" : "s"} on this endpoint.` : "Only safe or risky changes."}
            {gate.unconsumedBreaking ? ` ${gate.unconsumedBreaking} of them affect no known consumer.` : ""}
          </p>
        </div>
      </div>

      <div className="consumers">
        {impacts.map((i) => {
          const key = ackKey(i.consumer.id, endpoint.id);
          const ack = state.acks[key];
          const stale = ack && ack.fingerprint !== i.fingerprint;
          const valid = ack && !stale;
          const notified = state.notified[key];
          const use = usage(i.consumer.id);
          return (
            <article key={i.consumer.id} className={i.breaking.length ? (valid ? "acked" : "needs") : "fine"}>
              <header>
                <div><b>{i.consumer.name}</b><small>Owner: {i.consumer.owner} · last call {timeAgo(i.consumer.lastCall)}</small></div>
                {i.breaking.length ? (
                  valid ? <span className="pill ok"><CheckCircle2 />Acknowledged</span> : <span className="pill bad"><ShieldAlert />{stale ? "Acknowledgement outdated" : "Action needed"}</span>
                ) : <span className="pill neutral">{i.changes.length ? "Review suggested" : "Not affected"}</span>}
              </header>
              <p className="uses">
                {use?.sends.length ? <>Sends <code>{use.sends.join(", ")}</code>. </> : null}
                Reads <code>{use?.reads.join(", ") || "nothing"}</code>.
              </p>
              {i.changes.length ? (
                <ul>
                  {i.changes.map((c) => <li key={c.id}><SeverityTag severity={c.severity} /><span><b>{c.title}</b> {c.detail}</span></li>)}
                </ul>
              ) : null}
              {stale ? <p className="note">The breaking changes were edited after {ack.by} acknowledged them {timeAgo(ack.at)}. Ask the owner to confirm again.</p> : null}
              {valid ? <p className="note">Acknowledged by {ack.by} {timeAgo(ack.at)}.</p> : null}
              {i.breaking.length ? (
                <div className="actions">
                  <button className="secondary" onClick={() => { dispatch({ type: "notify", consumerId: i.consumer.id, endpointId: endpoint.id }); toast.success(`${i.consumer.owner} notified`); }}>
                    <Bell />{notified ? `Notified ${timeAgo(notified)}` : "Notify owner"}
                  </button>
                  {valid ? (
                    <button className="secondary" onClick={() => dispatch({ type: "unack", consumerId: i.consumer.id, endpointId: endpoint.id })}><Undo2 />Withdraw</button>
                  ) : (
                    <button className="primary" onClick={() => { dispatch({ type: "ack", consumerId: i.consumer.id, endpointId: endpoint.id, fingerprint: i.fingerprint }); toast.success(`${i.consumer.name} acknowledged`); }}>
                      <CheckCircle2 />Record acknowledgement
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
