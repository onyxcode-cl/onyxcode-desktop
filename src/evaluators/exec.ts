import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { sandboxAvailable, sandboxWrap } from "../isolation/seatbelt.ts";

/**
 * Ejecución dentro de Seatbelt (A5): el código del agente (src, tests, scripts de build) corre con
 * lectura restringida (sin HOME real, sin el repo del banco, sin ~/.ssh), escritura solo en `root`, red cerrada
 * y HOME/TMPDIR/PATH limpios y propios.
 */
export interface EvalSandbox {
  /** directorio donde corre el comando: legible y escribible (copia desechable) */
  root: string;
  /** rutas extra de solo lectura (p. ej. un binario de build fuera de PATH base) */
  readPaths?: string[];
}

export interface RunLimitedOptions {
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  /** si se da, el comando corre en Seatbelt con HOME/PATH limpios; si Seatbelt no existe, rechaza ejecutar */
  sandbox?: EvalSandbox;
}
export interface RunLimitedResult {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const ENV_WHITELIST = ["PATH", "LANG", "LC_ALL", "TMPDIR", "HOME", "USER", "SHELL"];

/** Entorno fijo del evaluador sandboxeado: nada del usuario, HOME y TMPDIR dentro de la copia. */
export function sandboxEnv(root: string, extra: Record<string, string> = {}): Record<string, string> {
  const home = join(root, ".abhome");
  const tmp = join(root, ".abtmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const keep: Record<string, string> = {};
  for (const k of ["LANG", "LC_ALL", "TZ"]) if (process.env[k] !== undefined) keep[k] = process.env[k]!;
  return {
    ...keep, CI: "1", NO_COLOR: "1", HOME: home, TMPDIR: tmp,
    PATH: [dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
    ...extra,
  };
}

export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ENV_WHITELIST) if (process.env[k] !== undefined) env[k] = process.env[k]!;
  return { ...env, CI: "1", NO_COLOR: "1", ...extra };
}

function killGroup(pid: number, sig: NodeJS.Signals): void {
  try { process.kill(-pid, sig); } catch { /* ya terminó */ }
}

/**
 * Ejecuta un comando con límite de tiempo: grupo de procesos propio, SIGTERM -> 2 s -> SIGKILL,
 * y respaldo `perl alarm` (macOS no tiene `timeout`) un poco por encima del límite.
 */
export function runLimited(cmd: string, args: string[], opts: RunLimitedOptions): Promise<RunLimitedResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const alarmSec = Math.ceil(opts.timeoutMs / 1000) + 5;
    let exe = cmd;
    let exeArgs = args;
    let env: Record<string, string>;
    if (opts.sandbox) {
      if (!sandboxAvailable()) {
        resolve({ code: null, signal: null, timedOut: false, aborted: false, stdout: "", stderr: "Seatbelt no disponible: no se ejecuta código del agente sin aislamiento", durationMs: 0 });
        return;
      }
      env = sandboxEnv(opts.sandbox.root, opts.env ?? {});
      const w = sandboxWrap({ cmd, args }, {
        runRoot: opts.sandbox.root, writePaths: [opts.sandbox.root], network: "none", pathEnv: env.PATH as string,
        ...(opts.sandbox.readPaths ? { extraReadPaths: opts.sandbox.readPaths } : {}),
      });
      exe = w.cmd;
      exeArgs = w.args;
    } else env = cleanEnv(opts.env);
    const child = spawn("perl", ["-e", "alarm shift; exec @ARGV", String(alarmSec), exe, ...exeArgs], {
      cwd: opts.cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const max = opts.maxOutputBytes ?? 4_000_000;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const add = (cur: string, chunk: Buffer) => (cur.length < max ? cur + chunk.toString("utf8") : cur);
    child.stdout!.on("data", (d: Buffer) => { stdout = add(stdout, d); });
    child.stderr!.on("data", (d: Buffer) => { stderr = add(stderr, d); });

    const stop = () => {
      if (child.pid === undefined) return;
      killGroup(child.pid, "SIGTERM");
      setTimeout(() => child.pid !== undefined && killGroup(child.pid, "SIGKILL"), 2000).unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, opts.timeoutMs);
    const onAbort = () => { aborted = true; stop(); };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const finish = (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      // Garantiza que no queden descendientes del grupo.
      if (child.pid !== undefined) killGroup(child.pid, "SIGKILL");
      resolve({ code, signal, timedOut, aborted, stdout, stderr, durationMs: Date.now() - started });
    };
    child.on("error", (e) => { stderr += String(e); finish(null, null); });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
