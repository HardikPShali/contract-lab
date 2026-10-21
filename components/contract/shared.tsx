"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, Check, CircleAlert } from "lucide-react";
import type { Method, Severity } from "@/lib/contract/types";

export type View = "contracts" | "requests" | "history" | "settings";
export type Tab = "compare" | "request" | "impact";

export function timeAgo(at: string): string {
  const ms = Date.now() - Date.parse(at);
  if (ms < 60_000) return "just now";
  return `${formatDistanceToNowStrict(new Date(at))} ago`;
}

export function MethodTag({ method }: { method: Method }) {
  return <span className={`method ${method.toLowerCase()}`}>{method}</span>;
}

const SEVERITY: Record<Severity, { label: string; icon: React.ReactNode }> = {
  breaking: { label: "Breaking", icon: <AlertTriangle /> },
  warning: { label: "Risky", icon: <CircleAlert /> },
  safe: { label: "Safe", icon: <Check /> },
};

/** Severity always pairs color with an icon and a label. */
export function SeverityTag({ severity }: { severity: Severity }) {
  return <span className={`sev ${severity}`}>{SEVERITY[severity].icon}{SEVERITY[severity].label}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
