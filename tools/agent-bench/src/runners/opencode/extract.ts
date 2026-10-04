import type { Telemetry } from "../../core/schemas.ts";
import { nmax, normalizeTelemetry, nsum, uniq } from "../../telemetry/normalize.ts";
import { OPENCODE_CAPABILITIES } from "./types.ts";
import type { OcDiffEntry, OcMessage } from "./types.ts";

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (x && typeof x === "object" && !Array.isArray(x) ? (x as Rec) : {});
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

export interface TokenSet {
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

/** tokens de OpenCode: {input, output, reasoning, cache:{read,write}} (NV: forma exacta; ver docs/RUNNERS.md). */
export function readTokens(x: unknown): TokenSet | null {
  const t = rec(x);
  if (Object.keys(t).length === 0) return null;
  const c = rec(t.cache);
  return { input: num(t.input), output: num(t.output), reasoning: num(t.reasoning), cacheRead: num(c.read), cacheWrite: num(c.write) };
}

const promptSize = (t: TokenSet): number | null => nsum(t.input, t.cacheRead, t.cacheWrite);

const READ_TOOLS = new Set(["read", "glob", "grep", "list"]);
const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "patch", "apply_patch"]);
const CMD_TOOLS = new Set(["bash", "shell"]);
const SUBAGENT_TOOLS = new Set(["task"]);

export interface ExtractInput {
  /** mensajes de la sesión raíz */
  main: OcMessage[];
  /** mensajes de sesiones hijas (subagentes), por id de sesión */
  children: Record<string, OcMessage[]>;
  diff: OcDiffEntry[];
  retries: number;
  /** de dónde salen los datos (aviso de campos NV) */
  source: "sqlite" | "http";
  unverified: string[];
}

interface Stats {
  tokens: TokenSet[]; // por mensaje assistant
  stepTokens: TokenSet[]; // por step-finish
  cost: Array<number | null>;
  assistantCount: number;
  toolCalls: number;
  toolDurMs: Array<number | null>;
  commands: string[];
  read: string[];
  modified: string[];
  stepFinish: number;
  taskCalls: number;
}

function scan(msgs: OcMessage[]): Stats {
  const s: Stats = { tokens: [], stepTokens: [], cost: [], assistantCount: 0, toolCalls: 0, toolDurMs: [], commands: [], read: [], modified: [], stepFinish: 0, taskCalls: 0 };
  for (const m of msgs) {
    const info = rec(m.info);
    if (info.role === "assistant") {
      s.assistantCount++;
      const t = readTokens(info.tokens);
      if (t) s.tokens.push(t);
      s.cost.push(num(info.cost));
    }
    for (const p of m.parts) {
      const type = str(p.type);
      if (type === "step-finish") {
        s.stepFinish++;
        const t = readTokens(p.tokens);
        if (t) s.stepTokens.push(t);
      } else if (type === "tool") {
        s.toolCalls++;
        const tool = (str(p.tool) ?? "").toLowerCase();
        const state = rec(p.state);
        const input = rec(state.input);
        const time = rec(state.time);
        const a = num(time.start);
        const b = num(time.end);
        s.toolDurMs.push(a !== null && b !== null ? Math.max(0, b - a) : null);
        const file = str(input.filePath) ?? str(input.path) ?? str(input.file);
        if (CMD_TOOLS.has(tool)) {
          const c = str(input.command);
          if (c) s.commands.push(c);
        } else if (READ_TOOLS.has(tool)) {
          if (file) s.read.push(file);
        } else if (WRITE_TOOLS.has(tool)) {
          if (file) s.modified.push(file);
        } else if (SUBAGENT_TOOLS.has(tool)) s.taskCalls++;
      }
    }
  }
  return s;
}

const sumTok = (ts: TokenSet[], f: (t: TokenSet) => number | null): number | null => nsum(...ts.map(f));

/**
 * Telemetría normalizada de un run de OpenCode. Tokens: input = prompt total
 * (input + cache.read + cache.write), output = output + reasoning, cached = cache.read.
 * Subagentes (sesiones hijas) se incluyen en los totales y se desglosan en extra.subagents.
 */
export function extractOpenCode(inp: ExtractInput): Telemetry {
  const sessions: Array<[string, Stats]> = [["main", scan(inp.main)], ...Object.entries(inp.children).map(([id, m]) => [id, scan(m)] as [string, Stats])];
  const all = sessions.map(([, s]) => s);
  // Fuente principal: tokens por mensaje assistant; si faltan, los de step-finish.
  const msgTokens = all.flatMap((s) => s.tokens);
  const stepTokens = all.flatMap((s) => s.stepTokens);
  const primary = msgTokens.length ? msgTokens : stepTokens;

  const input = nsum(...primary.map(promptSize));
  const output = nsum(...primary.map((t) => nsum(t.output, t.reasoning)));
  const cached = sumTok(primary, (t) => t.cacheRead);
  const cacheWrite = sumTok(primary, (t) => t.cacheWrite);
  const reasoning = sumTok(primary, (t) => t.reasoning);
  const total = input === null && output === null ? null : nsum(input, output);

  const stepFinish = all.reduce((a, s) => a + s.stepFinish, 0);
  const assistants = all.reduce((a, s) => a + s.assistantCount, 0);
  const llmCalls = stepFinish > 0 ? stepFinish : assistants > 0 ? assistants : null;
  const peakSrc = stepTokens.length ? stepTokens : msgTokens;
  const peak = nmax(peakSrc.map(promptSize));

  const costVals = all.flatMap((s) => s.cost);
  const hasCost = costVals.some((c) => c !== null);
  const cost = hasCost ? nsum(...costVals) : null;

  const toolCalls = all.reduce((a, s) => a + s.toolCalls, 0);
  const commands = all.flatMap((s) => s.commands);
  const read = uniq(all.flatMap((s) => s.read));
  const diffFiles = inp.diff;
  const byStatus = (re: RegExp): string[] => diffFiles.filter((d) => re.test(d.status ?? "")).map((d) => d.file);
  const hasStatus = diffFiles.some((d) => d.status);
  const created = hasStatus ? uniq(byStatus(/^add/i)) : null;
  const deleted = hasStatus ? uniq(byStatus(/^(del|remov)/i)) : null;
  // /diff manda; si está vacío se cae a las herramientas de escritura observadas
  const modified = diffFiles.length
    ? uniq(diffFiles.filter((d) => !hasStatus || /^(mod|chang|upd)/i.test(d.status ?? "")).map((d) => d.file))
    : uniq(all.flatMap((s) => s.modified));

  // contraste tokens mensaje vs step-finish (aviso NV)
  const crossMsg = nsum(...msgTokens.map((t) => nsum(promptSize(t), t.output, t.reasoning)));
  const crossStep = nsum(...stepTokens.map((t) => nsum(promptSize(t), t.output, t.reasoning)));
  const mismatch = crossMsg !== null && crossStep !== null && crossMsg !== crossStep;

  return normalizeTelemetry(
    {
      inputTokens: input, outputTokens: output, cachedTokens: cached, reasoningTokens: reasoning, totalTokens: total,
      llmCalls, peakContext: peak, costUsd: cost, toolCalls: sessions.length ? toolCalls : null,
      commands: commands.length || toolCalls > 0 ? commands.length : null,
      steps: stepFinish > 0 ? stepFinish : null,
      filesRead: read, filesModified: modified, filesCreated: created, filesDeleted: deleted,
    },
    OPENCODE_CAPABILITIES,
    {
      runner: "opencode",
      cacheWriteTokens: cacheWrite,
      toolDurationMs: nsum(...all.flatMap((s) => s.toolDurMs)),
      retries: inp.retries,
      dataSource: inp.source,
      tokenSemantics: "input=input+cache.read+cache.write; output=output+reasoning; cached=cache.read",
      tokenCrosscheck: { messages: crossMsg, stepFinish: crossStep, mismatch },
      subagentSessions: Object.keys(inp.children).length,
      taskToolCalls: all.reduce((a, s) => a + s.taskCalls, 0),
      subagents: sessions.slice(1).map(([id, s]) => ({
        sessionId: id,
        toolCalls: s.toolCalls,
        tokens: nsum(...s.tokens.map((t) => nsum(promptSize(t), t.output, t.reasoning))),
      })),
      commandsList: commands.slice(0, 200),
      unverified: inp.unverified,
    },
  );
}
