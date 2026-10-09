import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  "/usr", "/bin", "/sbin", "/System", "/Library/Frameworks", "/Library/Preferences/Logging", "/private/var/db/timezone", "/private/etc",
  "/private/var/select", "/dev", "/opt/homebrew", "/Applications/Xcode.app", "/Library/Developer",
];

/** Raíz del repositorio del banco (contiene benchmarks/: hidden, reference.patch, cheat.patch). */
export const BENCH_ROOT: string = (() => {
  const p = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  try { return realpathSync(p); } catch { return p; }
})();

/**
 * Servicios Mach permitidos (lista cerrada). NO incluye LaunchServices (`open`), Apple Events (`osascript`),
 * launchd (`launchctl submit`), pasteboard ni windowserver: el agente no puede pedirle a otro proceso del
 * usuario que ejecute algo fuera del sandbox.
 */
export const MACH_SERVICES = [
  "com.apple.system.logger", "com.apple.logd", "com.apple.logd.events", "com.apple.diagnosticd",
  "com.apple.system.notification_center", "com.apple.system.opendirectoryd.libinfo",
  "com.apple.system.opendirectoryd.membership", "com.apple.cfprefsd.daemon", "com.apple.cfprefsd.agent",
  "com.apple.trustd", "com.apple.trustd.agent", "com.apple.SecurityServer", "com.apple.securityd",
  "com.apple.mDNSResponder", "com.apple.dnssd.service", "com.apple.networkd", "com.apple.SystemConfiguration.configd",
  "com.apple.SystemConfiguration.DNSConfiguration", "com.apple.SystemConfiguration.NetworkInformation",
  "com.apple.bsd.dirhelper", "com.apple.FSEvents", "com.apple.coreservices.quarantine-resolver",
  "com.apple.ocspd", "com.apple.nsurlsessiond", "com.apple.symptomsd", "com.apple.analyticsd",
  "com.apple.distributed_notifications@Uv3",
];

function q(p: string): string {
  if (/["\\\n]/.test(p)) throw new Error(`ruta no permitida en perfil: ${p}`);
  return `"${p}"`;
}

function isFile(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}

function real(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

/** Rutas sensibles del HOME real con lectura denegada (además del propio HOME). */
export const SENSITIVE_HOME_SUBDIRS = [".ssh", ".config", "Library/Application Support", ".aws", ".gnupg"] as const;

export function defaultDenyReadPaths(home: string = homedir()): string[] {
  return [...SENSITIVE_HOME_SUBDIRS.map((d) => `${home}/${d}`), home];
}

/** true si `p` es `parent` o está dentro. */
function within(parent: string, p: string): boolean {
  return p === parent || p.startsWith(parent.endsWith("/") ? parent : parent + "/");
}

/**
 * Perfil Seatbelt: deny default, lectura en lista blanca, escritura SOLO en ws, home y tmp del run
 * (out/, eval/, ctl/ y la config del runner quedan de solo lectura para el agente: así no puede plantar
 * symlinks ni archivos donde el banco escribe después). El repositorio del banco (benchmarks/: ocultos,
 * reference.patch, cheat.patch) se deniega DESPUÉS de todos los allow, también si lo pidió extraReadPaths.
 */
export function generateProfile(opts: SandboxOptions): string {
  const root = real(opts.runRoot);
  const bench = real(opts.benchRoot ?? BENCH_ROOT);
  const benchInsideRoot = within(root, bench);
  const reads = [...BASE_READ, process.execPath.replace(/\/bin\/node$/, ""), ...(opts.extraReadPaths ?? [])]
    .map(real)
    // un directorio de lectura que contenga al banco lo expondría entero: se descarta (los ficheros concretos
    // que haga falta leer, p. ej. el script de un binario simulado, van en allowReadFiles)
    .filter((p) => p === root || !(within(bench, p) || within(p, bench)));
  const writes = (opts.writePaths ?? [join(root, "ws"), join(root, "home"), join(root, "tmp")]).map(real);
  const sub = (ps: string[]): string => ps.map((p) => `(subpath ${q(p)})`).join(" ");
  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    `(allow mach-lookup ${MACH_SERVICES.map((s) => `(global-name ${q(s)})`).join(" ")})`,
    "(allow ipc-posix-shm)",
    "(allow file-read-metadata)",
    "(allow file-read* (literal \"/\"))",
    `(allow file-read* ${sub([...reads, root])})`,
    // denegación explícita (cinturón y tirantes sobre deny default); luego se re-permite lo mínimo necesario.
    `(deny file-read* ${sub((opts.denyReadPaths ?? defaultDenyReadPaths()).flatMap((p) => [...new Set([p, real(p)])]))})`,
    `(allow file-read* ${sub([...reads, root])})`,
    `(allow file-write* ${sub(writes)} (literal "/dev/null") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))`,
    // A7: el banco no es legible (contenido y listados); metadata sí, para que resuelvan las rutas.
    `(deny file-read-data ${sub([bench])})`,
  ];
  if (benchInsideRoot) lines.push(`(allow file-read-data ${sub([root])})`);
  const files = (opts.allowReadFiles ?? []).map(real).filter((p) => within(bench, p));
  if (files.length) lines.push(`(allow file-read-data ${files.map((p) => `(literal ${q(p)})`).join(" ")})`);
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
  opts: SandboxOptions & { pathEnv?: string | undefined },
): { cmd: string; args: string[] } {
  assertSandbox();
  const extra = [...new Set([...(opts.extraReadPaths ?? []), ...readPathsFor(spec.cmd, spec.args, opts.pathEnv)])];
  const files = [...(opts.allowReadFiles ?? []), ...[spec.cmd, ...spec.args].filter((a) => isAbsolute(a) && isFile(a))];
  const profile = generateProfile({ ...opts, extraReadPaths: extra, allowReadFiles: files });
  return { cmd: SANDBOX_EXEC, args: ["-p", profile, spec.cmd, ...spec.args] };
}
