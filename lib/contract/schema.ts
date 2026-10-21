import type { Schema } from "./types.ts";

export type Line = { text: string; path?: string };

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}.${name}` : name;
}

/** Pretty-prints a schema like JSON.stringify(_, null, 2) while tagging the line that opens each field. */
export function printSchema(schema: Schema | undefined): Line[] {
  if (!schema) return [{ text: "// no body" }];
  return printObject("", schema, "", "");
}

function printObject(prefix: string, schema: Schema, path: string, ind: string): Line[] {
  const entries = Object.entries(schema);
  if (!entries.length) return [{ text: `${ind}${prefix}{}` }];
  const lines: Line[] = [{ text: `${ind}${prefix}{` }];
  entries.forEach(([key, value], i) => {
    let block: Line[];
    if (key === "properties" && value && typeof value === "object") {
      const props = Object.entries(value as Record<string, Schema>);
      if (!props.length) block = [{ text: `${ind}  "properties": {}` }];
      else {
        block = [{ text: `${ind}  "properties": {` }];
        props.forEach(([name, sub], j) => {
          const p = joinPath(path, name);
          const child = printObject(`${JSON.stringify(name)}: `, sub, p, `${ind}    `);
          child[0]!.path = p;
          if (j < props.length - 1) child[child.length - 1]!.text += ",";
          block.push(...child);
        });
        block.push({ text: `${ind}  }` });
      }
    } else if (key === "items" && value && typeof value === "object" && !Array.isArray(value)) {
      block = printObject(`"items": `, value as Schema, `${path}[]`, `${ind}  `);
      block[0]!.path = `${path}[]`;
    } else {
      block = [{ text: `${ind}  ${JSON.stringify(key)}: ${JSON.stringify(value)}` }];
    }
    if (i < entries.length - 1) block[block.length - 1]!.text += ",";
    lines.push(...block);
  });
  lines.push({ text: `${ind}}` });
  return lines;
}

export type DiffRow = { left?: Line; right?: Line; leftNo?: number; rightNo?: number; kind: "same" | "removed" | "added" | "changed" };

/** Side-by-side alignment: LCS on line text, with adjacent removals and additions paired into "changed" rows. */
export function alignLines(left: Line[], right: Line[]): DiffRow[] {
  const a = left.map((l) => l.text.trim().replace(/,$/, ""));
  const b = right.map((l) => l.text.trim().replace(/,$/, ""));
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let removed: number[] = [];
  let added: number[] = [];
  const flush = () => {
    const n = Math.max(removed.length, added.length);
    for (let k = 0; k < n; k++) {
      const l = removed[k];
      const r = added[k];
      rows.push({
        left: l === undefined ? undefined : left[l],
        right: r === undefined ? undefined : right[r],
        leftNo: l === undefined ? undefined : l + 1,
        rightNo: r === undefined ? undefined : r + 1,
        kind: l !== undefined && r !== undefined ? "changed" : l !== undefined ? "removed" : "added",
      });
    }
    removed = [];
    added = [];
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      rows.push({ left: left[i], right: right[j], leftNo: i + 1, rightNo: j + 1, kind: "same" });
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
      removed.push(i++);
    } else {
      added.push(j++);
    }
  }
  flush();
  return rows;
}

export type ValidationError = { path: string; message: string };

const FORMATS: Record<NonNullable<Schema["format"]>, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
  uri: /^[a-z][a-z0-9+.-]*:\/\/\S+$/i,
};

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

export function validate(value: unknown, schema: Schema, path = ""): ValidationError[] {
  const errors: ValidationError[] = [];
  const at = path || "body";
  const actual = typeOf(value);
  if (schema.type) {
    const ok = schema.type === actual || (schema.type === "number" && actual === "integer");
    if (!ok) return [{ path: at, message: `expected ${schema.type}, got ${actual}` }];
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errors.push({ path: at, message: `must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}` });
  }
  if (typeof value === "string") {
    if (schema.format && !FORMATS[schema.format].test(value)) errors.push({ path: at, message: `must be a valid ${schema.format}` });
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path: at, message: `must be at least ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path: at, message: `must be at most ${schema.maxLength} characters` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: at, message: `must be ≥ ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: at, message: `must be ≤ ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path: at, message: `needs at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path: at, message: `allows at most ${schema.maxItems} items` });
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items!, `${path}[${i}]`)));
  }
  if (actual === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push({ path: joinPath(path, key), message: "is required" });
    }
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validate(v, sub, joinPath(path, key)));
      else if (schema.additionalProperties === false) errors.push({ path: joinPath(path, key), message: "is not an allowed field" });
    }
  }
  return errors;
}

/** Builds a plausible response from a schema, echoing request values for fields with the same name. */
export function sample(schema: Schema, echo: Record<string, unknown> = {}, name = ""): unknown {
  if (schema.example !== undefined) return schema.example;
  if (name && name in echo && validate(echo[name], schema).length === 0) return echo[name];
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) out[key] = sample(sub, echo, key);
      return out;
    }
    case "array":
      return schema.items ? [sample(schema.items, {}, "")] : [];
    case "integer":
      return Math.max(schema.minimum ?? 1, 1);
    case "number":
      return schema.minimum ?? 49.9;
    case "boolean":
      return true;
    case "string":
      if (schema.format === "uuid") return "6f1c2a7e-3b9d-4c51-8e2a-1d7f0b9c4e33";
      if (schema.format === "date-time") return "2026-10-21T12:00:00Z";
      if (schema.format === "email") return "ana@northstar.io";
      if (schema.format === "uri") return "https://api.northstar.io/v1/resource";
      return name ? `${name}_value` : "value";
    default:
      return null;
  }
}
