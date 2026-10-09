import { mkdir, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { safeCopyTree } from "./safecopy.ts";

/** Señal de que el árbol de procesos del agente ha muerto. La emite quien supervisa (core/proc). */
export class TreeDeadSignal {
  readonly promise: Promise<void>;
  #resolve!: () => void;
  #dead = false;
  constructor() { this.promise = new Promise<void>((r) => { this.#resolve = r; }); }
  get dead(): boolean { return this.#dead; }
  markDead(): void { this.#dead = true; this.#resolve(); }
}

async function listFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(root, p)));
    else if (e.isFile()) out.push(relative(root, p).split(sep).join("/"));
  }
  return out.sort();
}

function inside(parent: string, child: string): boolean {
  const r = relative(resolve(parent), resolve(child));
  return r === "" || (!r.startsWith("..") && !r.startsWith(sep));
}

/**
 * Crea la copia de evaluación: copia el workspace y luego inyecta los tests ocultos.
 * Los ocultos SOLO se copian después de `treeDead` (si la señal no ha llegado se espera;
 * `timeoutMs` evita esperar para siempre y rechaza sin copiar nada oculto).
 */
export async function createEvalCopy(opts: {
  workspaceDir: string;
  evalDir: string;
  hiddenDir: string | null;
  treeDead: TreeDeadSignal;
  timeoutMs?: number;
  /** conservar `.git` del workspace (solo modo legado de pruebas); por defecto nunca se copia */
  keepGit?: boolean;
}): Promise<{ evalDir: string; hiddenFiles: string[]; rejectedSymlinks: string[] }> {
  const { workspaceDir, evalDir, hiddenDir, treeDead } = opts;
  if (inside(workspaceDir, evalDir) || inside(evalDir, workspaceDir)) throw new Error("evalDir y workspace no pueden anidarse");
  if (hiddenDir && inside(workspaceDir, hiddenDir)) throw new Error("los tests ocultos no pueden vivir dentro del workspace del agente");

  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("timeout esperando la muerte del árbol de procesos del agente")), opts.timeoutMs ?? 30_000);
  });
  try { await Promise.race([treeDead.promise, limit]); } finally { clearTimeout(timer); }
  if (!treeDead.dead) throw new Error("señal de árbol muerto no confirmada");

  // C2: copia sin seguir enlaces (lstat); los symlinks del agente se descartan y se reportan
  await mkdir(evalDir, { recursive: true });
  const copied = await safeCopyTree(workspaceDir, evalDir, {
    skip: (rel) => !opts.keepGit && rel.split("/").includes(".git"),
  });
  let hiddenFiles: string[] = [];
  if (hiddenDir) {
    if (!(await stat(hiddenDir)).isDirectory()) throw new Error("hiddenDir no es un directorio");
    hiddenFiles = await listFiles(hiddenDir);
    await safeCopyTree(hiddenDir, evalDir, { overwrite: true });
  }
  return { evalDir, hiddenFiles, rejectedSymlinks: copied.symlinks };
}
