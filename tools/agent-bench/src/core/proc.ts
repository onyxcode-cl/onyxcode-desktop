import { spawn, spawnSync } from "node:child_process";

export interface ProcEntry {
  pid: number;
  ppid: number;
  pgid: number;
}

/** Parsea la salida de `ps -A -o pid=,ppid=,pgid=`. */
export function parsePs(out: string): ProcEntry[] {
  const res: ProcEntry[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) res.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]) });
  }
  return res;
}

export function snapshotProcs(): ProcEntry[] {
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8", timeout: 10_000 });
  return parsePs(r.stdout ?? "");
}

/** Descendientes (por ppid, transitivo) de rootPid; no incluye la raíz. */
export function descendantsOf(rootPid: number, table: readonly ProcEntry[] = snapshotProcs()): number[] {
  const children = new Map<number, number[]>();
  for (const p of table) {
    const arr = children.get(p.ppid) ?? [];
    arr.push(p.pid);
    children.set(p.ppid, arr);
  }
  const out: number[] = [];
  const seen = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length) {
    const cur = stack.pop() as number;
    for (const c of children.get(cur) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
        stack.push(c);
      }
    }
  }
  return out;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
  // zombie: ps stat Z cuenta como muerto
  const r = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 });
  const stat = (r.stdout ?? "").trim();
  return stat !== "" && !stat.startsWith("Z");
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function signalSafe(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    /* ya muerto */
  }
}

export interface KillOptions {
  graceMs?: number; // SIGTERM -> SIGKILL (def 3000)
  verifyMs?: number; // espera máx. verificación final (def 2000)
  /** pids extra a incluir (p. ej. descendientes conocidos previamente) */
  extraPids?: readonly number[];
}

export interface KillResult {
  targeted: number[]; // pids objetivo (raíz + descendientes + grupo)
  sigkilled: number[]; // los que necesitaron SIGKILL
  orphans: number[]; // sobrevivientes tras verificación (idealmente [])
}

/**
 * Mata la raíz, su grupo de procesos y todos sus descendientes (aunque hayan
 * hecho setsid). Snapshot ANTES de señalar para no perder hijos reparentados.
 * SIGTERM -> graceMs -> SIGKILL -> verificación de cero huérfanos.
 */
export async function killTree(rootPid: number, opts: KillOptions = {}): Promise<KillResult> {
  const graceMs = opts.graceMs ?? 3000;
  const verifyMs = opts.verifyMs ?? 2000;
  const self = process.pid;
  const table = snapshotProcs();
  const targets = new Set<number>([rootPid, ...descendantsOf(rootPid, table), ...(opts.extraPids ?? [])]);
  const groups = new Set<number>();
  for (const p of table) if (targets.has(p.pid) && p.pgid > 1) groups.add(p.pgid);
  groups.add(rootPid); // lider de grupo (detached) aunque ya haya muerto
  // Nunca tocar nuestro propio grupo
  const myPgid = table.find((p) => p.pid === self)?.pgid;
  if (myPgid !== undefined) groups.delete(myPgid);
  targets.delete(self);
  const list = [...targets];

  const sendAll = (sig: NodeJS.Signals): void => {
    for (const g of groups) signalSafe(-g, sig);
    for (const pid of list) signalSafe(pid, sig);
  };
  sendAll("SIGTERM");

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && list.some(isAlive)) await sleep(50);

  const sigkilled: number[] = [];
  // re-snapshot: incluye hijos nacidos durante la gracia
  const late = descendantsOf(rootPid).filter((p) => p !== self);
  for (const p of late) if (!targets.has(p)) { targets.add(p); list.push(p); }
  for (const pid of list) if (isAlive(pid)) sigkilled.push(pid);
  if (sigkilled.length) {
    for (const g of groups) signalSafe(-g, "SIGKILL");
    for (const pid of sigkilled) signalSafe(pid, "SIGKILL");
  }
  const vd = Date.now() + verifyMs;
  while (Date.now() < vd && list.some(isAlive)) await sleep(25);
  return { targeted: list, sigkilled, orphans: list.filter(isAlive) };
}

/** Devuelve los pids de la lista que siguen vivos. */
export function verifyNoOrphans(pids: readonly number[]): number[] {
  return pids.filter(isAlive);
}

export type ProcOutcome = "completed" | "timeout" | "hung" | "cancelled" | "spawn_error";

export interface SuperviseOptions {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  /** tope duro de tiempo total */
  timeoutMs: number;
  /** sin salida stdout/stderr durante este tiempo => hung (opcional) */
  inactivityMs?: number;
  signal?: AbortSignal;
  graceMs?: number;
  /** tope de bytes retenidos por stream (def 4 MiB); se sigue drenando */
  maxOutputBytes?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SuperviseResult {
  outcome: ProcOutcome;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  pid: number | null;
  /** pids que siguieron vivos tras limpiar el árbol (debe ser []) */
  orphans: number[];
  error?: string;
}

/**
 * Ejecuta un comando como líder de su propio grupo (detached), con timeout,
 * watchdog de inactividad y cancelación. Al terminar (por cualquier causa)
 * mata todo el árbol y verifica cero huérfanos.
 */
export async function supervise(o: SuperviseOptions): Promise<SuperviseResult> {
  const start = Date.now();
  const max = o.maxOutputBytes ?? 4 * 1024 * 1024;
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let outcome: ProcOutcome = "completed";
  let forced = false;

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.env ?? process.env)) if (v !== undefined) env[k] = v;

  const child = spawn(o.cmd, o.args ?? [], {
    cwd: o.cwd,
    env,
    detached: true,
    stdio: [o.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
  });

  if (child.pid === undefined) {
    const err = await new Promise<string>((res) => child.once("error", (e) => res(e.message)));
    return { outcome: "spawn_error", exitCode: null, signal: null, stdout, stderr, truncated, durationMs: Date.now() - start, pid: null, orphans: [], error: err };
  }
  const pid = child.pid;
  child.on("error", () => {});
  const known = new Set<number>([pid]);

  let lastActivity = Date.now();
  const append = (kind: "out" | "err", chunk: Buffer): void => {
    lastActivity = Date.now();
    const s = chunk.toString("utf8");
    (kind === "out" ? o.onStdout : o.onStderr)?.(s);
    const cur = kind === "out" ? stdout : stderr;
    if (cur.length + s.length > max) {
      truncated = true;
      const keep = cur + s.slice(0, Math.max(0, max - cur.length));
      if (kind === "out") stdout = keep; else stderr = keep;
    } else if (kind === "out") stdout += s; else stderr += s;
  };
  child.stdout?.on("data", (c: Buffer) => append("out", c));
  child.stderr?.on("data", (c: Buffer) => append("err", c));
  if (o.stdin !== undefined) {
    child.stdin?.on("error", () => {});
    child.stdin?.end(o.stdin);
  }

  const exited = new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((res) => {
    child.once("exit", (code, sig) => res({ code, sig }));
  });

  let killing: Promise<KillResult> | null = null;
  const kill = (why: ProcOutcome): void => {
    if (forced) return;
    forced = true;
    outcome = why;
    for (const d of descendantsOf(pid)) known.add(d);
    killing = killTree(pid, { graceMs: o.graceMs ?? 3000, extraPids: [...known] });
  };

  const timer = setTimeout(() => kill("timeout"), o.timeoutMs);
  const poll = setInterval(() => {
    for (const d of descendantsOf(pid)) known.add(d);
    if (o.inactivityMs !== undefined && Date.now() - lastActivity > o.inactivityMs) kill("hung");
  }, 250);
  const onAbort = (): void => kill("cancelled");
  if (o.signal) {
    if (o.signal.aborted) onAbort();
    else o.signal.addEventListener("abort", onAbort, { once: true });
  }

  const { code, sig } = await exited;
  clearTimeout(timer);
  clearInterval(poll);
  o.signal?.removeEventListener("abort", onAbort);

  // Limpieza final siempre: el agente puede dejar nietos tras salir el líder.
  let orphans: number[];
  if (killing) {
    orphans = (await (killing as Promise<KillResult>)).orphans;
  } else {
    const pending = [...known].filter(isAlive);
    const left = descendantsOf(pid).concat(pending);
    let groupAlive = false;
    try { process.kill(-pid, 0); groupAlive = true; } catch { /* grupo vacio */ }
    if (left.length || known.size > 1 || groupAlive) {
      const r = await killTree(pid, { graceMs: o.graceMs ?? 3000, extraPids: [...known, ...left] });
      orphans = r.orphans;
    } else orphans = [];
  }

  return {
    outcome,
    exitCode: code,
    signal: sig,
    stdout,
    stderr,
    truncated,
    durationMs: Date.now() - start,
    pid,
    orphans,
  };
}
