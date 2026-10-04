import { spawn } from "node:child_process";

export interface RunLimitedOptions {
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  maxOutputBytes?: number;
  signal?: AbortSignal;
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
    const child = spawn("perl", ["-e", "alarm shift; exec @ARGV", String(alarmSec), cmd, ...args], {
      cwd: opts.cwd,
      env: cleanEnv(opts.env),
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
