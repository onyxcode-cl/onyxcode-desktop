import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { AgentRunner, Collected, Configuration, Limits, PreparedRun, RawRunOutput, RunContext, RunnerProbe, Task } from "../../core/schemas.ts";
import { emptyTelemetry } from "../../core/schemas.ts";
import { sandboxAvailable, sandboxWrap } from "../../isolation/index.ts";
import type { NetworkMode } from "../../isolation/index.ts";
import { killTree, supervise, verifyNoOrphans } from "../../core/proc.ts";
import { redactDeep, redactText } from "../../core/redact.ts";
import { isRateLimitText } from "../../telemetry/detect.ts";
import { sweepRunRoot } from "../../telemetry/orphans.ts";
import { applyLine, newParsed, TOOL_ITEM_TYPES } from "./events.ts";
import { extractCodex } from "./extract.ts";
import { findRollouts, parseRollouts } from "./rollout.ts";
import { CODEX_CAPABILITIES } from "./types.ts";
import type { CodexRaw, CodexSettings, CodexVerdict } from "./types.ts";

const UNVERIFIED_BASE = [
  "flags: --ignore-user-config, -C, --skip-git-repo-check en la versión instalada",
  "eventos: item.type de subagentes (collab_tool_call) y mcp_tool_call",
  "rollout: ruta sessions/YYYY/MM/DD/rollout-*.jsonl y forma de token_count.info",
  "auth: CODEX_API_KEY como única vía (sin auth.json)",
];

interface State {
  settings: CodexSettings;
  bin: { cmd: string; args: string[] };
  env: Record<string, string>;
  codexHome: string;
  secrets: string[];
  pids: number[];
}

export interface CodexRunnerOptions {
  bin?: { cmd: string; args?: string[] };
  /** Lanzar dentro del perfil Seatbelt (def true). Solo desactivar en tests del propio runner. */
  sandbox?: boolean;
  /** Rutas extra de solo lectura (además del binario real, sus args y node). */
  extraReadPaths?: string[];
}

export class CodexRunner implements AgentRunner {
  readonly id = "codex";
  private readonly opts: CodexRunnerOptions;
  constructor(opts: CodexRunnerOptions = {}) {
    this.opts = opts;
  }

  /** Aislamiento que aplica este runner (lo registra el motor en environment.isolation). */
  get isolation(): "seatbelt" | "none" {
    return this.opts.sandbox === false ? "none" : "seatbelt";
  }

  /** Red: codex siempre necesita el modelo remoto => "all" salvo settings.network (simulados). Egress con allowlist: mejora pendiente. */
  private networkFor(s: CodexSettings): NetworkMode {
    const n = (s as { network?: NetworkMode }).network;
    return n === "loopback" || n === "none" ? n : "all";
  }

  private binFor(s: CodexSettings): { cmd: string; args: string[] } {
    const b = s.bin ?? this.opts.bin ?? { cmd: "codex" };
    return { cmd: b.cmd, args: b.args ?? [] };
  }

  async probe(): Promise<RunnerProbe> {
    const b = this.binFor({});
    const r = await supervise({ cmd: b.cmd, args: [...b.args, "--version"], timeoutMs: 15_000, env: { PATH: process.env.PATH ?? "" } });
    const ok = r.exitCode === 0;
    return { available: ok, version: ok ? r.stdout.trim().split(/\s+/).pop() ?? null : null, capabilities: CODEX_CAPABILITIES, ...(ok ? {} : { notes: r.error ?? "codex no disponible" }) };
  }

  async prepare(ctx: RunContext, cfg: Configuration): Promise<PreparedRun> {
    const settings = cfg.settings as CodexSettings;
    const codexHome = join(ctx.runRoot, "codex-home");
    for (const d of [ctx.home, ctx.tmp, ctx.out, codexHome]) mkdirSync(d, { recursive: true });
    if (settings.homeFiles) {
      const root = resolve(codexHome);
      for (const [rel, content] of Object.entries(settings.homeFiles)) {
        const p = resolve(join(root, rel));
        if (!p.startsWith(root + sep)) throw new Error(`homeFiles: ruta fuera de CODEX_HOME: ${rel}`);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, content, { mode: 0o600 });
      }
    }
    const env: Record<string, string> = {};
    for (const k of ["PATH", "LANG", "LC_ALL", "TERM"]) {
      const v = ctx.env[k] ?? process.env[k];
      if (v) env[k] = v;
    }
    env.HOME = ctx.home;
    env.TMPDIR = ctx.tmp;
    env.CODEX_HOME = codexHome;
    env.XDG_CONFIG_HOME = join(ctx.home, ".config");
    env.XDG_DATA_HOME = join(ctx.home, ".local", "share");
    env.XDG_CACHE_HOME = join(ctx.home, ".cache");
    const key = ctx.env.CODEX_API_KEY;
    if (key) env.CODEX_API_KEY = key;
    const state: State = { settings, bin: this.binFor(settings), env, codexHome, secrets: key ? [key] : [], pids: [] };
    return { ctx, configuration: cfg, state: state as unknown as Record<string, unknown> };
  }

  buildArgs(prepared: PreparedRun): string[] {
    const st = prepared.state as unknown as State;
    const cfg = prepared.configuration;
    const a = ["exec", "--json", "-s", st.settings.sandbox ?? "workspace-write", "-C", prepared.ctx.workspace, "--skip-git-repo-check", "--ignore-user-config"];
    if (cfg.model) a.push("-m", cfg.model);
    if (st.settings.reasoningEffort) a.push("-c", `model_reasoning_effort="${st.settings.reasoningEffort}"`);
    a.push("-"); // prompt por stdin
    return a;
  }

  async run(prepared: PreparedRun, task: Task, limits: Limits, signal: AbortSignal): Promise<RawRunOutput> {
    const st = prepared.state as unknown as State;
    const ctx = prepared.ctx;
    const t0 = Date.now();
    const parsed = newParsed();
    const own = new AbortController();
    const onAbort = (): void => own.abort();
    if (signal.aborted) own.abort();
    else signal.addEventListener("abort", onAbort, { once: true });

    let flagged: "rate_limit" | "max_steps" | null = null;
    let lineBuf = "";
    let toolsSeen = 0;
    const feed = (chunk: string): void => {
      lineBuf += chunk;
      let i: number;
      while ((i = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, i);
        lineBuf = lineBuf.slice(i + 1);
        const before = parsed.errors.length;
        const itemsBefore = parsed.items.length;
        applyLine(parsed, line);
        if (!flagged && parsed.errors.length > before && isRateLimitText(parsed.errors[parsed.errors.length - 1])) {
          flagged = "rate_limit";
          own.abort();
        }
        if (parsed.items.length > itemsBefore && TOOL_ITEM_TYPES.has((parsed.items[parsed.items.length - 1] as { type: string }).type)) {
          toolsSeen++;
          if (!flagged && toolsSeen >= limits.maxSteps) {
            flagged = "max_steps";
            own.abort();
          }
        }
      }
    };

    let launch = { cmd: st.bin.cmd, args: [...st.bin.args, ...this.buildArgs(prepared)] };
    if (this.isolation === "seatbelt") {
      if (!sandboxAvailable()) throw new Error("sandbox-exec no disponible: no se ejecuta codex sin aislamiento");
      launch = sandboxWrap(launch, {
        runRoot: ctx.runRoot, extraReadPaths: this.opts.extraReadPaths, network: this.networkFor(st.settings), pathEnv: st.env.PATH,
      });
    }
    const res = await supervise({
      cmd: launch.cmd, args: launch.args, cwd: ctx.workspace, env: st.env, stdin: task.prompt,
      timeoutMs: limits.timeoutSec * 1000, inactivityMs: limits.inactivitySec * 1000, signal: own.signal, onStdout: feed,
      onStderr: (c) => {
        // codex vuelca "stream error"/rate limit en stderr
        if (!flagged && isRateLimitText(c)) {
          flagged = "rate_limit";
          own.abort();
        }
      },
    });
    signal.removeEventListener("abort", onAbort);
    if (lineBuf) feed("\n");
    if (res.pid) st.pids.push(res.pid);
    const sweep = await sweepRunRoot(ctx.runRoot);

    let verdict: CodexVerdict;
    let reason: CodexRaw["stopReason"];
    const rl = flagged === "rate_limit" || isRateLimitText(parsed.failedMessage);
    if (res.outcome === "spawn_error") [verdict, reason] = ["infra_error", "spawn_error"];
    else if (flagged === "rate_limit") [verdict, reason] = ["rate_limited", "rate_limit"];
    else if (flagged === "max_steps") [verdict, reason] = ["completed", "max_steps"];
    else if (res.outcome === "hung") [verdict, reason] = ["hung", "inactivity"];
    else if (res.outcome === "timeout") [verdict, reason] = ["timeout", "timeout"];
    else if (res.outcome === "cancelled") [verdict, reason] = ["cancelled", "cancelled"];
    else if (rl) [verdict, reason] = ["rate_limited", "rate_limit"];
    else if (parsed.failedMessage) [verdict, reason] = ["agent_error", "turn_failed"];
    else if (res.exitCode === 0) [verdict, reason] = ["completed", "exit_0"];
    else [verdict, reason] = ["agent_error", "exit_nonzero"];

    const rollout = parseRollouts(findRollouts(st.codexHome));
    const raw: CodexRaw = {
      verdict, stopReason: reason, parsed, rollout, stderrTail: redactText(res.stderr.slice(-4000), st.secrets),
      exitCode: res.exitCode, orphans: [...res.orphans, ...sweep.survivors], swept: sweep.swept, unverified: [...UNVERIFIED_BASE, ...(rollout ? [] : ["rollout no encontrado: llmCalls/peakContext = null"])],
    };
    const rel = "codex-events.jsonl";
    writeFileSync(join(ctx.out, rel), redactText(res.stdout, st.secrets));
    const rawRel = "codex-raw.json";
    writeFileSync(join(ctx.out, rawRel), JSON.stringify(redactDeep(raw, st.secrets), null, 1));
    return {
      outcome: verdict, exitCode: res.exitCode, durationMs: Date.now() - t0, artifacts: [rel, rawRel],
      error: verdict === "completed" ? null : redactText(parsed.failedMessage ?? parsed.errors.at(-1) ?? res.error ?? reason, st.secrets),
      raw: raw as unknown as Record<string, unknown>,
    };
  }

  async collect(_prepared: PreparedRun, rawOut: RawRunOutput): Promise<Collected> {
    const raw = rawOut.raw as unknown as CodexRaw;
    if (!raw?.parsed) return { telemetry: emptyTelemetry(), outcome: rawOut.outcome };
    return { telemetry: extractCodex(raw.parsed, raw.rollout, raw.unverified), outcome: rawOut.outcome };
  }

  async cleanup(prepared: PreparedRun): Promise<{ orphans: number }> {
    const st = prepared.state as unknown as State;
    let left = verifyNoOrphans(st.pids);
    if (left.length) {
      for (const pid of left) await killTree(pid, { graceMs: 1000 });
      left = verifyNoOrphans(st.pids);
    }
    const sweep = await sweepRunRoot(prepared.ctx.runRoot);
    return { orphans: left.length + sweep.survivors.length };
  }
}
