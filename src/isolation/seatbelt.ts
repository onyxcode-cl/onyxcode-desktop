import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import type { NetworkMode, SandboxedResult, SandboxOptions } from "./types.ts";

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

/** Rutas sensibles del HOME real con lectura denegada (además del propio HOME). */
export const SENSITIVE_HOME_SUBDIRS = [".ssh", ".config", "Library/Application Support", ".aws", ".gnupg"] as const;

export function defaultDenyReadPaths(home: string = homedir()): string[] {
  return [...SENSITIVE_HOME_SUBDIRS.map((d) => `${home}/${d}`), home];
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
    // denegación explícita (cinturón y tirantes sobre deny default); luego se re-permite lo mínimo necesario.
    `(deny file-read* ${(opts.denyReadPaths ?? defaultDenyReadPaths()).flatMap((p) => [...new Set([p, real(p)])]).map((p) => `(subpath ${q(p)})`).join(" ")})`,
    `(allow file-read* ${[...reads, root].map((p) => `(subpath ${q(p)})`).join(" ")})`,
    `(allow file-write* (subpath ${q(root)}) (literal "/dev/null") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))`,
  ];
  const net: NetworkMode = opts.network ?? (opts.allowNetwork === false ? "none" : "all");
  if (net === "all") lines.push("(allow network*)");
  else if (net === "loopback") {
    lines.push(
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
    );
  }
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

/**
 * Rutas de solo lectura que necesita un comando: su binario real (symlinks resueltos; dir contenedor) y
 * los argumentos que sean rutas absolutas de archivos existentes (p. ej. el script de un binario simulado).
 * `cmd` se resuelve contra `pathEnv` si no es absoluto.
 */
export function readPathsFor(cmd: string, args: string[] = [], pathEnv: string = process.env.PATH ?? ""): string[] {
  const out = new Set<string>();
  let bin: string | null = null;
  if (isAbsolute(cmd)) bin = cmd;
  else for (const d of pathEnv.split(":")) if (d && existsSync(`${d}/${cmd}`)) { bin = `${d}/${cmd}`; break; }
  if (bin && existsSync(bin)) { out.add(dirname(bin)); out.add(dirname(real(bin))); }
  for (const a of args) {
    if (!isAbsolute(a) || !existsSync(a)) continue;
    try { out.add(statSync(a).isDirectory() ? real(a) : dirname(real(a))); } catch { /* ignorar */ }
  }
  return [...out];
}

/**
 * Envuelve un comando con sandbox-exec -p <perfil>. Devuelve {cmd,args} para pasar a supervise().
 * sandbox-exec hace exec del destino: el pid supervisado es el del agente.
 */
export function sandboxWrap(
  spec: { cmd: string; args: string[] },
  opts: SandboxOptions & { pathEnv?: string },
): { cmd: string; args: string[] } {
  assertSandbox();
  const extra = [...new Set([...(opts.extraReadPaths ?? []), ...readPathsFor(spec.cmd, spec.args, opts.pathEnv)])];
  const profile = generateProfile({ ...opts, extraReadPaths: extra });
  return { cmd: SANDBOX_EXEC, args: ["-p", profile, spec.cmd, ...spec.args] };
}
