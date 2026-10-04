import { existsSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import type { SandboxedResult, SandboxOptions } from "./types.ts";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export function sandboxAvailable(): boolean {
  return process.platform === "darwin" && existsSync(SANDBOX_EXEC);
}

export function assertSandbox(): void {
  if (!sandboxAvailable()) throw new Error("sandbox-exec no disponible: no se ejecuta sin aislamiento");
}

const BASE_READ = [
  "/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/private/var/db",
  "/private/var/select", "/dev", "/opt/homebrew", "/Applications/Xcode.app", "/Library/Developer",
];

function q(p: string): string {
  if (/["\\\n]/.test(p)) throw new Error(`ruta no permitida en perfil: ${p}`);
  return `"${p}"`;
}

function real(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

/** Perfil Seatbelt: deny default, lectura en lista blanca, escritura solo en runRoot. */
export function generateProfile(opts: SandboxOptions): string {
  const root = real(opts.runRoot);
  const reads = [...BASE_READ, process.execPath.replace(/\/bin\/node$/, ""), ...(opts.extraReadPaths ?? [])]
    .map(real);
  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow file-read-metadata)",
    "(allow file-read* (literal \"/\"))",
    `(allow file-read* ${[...reads, root].map((p) => `(subpath ${q(p)})`).join(" ")})`,
    `(allow file-write* (subpath ${q(root)}) (literal "/dev/null") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))`,
  ];
  if (opts.allowNetwork !== false) lines.push("(allow network*)");
  return lines.join("\n") + "\n";
}

/** Ejecuta un comando dentro del perfil con límite de tiempo (SIGKILL al grupo). */
export function runSandboxed(
  opts: SandboxOptions & {
    cmd: string;
    args?: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutSec: number;
  },
): Promise<SandboxedResult> {
  assertSandbox();
  const profile = generateProfile(opts);
  return new Promise((resolve) => {
    const child = spawn(SANDBOX_EXEC, ["-p", profile, opts.cmd, ...(opts.args ?? [])], {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const t = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* ya terminó */ }
    }, opts.timeoutSec * 1000);
    child.on("close", (code, signal) => {
      clearTimeout(t);
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* sin restos */ }
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: null, signal: null, stdout, stderr: stderr + String(e), timedOut });
    });
  });
}
