"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Toaster, toast } from "sonner";
import {
  AlertTriangle, ArrowRight, Braces, Check, ChevronDown, CircleAlert, Command, GitBranch, GitCompare, History, Pencil, Play,
  Plus, RotateCcw, Search, Settings, ShieldCheck, TerminalSquare, X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { allChanges, endpointChanges, gateFor } from "@/lib/contract/diff";
import type { Endpoint } from "@/lib/contract/types";
import { DiffTab } from "./DiffTab";
import { EditorModal, EndpointModal, ReviewModal } from "./Dialogs";
import { ImpactTab } from "./ImpactTab";
import { RequestTab } from "./RequestTab";
import { Empty, MethodTag, type Tab, type View } from "./shared";
import { ContractProvider, useContracts } from "./store";
import { HistoryView, RequestsView, SettingsView } from "./Views";

const noopSubscribe = () => () => {};

export function ContractApp() {
  // The workspace lives in localStorage, so render only after mount to avoid hydration mismatches.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return <main className="shell booting" aria-busy="true"><aside className="rail" /><aside className="catalog" /><section className="workspace" /></main>;
  return (
    <ContractProvider>
      <Workspace />
      <Toaster theme="dark" position="bottom-right" closeButton />
    </ContractProvider>
  );
}

const VIEWS: { id: View; label: string; icon: typeof Braces }[] = [
  { id: "contracts", label: "Contracts", icon: Braces },
  { id: "requests", label: "Request history", icon: TerminalSquare },
  { id: "history", label: "Activity", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
];

function readHash(): { view: View; endpointId?: string } {
  const [view, endpointId] = window.location.hash.slice(1).split("/");
  return VIEWS.some((v) => v.id === view) ? { view: view as View, endpointId } : { view: "contracts" };
}

function Workspace() {
  const { state, dispatch } = useContracts();
  const initial = readHash();
  const [view, setView] = useState<View>(initial.view);
  const [selectedId, setSelectedId] = useState(initial.endpointId ?? state.endpoints[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("compare");
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [replayBody, setReplayBody] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setView(h.view);
      if (h.endpointId) setSelectedId(h.endpointId);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next: View, endpointId?: string) => {
    window.location.hash = endpointId ? `${next}/${endpointId}` : next;
    setView(next);
    if (endpointId) setSelectedId(endpointId);
  }, []);

  const openEndpoint = (id: string, nextTab: Tab = "compare", body?: string) => {
    setReplayBody(body);
    setTab(nextTab);
    go("contracts", id);
  };

  const endpoint = state.endpoints.find((e) => e.id === selectedId) ?? state.endpoints[0];
  const q = query.trim().toLowerCase();
  const visible = state.endpoints.filter((e) =>
    (!q || `${e.method} ${e.path} ${e.label}`.toLowerCase().includes(q)) && (!onlyChanged || endpointChanges(e).length > 0),
  );
  const blockedTotal = state.endpoints.reduce((n, e) => n + gateFor(e, state).blocked.length, 0);
  const pendingChanges = allChanges(state).length;
  const initials = state.project.user.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className="shell">
      <aside className="rail">
        <div className="logo" aria-hidden><Command /></div>
        <nav aria-label="Primary">
          {VIEWS.map((v) => (
            <a key={v.id} href={`#${v.id}`} className={view === v.id ? "active" : undefined} aria-label={v.label} title={v.label} aria-current={view === v.id ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); go(v.id, v.id === "contracts" ? endpoint?.id : undefined); }}>
              <v.icon />
              {v.id === "requests" && state.requests.length ? <em className="dot" /> : null}
            </a>
          ))}
        </nav>
        <span className="avatar" title={state.project.user}>{initials}</span>
      </aside>

      <aside className="catalog" aria-label="Endpoints">
        <button className="project" onClick={() => go("settings")}>
          <span>{state.project.name.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase()}</span>
          <div><b>{state.project.name}</b><small>{state.project.service}</small></div>
          <ChevronDown />
        </button>
        <button className="branch" onClick={() => setReviewing(true)} title="Review and merge this branch">
          <GitBranch />{state.project.branch}
          {blockedTotal ? <em className="count bad">{blockedTotal}</em> : <ChevronDown />}
        </button>
        <label className="search"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search endpoints" aria-label="Search endpoints" /></label>
        <div className="catalog-head">
          <button className={onlyChanged ? "toggle on" : "toggle"} onClick={() => setOnlyChanged(!onlyChanged)} aria-pressed={onlyChanged}>Endpoints{onlyChanged ? " · changed" : ""}</button>
          <button onClick={() => setAdding(true)} aria-label="Add endpoint" title="Add endpoint"><Plus /></button>
        </div>
        <div className="endpoints">
          {visible.map((e) => <EndpointRow key={e.id} endpoint={e} selected={view === "contracts" && endpoint?.id === e.id} onClick={() => openEndpoint(e.id, tab)} />)}
          {!visible.length ? <p className="muted-note">No endpoints match.</p> : null}
        </div>
        <div className="catalog-foot"><span><ShieldCheck />OpenAPI 3.1 · {state.project.baseVersion}</span><small>{pendingChanges} pending change{pendingChanges === 1 ? "" : "s"}</small></div>
      </aside>

      <section className="workspace">
        {view === "contracts" ? (
          endpoint ? (
            <>
              <header>
                <div>
                  <MethodTag method={endpoint.method} />
                  <div><h1>{endpoint.path}</h1><p>{endpoint.label}{!endpoint.current ? " · new on branch" : !endpoint.proposed ? " · removed on branch" : ""}</p></div>
                </div>
                <div>
                  {endpoint.proposed ? (
                    <button className="secondary" onClick={() => setEditing(true)}><Pencil />Edit proposal</button>
                  ) : (
                    <button className="secondary" onClick={() => { dispatch({ type: "endpoint/restore", endpointId: endpoint.id }); toast("Endpoint restored on the branch"); }}><RotateCcw />Restore</button>
                  )}
                  <button className="primary" onClick={() => setReviewing(true)}><GitCompare />Open review{blockedTotal ? <em className="count">{blockedTotal}</em> : null}</button>
                </div>
              </header>
              <ReleaseBar endpoint={endpoint} onImpact={() => setTab("impact")} />
              <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="tabs">
                <TabsList variant="line" className="tab-list">
                  <TabsTrigger value="compare"><GitCompare />Schema diff</TabsTrigger>
                  <TabsTrigger value="request"><Play />Request lab</TabsTrigger>
                  <TabsTrigger value="impact"><ShieldCheck />Consumer impact</TabsTrigger>
                </TabsList>
                <TabsContent value="compare"><DiffTab key={endpoint.id + JSON.stringify(endpoint.proposed)} endpoint={endpoint} onOpenImpact={() => setTab("impact")} /></TabsContent>
                <TabsContent value="request"><RequestTab key={endpoint.id + (replayBody ?? "")} endpoint={endpoint} initialBody={replayBody} /></TabsContent>
                <TabsContent value="impact"><ImpactTab endpoint={endpoint} /></TabsContent>
              </Tabs>
            </>
          ) : <Empty title="No endpoints">Add an endpoint to start a contract.</Empty>
        ) : (
          <>
            <header><div><div><h1 className="title">{VIEWS.find((v) => v.id === view)!.label}</h1><p>{state.project.name} · {state.project.service}</p></div></div></header>
            {view === "requests" ? <RequestsView onReplay={(id, body) => openEndpoint(id, "request", body)} /> : view === "history" ? <HistoryView /> : <SettingsView key={JSON.stringify(state.project)} />}
          </>
        )}
      </section>

      {adding ? <EndpointModal open onOpenChange={setAdding} onCreated={(id) => openEndpoint(id, "compare")} /> : null}
      {reviewing ? <ReviewModal open onOpenChange={setReviewing} onOpenEndpoint={(id, t) => openEndpoint(id, t)} /> : null}
      {editing && endpoint ? <EditorModal key={endpoint.id} endpoint={endpoint} open onOpenChange={setEditing} /> : null}
    </main>
  );
}

function EndpointRow({ endpoint, selected, onClick }: { endpoint: Endpoint; selected: boolean; onClick: () => void }) {
  const changes = endpointChanges(endpoint);
  const worst = changes.some((c) => c.severity === "breaking") ? "breaking" : changes.some((c) => c.severity === "warning") ? "warning" : "safe";
  return (
    <button className={`endpoint${selected ? " selected" : ""}${!endpoint.proposed ? " removed" : ""}`} onClick={onClick} aria-current={selected}>
      <MethodTag method={endpoint.method} />
      <div><b>{endpoint.path}</b><small>{endpoint.label}{!endpoint.current ? " · new" : ""}</small></div>
      {changes.length ? <i className={worst} aria-label={`${changes.length} changes, worst ${worst}`}>{changes.length}</i> : <span />}
    </button>
  );
}

function ReleaseBar({ endpoint, onImpact }: { endpoint: Endpoint; onImpact: () => void }) {
  const { state } = useContracts();
  const changes = endpointChanges(endpoint);
  const gate = gateFor(endpoint, state);
  const warnings = changes.filter((c) => c.severity === "warning").length;

  let tone: "blocked" | "caution" | "clear" | "idle";
  let icon: React.ReactNode;
  let title: string;
  let detail: string;
  if (gate.blocked.length) {
    tone = "blocked"; icon = <X />;
    title = `${gate.breaking} breaking change${gate.breaking === 1 ? "" : "s"}`;
    detail = `This contract cannot merge until ${gate.blocked.map((i) => i.consumer.name).join(", ")} acknowledge${gate.blocked.length === 1 ? "s" : ""}.`;
  } else if (gate.breaking) {
    tone = "caution"; icon = <AlertTriangle />;
    title = `${gate.breaking} breaking change${gate.breaking === 1 ? "" : "s"} acknowledged`;
    detail = gate.acknowledged.length ? "Every affected consumer has confirmed. Release with a major version." : "No known consumer depends on the changed fields.";
  } else if (warnings) {
    tone = "caution"; icon = <CircleAlert />;
    title = `${warnings} risky change${warnings === 1 ? "" : "s"}`;
    detail = "Nothing is strictly breaking, but some callers may behave differently.";
  } else if (changes.length) {
    tone = "clear"; icon = <Check />;
    title = "Safe changes only"; detail = `${changes.length} backwards-compatible change${changes.length === 1 ? "" : "s"}.`;
  } else {
    tone = "idle"; icon = <Check />;
    title = "No changes on this branch"; detail = "The proposal matches main.";
  }
  return (
    <div className={`release-bar ${tone}`}>
      <div><span className="release-status">{icon}{title}</span><p>{detail}</p></div>
      {changes.length ? <button onClick={onImpact}>View affected consumers <ArrowRight /></button> : null}
    </div>
  );
}
