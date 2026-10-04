import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { writeFileNoFollow } from "../../core/safefs.ts";
import { join } from "node:path";
import type { AgentRunner, Collected, Configuration, Limits, PreparedRun, RawRunOutput, RunContext, RunnerProbe, Task } from "../../core/schemas.ts";
import { sandboxAvailable, sandboxWrap } from "../../isolation/index.ts";
import type { NetworkMode } from "../../isolation/index.ts";
import { killTree, supervise, verifyNoOrphans } from "../../core/proc.ts";
import { redactDeep, redactText } from "../../core/redact.ts";
import { InactivityWatch, isRateLimitText } from "../../telemetry/detect.ts";
import { sweepRunRoot } from "../../telemetry/orphans.ts";
import { emptyTelemetry } from "../../core/schemas.ts";
import { basicAuth, ocFetch, ocJson, parseSse } from "./client.ts";
import type { OcHttp } from "./client.ts";
import { buildConfigContent, buildEnv, writeConfigFiles } from "./config.ts";
import { extractOpenCode } from "./extract.ts";
import { findDbPath, readRunDb } from "./sqlite.ts";
import { OPENCODE_CAPABILITIES } from "./types.ts";
import type { OcDiffEntry, OcMessage, OcRaw, OcRetry, OcVerdict, OpenCodeSettings } from "./types.ts";

const UNVERIFIED_BASE = [
  "SSE: tipos session.status/session.idle/session.error/message.part.updated",
  "step-finish: forma de tokens y cost",
  "retry: session.status {type:'retry', attempt, message}",
  "sqlite: tablas session/message/part y columnas data",
  "OPENCODE_CONFIG_CONTENT: permission y agent.<n>.steps",
];

export interface OpenCodeRunnerOptions {
  bin?: { cmd: string; args?: string[] };
  startupTimeoutMs?: number;
  /** Lanzar dentro del perfil Seatbelt (def true). Solo desactivar en tests del propio runner. */
  sandbox?: boolean;
  /** Rutas extra de solo lectura (además del binario real, sus args y node). */
  extraReadPaths?: string[];
}

interface State {
  user: string;
  pass: string;
  bin: { cmd: string; args: string[] };
  settings: OpenCodeSettings;
  env: Record<string, string>;
  secrets: string[];
  xdgData: string;
  pids: number[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class OpenCodeRunner implements AgentRunner {
  readonly id = "opencode";
  /** única credencial que el motor reenvía a este runner (A2) */
  readonly credentialEnv = ["OPENCODE_AUTH_CONTENT"] as const;
  private readonly opts: OpenCodeRunnerOptions;
  constructor(opts: OpenCodeRunnerOptions = {}) {
    this.opts = opts;
  }

  /** Aislamiento que aplica este runner (lo registra el motor en environment.isolation). */
  get isolation(): "seatbelt" | "none" {
    return this.opts.sandbox === false ? "none" : "seatbelt";
  }

  /**
   * Red: opencode necesita el modelo remoto => "all" por defecto (settings.network="loopback" para modelos
   * locales/simulados). Mejora pendiente: egress por proxy con allowlist de hosts del proveedor.
   */
  private networkFor(settings: OpenCodeSettings): NetworkMode {
    const n = (settings as { network?: NetworkMode }).network;
    return n === "loopback" || n === "none" ? n : "all";
  }

  private binFor(settings: OpenCodeSettings): { cmd: string; args: string[] } {
    const b = settings.bin ?? this.opts.bin ?? { cmd: "opencode" };
    return { cmd: b.cmd, args: b.args ?? [] };
  }

  async probe(): Promise<RunnerProbe> {
    const b = this.binFor({});
    const r = await supervise({ cmd: b.cmd, args: [...b.args, "--version"], timeoutMs: 15_000, env: { PATH: process.env.PATH ?? "" } });
    const version = r.exitCode === 0 ? r.stdout.trim().split(/\s+/).pop() ?? null : null;
    return { available: r.exitCode === 0, version, capabilities: OPENCODE_CAPABILITIES, ...(r.exitCode === 0 ? {} : { notes: r.error ?? r.stderr.slice(0, 200) }) };
  }

  async prepare(ctx: RunContext, cfg: Configuration): Promise<PreparedRun> {
    const settings = cfg.settings as OpenCodeSettings;
    const user = "ab-" + randomBytes(6).toString("hex");
    const pass = randomBytes(24).toString("hex");
    const configDir = join(ctx.runRoot, "occonfig");
    for (const d of [ctx.home, ctx.tmp, ctx.out, configDir]) mkdirSync(d, { recursive: true });
    const model = cfg.provider && cfg.model ? `${cfg.provider}/${cfg.model}` : cfg.model;
    if (settings.configFiles) writeConfigFiles(configDir, settings.configFiles);
    const authContent = ctx.env.OPENCODE_AUTH_CONTENT; // única vía de credenciales; nunca desde disco
    const env = buildEnv({
      base: ctx.env, home: ctx.home, tmp: ctx.tmp, configDir, configContent: buildConfigContent(settings, model),
      username: user, password: pass, authContent,
    });
    const state: State = {
      user, pass, bin: this.binFor(settings), settings, env,
      secrets: [pass, ...(authContent ? [authContent] : [])],
      xdgData: env.XDG_DATA_HOME as string, pids: [],
    };
    return { ctx, configuration: cfg, state: state as unknown as Record<string, unknown> };
  }

  async run(prepared: PreparedRun, task: Task, limits: Limits, signal: AbortSignal): Promise<RawRunOutput> {
    const st = prepared.state as unknown as State;
    const ctx = prepared.ctx;
    const cfg = prepared.configuration;
    const t0 = Date.now();
    const deadline = t0 + limits.timeoutSec * 1000;
    const inactivityMs = limits.inactivitySec * 1000;
    const maxSteps = limits.maxSteps;
    const rlAbortAt = st.settings.rateLimitRetriesBeforeAbort ?? 1;

    const raw: OcRaw = {
      verdict: "infra_error", stopReason: "no_url", sessionId: null, baseUrl: null, messages: [], diff: [], retries: [],
      sweptOrphans: [], stepFinishCount: 0, eventCount: 0, eventTypes: {}, errorMessage: null, serverOrphans: [], unverified: [...UNVERIFIED_BASE],
    };

    const stopServer = new AbortController();
    let urlResolve: (u: string | null) => void = () => {};
    const urlP = new Promise<string | null>((r) => (urlResolve = r));
    let stdoutBuf = "";
    let launch = { cmd: st.bin.cmd, args: [...st.bin.args, "serve", "--port", "0", "--hostname", "127.0.0.1"] };
    if (this.isolation === "seatbelt") {
      if (!sandboxAvailable()) throw new Error("sandbox-exec no disponible: no se ejecuta opencode sin aislamiento");
      launch = sandboxWrap(launch, {
        runRoot: ctx.runRoot, extraReadPaths: this.opts.extraReadPaths, network: this.networkFor(st.settings), pathEnv: st.env.PATH,
      });
    }
    const serverP = supervise({
      cmd: launch.cmd, args: launch.args, cwd: ctx.workspace, env: st.env,
      timeoutMs: limits.timeoutSec * 1000 + 60_000, signal: stopServer.signal,
      onStdout: (c) => {
        stdoutBuf += c;
        const m = /listening on (https?:\/\/[^\s]+)/i.exec(stdoutBuf);
        if (m) urlResolve((m[1] as string).replace(/\/$/, ""));
      },
    }).then((r) => {
      urlResolve(null);
      return r;
    });

    const startup = this.opts.startupTimeoutMs ?? 30_000;
    const baseUrl = await Promise.race([urlP, sleep(startup).then(() => null)]);
    let serverRes: Awaited<typeof serverP> | null = null;
    let errorText: string | null = null;

    if (baseUrl) {
      raw.baseUrl = baseUrl;
      const h: OcHttp = { baseUrl, authHeader: basicAuth(st.user, st.pass), directory: ctx.workspace };
      try {
        await this.drive(h, st, task, cfg, raw, { deadline, inactivityMs, maxSteps, rlAbortAt, signal });
      } catch (e) {
        raw.verdict = "infra_error";
        raw.errorMessage = (e as Error).message;
      }
    } else {
      raw.errorMessage = "opencode serve no anunció URL";
    }

    stopServer.abort();
    serverRes = await serverP;
    const sweep = await sweepRunRoot(ctx.runRoot);
    raw.serverOrphans = [...serverRes.orphans, ...sweep.survivors];
    raw.sweptOrphans = sweep.swept;
    errorText = raw.errorMessage;
    if (!baseUrl && serverRes.outcome !== "cancelled") errorText = (raw.errorMessage ?? "") + ` (exit=${serverRes.exitCode}) ${serverRes.stderr.slice(-300)}`;
    if (serverRes.pid) { st.pids.push(serverRes.pid); raw.pid = serverRes.pid; }

    const redactedErr = errorText ? redactText(errorText, st.secrets) : null;
    const logRel = "opencode-server.log";
    writeFileNoFollow(join(ctx.out, logRel), redactText((serverRes.stdout + "\n--- stderr ---\n" + serverRes.stderr).slice(-200_000), st.secrets));
    const rawRel = "opencode-raw.json";
    const persist: Record<string, unknown> = { ...raw, baseUrl: "(local)" };
    writeFileNoFollow(join(ctx.out, rawRel), JSON.stringify(redactDeep(persist, st.secrets), null, 1));

    return {
      outcome: raw.verdict,
      exitCode: serverRes.exitCode,
      durationMs: Date.now() - t0,
      artifacts: [logRel, rawRel],
      error: redactedErr,
      raw: raw as unknown as Record<string, unknown>,
    };
  }

  /** Secuencia: SSE antes de enviar, POST /session, prompt_async, esperar idle, leer mensajes/diff. */
  private async drive(
    h: OcHttp, st: State, task: Task, cfg: Configuration, raw: OcRaw,
    lim: { deadline: number; inactivityMs: number; maxSteps: number; rlAbortAt: number; signal: AbortSignal },
  ): Promise<void> {
    const sseAc = new AbortController();
    const sseRes = await ocFetch(h, "GET", "/event", undefined, sseAc.signal, 15_000);
    if (!sseRes.ok) throw new Error(`GET /event -> HTTP ${sseRes.status}`);
    const watch = new InactivityWatch(lim.inactivityMs);

    let sessionId: string | null = null;
    let promptSent = false;
    let sawActivity = false;
    let verdict: OcVerdict | null = null;
    let reason: OcRaw["stopReason"] | null = null;
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const conclude = (v: OcVerdict, r: OcRaw["stopReason"], msg?: string): void => {
      if (verdict) return;
      verdict = v;
      reason = r;
      if (msg) raw.errorMessage = msg;
      finish();
    };

    const onEvent = (ev: unknown): void => {
      const e = (ev && typeof ev === "object" ? ev : {}) as { type?: string; properties?: Record<string, unknown> };
      const type = String(e.type ?? "unknown");
      const p = (e.properties ?? {}) as Record<string, any>;
      watch.touch();
      raw.eventCount++;
      raw.eventTypes[type] = (raw.eventTypes[type] ?? 0) + 1;
      const sid = (p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID) as string | undefined;
      // M10: el banco anota los tokens por step-finish desde el SSE (no los toca el agente, a diferencia de la sqlite del run)
      if (type === "message.part.updated" && p.part?.type === "step-finish" && typeof p.part.id === "string" && p.part.tokens) {
        (raw.observedSteps ??= {})[p.part.id] = { tokens: p.part.tokens };
      }
      // eventos de otras sesiones (subagentes) solo cuentan como actividad
      if (!sessionId || !promptSent || (sid && sid !== sessionId)) return;
      if (type === "session.status") {
        const s = p.status ?? {};
        if (s.type === "retry") {
          const rt: OcRetry = { attempt: typeof s.attempt === "number" ? s.attempt : null, message: typeof s.message === "string" ? s.message : null, at: Date.now() };
          raw.retries.push(rt);
          sawActivity = true;
          if (isRateLimitText(rt.message) && raw.retries.filter((x) => isRateLimitText(x.message)).length >= lim.rlAbortAt) {
            conclude("rate_limited", "rate_limit", rt.message ?? "rate limit");
          }
        } else if (s.type === "busy") sawActivity = true;
        else if (s.type === "idle" && sawActivity) conclude("completed", "idle");
      } else if (type === "session.idle") {
        if (sawActivity) conclude("completed", "idle");
      } else if (type === "session.error") {
        const msg = String(p.error?.data?.message ?? p.error?.message ?? p.error?.name ?? "session.error");
        if (p.error?.name === "MessageAbortedError") conclude("cancelled", "cancelled", msg);
        else conclude(isRateLimitText(msg) ? "rate_limited" : "agent_error", isRateLimitText(msg) ? "rate_limit" : "session_error", msg);
      } else if (type === "message.part.updated" || type === "message.updated") {
        sawActivity = true;
        if (type === "message.part.updated" && p.part?.type === "step-finish") {
          raw.stepFinishCount++;
          if (raw.stepFinishCount >= lim.maxSteps) conclude("completed", "max_steps");
        }
        const err = p.info?.error;
        if (type === "message.updated" && err) {
          const msg = String(err.data?.message ?? err.name ?? "error");
          if (isRateLimitText(msg)) conclude("rate_limited", "rate_limit", msg);
        }
      }
    };

    const consume = (async () => {
      try {
        for await (const ev of parseSse(sseRes)) onEvent(ev);
      } catch {
        /* abortado o cortado */
      }
      conclude("infra_error", "server_exit", "SSE terminó antes de idle");
    })();

    const wd = setInterval(() => {
      if (lim.signal.aborted) conclude("cancelled", "cancelled");
      else if (Date.now() > lim.deadline) conclude("timeout", "timeout");
      else if (watch.expired()) conclude("hung", "inactivity", `sin eventos durante ${Math.round(watch.idleMs() / 1000)} s`);
    }, 100);

    try {
      const s = await ocJson<{ id: string }>(h, "POST", "/session", { title: `bench ${task.scenarioId}` }, lim.signal);
      sessionId = s.id;
      raw.sessionId = sessionId;
      const body: Record<string, unknown> = { parts: [{ type: "text", text: task.prompt }] };
      if (cfg.provider && cfg.model) body.model = { providerID: cfg.provider, modelID: cfg.model };
      if (st.settings.agent) body.agent = st.settings.agent;
      promptSent = true;
      watch.touch();
      const r = await ocFetch(h, "POST", `/session/${sessionId}/prompt_async`, body, lim.signal);
      if (!r.ok) conclude("infra_error", "server_exit", `prompt_async -> HTTP ${r.status}`);
      await finished;
    } catch (e) {
      if (lim.signal.aborted) conclude("cancelled", "cancelled");
      else conclude("infra_error", "server_exit", (e as Error).message);
    } finally {
      clearInterval(wd);
    }

    const v = verdict as OcVerdict | null;
    // abortar la sesión salvo que haya terminado sola
    if (sessionId && (v !== "completed" || reason === "max_steps")) {
      try {
        await ocFetch(h, "POST", `/session/${sessionId}/abort`, undefined, undefined, 5_000);
      } catch {
        /* best effort */
      }
    }
    raw.verdict = v ?? "infra_error";
    raw.stopReason = reason ?? "server_exit";
    if (sessionId && v !== "hung" && v !== "infra_error") {
      try {
        raw.messages = await ocJson<OcMessage[]>(h, "GET", `/session/${sessionId}/message`);
      } catch (e) {
        raw.unverified.push(`GET /session/:id/message falló: ${(e as Error).message}`);
      }
      try {
        const d = await ocJson<OcDiffEntry[]>(h, "GET", `/session/${sessionId}/diff`);
        raw.diff = Array.isArray(d) ? d : [];
      } catch (e) {
        raw.unverified.push(`GET /session/:id/diff falló: ${(e as Error).message}`);
      }
    }
    sseAc.abort();
    await consume;
  }

  async collect(prepared: PreparedRun, rawOut: RawRunOutput): Promise<Collected> {
    const st = prepared.state as unknown as State;
    const raw = rawOut.raw as unknown as OcRaw;
    let outcome = rawOut.outcome;
    if (!raw.sessionId) return { telemetry: emptyTelemetry(), outcome };
    let main = raw.messages;
    let children: Record<string, OcMessage[]> = {};
    let source: "sqlite" | "http" = "http";
    const unverified = [...raw.unverified];
    const dbPath = findDbPath(st.xdgData);
    if (dbPath) {
      try {
        const db = readRunDb(dbPath, raw.sessionId);
        unverified.push(...db.warnings);
        const m = db.messagesBySession[raw.sessionId];
        if (m && m.length) {
          main = m;
          source = "sqlite";
          for (const [sid, msgs] of Object.entries(db.messagesBySession)) if (sid !== raw.sessionId) children[sid] = msgs;
        }
      } catch (e) {
        unverified.push(`sqlite ilegible: ${(e as Error).message}`);
        children = {};
      }
    } else unverified.push("sqlite del run no encontrada; se usan solo mensajes HTTP (sin subagentes)");
    let telemetry = extractOpenCode({ main, children, diff: raw.diff, retries: raw.retries.length, source, unverified });
    // M10: contraste con lo observado por el banco; si la sqlite (escribible por el agente) no cuadra, mandan los eventos SSE
    const obs = Object.values(raw.observedSteps ?? {});
    if (source === "sqlite" && obs.length) {
      const o = extractOpenCode({ main: [{ info: { role: "assistant" }, parts: obs.map((x) => ({ type: "step-finish", tokens: x.tokens })) }], children: {}, diff: [], retries: 0, source: "http", unverified: [] });
      if (o.totalTokens !== null && telemetry.totalTokens !== o.totalTokens) {
        telemetry = {
          ...telemetry, inputTokens: o.inputTokens, outputTokens: o.outputTokens, cachedTokens: o.cachedTokens,
          reasoningTokens: o.reasoningTokens, totalTokens: o.totalTokens,
          extra: { ...telemetry.extra, telemetryIntegrity: { status: "sqlite_mismatch", sqliteTotal: telemetry.totalTokens, observedSseTotal: o.totalTokens, used: "sse" } },
        };
        unverified.push("la sqlite del run no coincide con los eventos SSE observados: se usan los tokens del SSE");
      }
    }
    if (outcome === "completed") {
      // un mensaje assistant con error final sin idle limpio cuenta como agent_error
      const last = [...main].reverse().find((m) => m.info.role === "assistant");
      const err = last?.info.error as { data?: { message?: string }; name?: string } | undefined;
      if (err && err.name !== "MessageAbortedError") outcome = isRateLimitText(err.data?.message) ? "rate_limited" : "agent_error";
    }
    return { telemetry, outcome };
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
