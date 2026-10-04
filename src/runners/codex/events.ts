import type { CodexItem, CodexParsed, CodexUsage } from "./types.ts";

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === "object" && !Array.isArray(x) ? (x as Rec) : {});
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

export function readUsage(x: unknown): CodexUsage | null {
  const u = rec(x);
  if (Object.keys(u).length === 0) return null;
  return {
    input_tokens: num(u.input_tokens),
    cached_input_tokens: num(u.cached_input_tokens),
    output_tokens: num(u.output_tokens),
    reasoning_output_tokens: num(u.reasoning_output_tokens),
  };
}

const add = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export function addUsage(a: CodexUsage | null, b: CodexUsage | null): CodexUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    input_tokens: add(a.input_tokens, b.input_tokens),
    cached_input_tokens: add(a.cached_input_tokens, b.cached_input_tokens),
    output_tokens: add(a.output_tokens, b.output_tokens),
    reasoning_output_tokens: add(a.reasoning_output_tokens, b.reasoning_output_tokens),
  };
}

export function newParsed(): CodexParsed {
  return { threadId: null, turnsStarted: 0, turnsCompleted: 0, usage: null, items: [], errors: [], failedMessage: null, unknownEventTypes: {}, malformedLines: 0 };
}

function readItem(x: unknown): CodexItem {
  const i = rec(x);
  const item: CodexItem = { id: str(i.id), type: str(i.type) ?? "unknown" };
  if (item.type === "command_execution") {
    const c = str(i.command);
    if (c !== null) item.command = c;
    item.exitCode = num(i.exit_code);
  } else if (item.type === "file_change" && Array.isArray(i.changes)) {
    item.changes = i.changes.map((c) => ({ path: str(rec(c).path) ?? "", kind: str(rec(c).kind) ?? "update" })).filter((c) => c.path);
  } else if (item.type === "error") {
    item.text = str(i.message) ?? undefined;
  }
  return item;
}

/** Aplica una línea JSONL al acumulador. Idempotente por item.id en item.completed. */
export function applyLine(p: CodexParsed, line: string): void {
  const t = line.trim();
  if (!t) return;
  let ev: Rec;
  try {
    ev = rec(JSON.parse(t));
  } catch {
    p.malformedLines++;
    return;
  }
  const type = str(ev.type) ?? "unknown";
  switch (type) {
    case "thread.started":
      p.threadId = str(ev.thread_id);
      break;
    case "turn.started":
      p.turnsStarted++;
      break;
    case "turn.completed":
      p.turnsCompleted++;
      p.usage = addUsage(p.usage, readUsage(ev.usage));
      break;
    case "turn.failed":
      p.failedMessage = str(rec(ev.error).message) ?? "turn.failed";
      p.errors.push(p.failedMessage);
      break;
    case "error":
      p.errors.push(str(ev.message) ?? "error");
      break;
    case "item.completed": {
      const it = readItem(ev.item);
      if (it.id === null || !p.items.some((x) => x.id === it.id)) p.items.push(it);
      break;
    }
    case "item.started":
    case "item.updated":
      break;
    default:
      p.unknownEventTypes[type] = (p.unknownEventTypes[type] ?? 0) + 1;
  }
}

export function parseJsonl(text: string): CodexParsed {
  const p = newParsed();
  for (const l of text.split("\n")) applyLine(p, l);
  return p;
}

/** Items que cuentan como herramienta (llamada observable). */
export const TOOL_ITEM_TYPES = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search", "collab_tool_call"]);
