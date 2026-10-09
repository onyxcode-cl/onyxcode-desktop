import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { supervise } from "../../core/proc.ts";
import { seededRng } from "../../core/ids.ts";
import { redactDeep, redactText } from "../../core/redact.ts";
import { applyCapabilities, fullCapabilities, killMatching } from "../base/util.ts";
import type {
  AgentRunner, AgentTask, Capabilities, CollectResult, ContractScenario, MetricName, NormalizedEvent, Outcome, Prepared,
  ProbeResult, RawRun, RunLimits, RunnerConfiguration, RunnerContext,
} from "../base/types.ts";
import { loadScript } from "./script.ts";
import type { FakeScript, FakeScriptInput } from "./script.ts";

const AGENT = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));

export interface FakeRunnerOptions {
  script: FakeScriptInput | string;
  /** recorta capacidades declaradas (p. ej. { tokensCached: false }) */
  capabilities?: Partial<Capabilities>;
}

/** Aplica semilla: jitter determinista sobre tokens y retardos. Mismo guion+semilla => mismo resultado. */
export function resolveScript(s: FakeScript): FakeScript {
  const rng = seededRng(s.seed);
  const j = (v: number): number => Math.max(0, Math.round(v * (1 + (rng() - 0.5) * 2 * s.jitter)));
  const events = s.events.map((e) => (e.delayMs ? { ...e, delayMs: j(e.delayMs) } : e));
  const usage = s.usage ? { ...s.usage, input: j(s.usage.input), output: j(s.usage.output), ...(s.usage.cached !== undefined ? { cached: j(s.usage.cached) } : {}) } : undefined;
  return { ...s, events, ...(usage ? { usage } : {}) };
}

export class FakeRunner implements AgentRunner {
  readonly id = "fake";
  private readonly script: FakeScript;
  private readonly caps: Capabilities;

  constructor(opts: FakeRunnerOptions) {
    this.script = loadScript(opts.script);
    this.caps = { ...fullCapabilities(), peakContext: false, ...opts.capabilities };
  }

  async probe(): Promise<ProbeResult> {
    return { available: true, version: "fake-1", capabilities: { ...this.caps } };
  }

  async prepare(ctx: RunnerContext, cfg: RunnerConfiguration): Promise<Prepared> {
    for (const d of [ctx.ws, ctx.home, ctx.tmp, ctx.out]) mkdirSync(d, { recursive: true });
    const resolved = resolveScript(this.script);
    const scriptPath = join(ctx.out, "script.resolved.json");
    writeFileSync(scriptPath, JSON.stringify(resolved, null, 2));
    return { ctx, cfg, state: { scriptPath, resolved } };
  }

  async run(p: Prepared, _task: AgentTask, limits: RunLimits, signal?: AbortSignal): Promise<RawRun> {
    const { ctx } = p;
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: ctx.home,
      TMPDIR: ctx.tmp,
      ...ctx.env,
    };
    const raw = await supervise({
      cmd: process.execPath,
      args: [AGENT, p.state.scriptPath as string, ctx.runRoot],
      cwd: ctx.ws,
      env,
      timeoutMs: limits.timeoutMs,
      ...(limits.inactivityMs !== undefined ? { inactivityMs: limits.inactivityMs } : {}),
      ...(limits.graceMs !== undefined ? { graceMs: limits.graceMs } : {}),
      ...(signal ? { signal } : {}),
    });
    writeFileSync(join(ctx.out, "agent.stdout.log"), redactText(raw.stdout, ctx.secrets));
    writeFileSync(join(ctx.out, "agent.stderr.log"), redactText(raw.stderr, ctx.secrets));
    return raw;
  }

  async collect(p: Prepared, raw: RawRun): Promise<CollectResult> {
    const { ctx } = p;
    const evs: Record<string, unknown>[] = [];
    for (const line of raw.stdout.split("\n")) {
      if (!line.startsWith("{")) continue;
      try {
        evs.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* línea corrupta: se ignora */
      }
    }
    const events: NormalizedEvent[] = [];
    const m: Partial<Record<MetricName, number | null>> = {};
    let llm = 0, tools = 0, read = 0, rateLimited = false;
    for (const e of evs) {
      const type = String(e.type);
      if (type === "message") { llm++; events.push({ seq: events.length, type, name: (e.name as string | null) ?? null }); }
      else if (type === "tool_call") { tools++; if (e.read) read++; events.push({ seq: events.length, type, name: (e.name as string | null) ?? null }); }
      else if (type === "patch") { m.filesModified = (e.files as unknown[]).length; events.push({ seq: events.length, type, name: null }); }
      else if (type === "usage") {
        m.tokensInput = e.input as number;
        m.tokensOutput = e.output as number;
        m.tokensTotal = (e.input as number) + (e.output as number);
        if (typeof e.cached === "number") m.tokensCached = e.cached;
        if (typeof e.peakContext === "number") m.peakContext = e.peakContext;
      } else if (type === "error" && e.code === "rate_limit") { rateLimited = true; events.push({ seq: events.length, type: "error", name: "rate_limit" }); }
    }
    if (evs.length) { m.llmCalls = llm; m.toolCalls = tools; m.filesRead = read; }

    let outcome: Outcome;
    if (raw.outcome === "spawn_error") outcome = "infra_error";
    else if (raw.outcome === "timeout" || raw.outcome === "hung" || raw.outcome === "cancelled") outcome = raw.outcome;
    else if (rateLimited) outcome = "rate_limited";
    else outcome = raw.exitCode === 0 ? "completed" : "agent_error";

    const telemetry = redactDeep(
      {
        schemaVersion: "1" as const,
        runner: this.id,
        model: (p.state.resolved as FakeScript).model,
        metrics: applyCapabilities(this.caps, m),
        events,
        runnerSpecific: { fakeSeed: (p.state.resolved as FakeScript).seed },
      },
      ctx.secrets,
    );
    const path = join(ctx.out, "telemetry.json");
    writeFileSync(path, JSON.stringify(telemetry, null, 2));
    return { outcome, telemetry, artifacts: [path, join(ctx.out, "agent.stdout.log"), join(ctx.out, "agent.stderr.log"), p.state.scriptPath as string] };
  }

  /** Mata cualquier proceso que cite el runRoot (hijos huérfanos) y cuenta los supervivientes. */
  async cleanup(p: Prepared): Promise<{ orphans: number; reaped: number }> {
    const r = await killMatching(p.ctx.runRoot);
    return { orphans: r.orphans, reaped: r.reaped };
  }
}

/** Fábrica para la suite de contrato: traduce el escenario a un guion. */
export function makeFakeForContract(s: ContractScenario, extra: Partial<FakeRunnerOptions> = {}): FakeRunner {
  const base: FakeScriptInput = {
    seed: 7,
    jitter: 0.2,
    events: [
      { type: "message", name: "plan", text: "voy a leer", delayMs: 50 },
      { type: "tool_call", name: "read", read: "README.md", delayMs: 50 },
      { type: "tool_call", name: "write", delayMs: 50 },
      { type: "message", name: "fin", delayMs: 50 },
    ],
    usage: { input: 1000, output: 200, cached: 300, peakContext: 1500 },
    patch: { write: { "src/fix.txt": "arreglado\n" }, delete: [] },
    children: 1,
  };
  let script: FakeScriptInput = base;
  switch (s.behavior) {
    case "ok": break;
    case "rate_limit": script = { ...base, failure: { kind: "rate_limit", atEvent: 2 } }; break;
    case "crash": script = { ...base, failure: { kind: "crash", atEvent: 1 } }; break;
    case "hang": script = { ...base, failure: { kind: "hang", atEvent: 2 } }; break;
    case "orphan": script = { ...base, failure: { kind: "orphan" } }; break;
    case "slow": script = { ...base, children: 2, events: Array.from({ length: 30 }, () => ({ type: "tool_call" as const, name: "sleepy", delayMs: 2000 })) }; break;
    case "leak_secret": script = { ...base, leakSecretEnv: "AB_FAKE_SECRET" }; break;
  }
  return new FakeRunner({ script, ...extra });
}
