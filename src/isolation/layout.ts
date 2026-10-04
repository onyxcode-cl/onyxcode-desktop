import { lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { RunLayout } from "./types.ts";

export function defaultBase(): string {
  return join(homedir(), "ab", "r");
}

/**
 * Crea ~/ab/r/<runId8>/{ws,home,tmp,eval,out,ctl}. La base es configurable.
 * Solo ws, home y tmp son escribibles por el agente (perfil Seatbelt); out, eval y ctl los escribe el banco.
 * El directorio del run se crea SIN recursive: una colisión de runId8 falla en vez de reutilizar el directorio (B5).
 */
export function createRunLayout(runId: string, base: string = defaultBase()): RunLayout {
  if (!/^[A-Za-z0-9_-]{8,}$/.test(runId)) throw new Error(`runId inválido: ${runId}`);
  const runId8 = runId.slice(0, 8);
  mkdirSync(base, { recursive: true });
  const root = join(realpathSync(resolve(base)), runId8);
  mkdirSync(root, { mode: 0o700 }); // EEXIST si ya existe
  const dirs = ["ws", "home", "tmp", "eval", "out", "ctl"] as const;
  for (const d of dirs) mkdirSync(join(root, d), { mode: 0o700 });
  return {
    schemaVersion: "1",
    runId,
    runId8,
    root,
    ws: join(root, "ws"),
    home: join(root, "home"),
    tmp: join(root, "tmp"),
    eval: join(root, "eval"),
    out: join(root, "out"),
    ctl: join(root, "ctl"),
  };
}

/** Falla si `dir` no es un directorio real (no symlink). Para carpetas del banco que el agente no debe poder redirigir. */
export function assertRealDir(dir: string): void {
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`no es un directorio real: ${dir}`);
}

export function removeRunLayout(layout: RunLayout): void {
  const root = resolve(layout.root);
  // B5: solo se borra una carpeta con la forma de un run (…/<runId8> con ws/home/tmp propios), nunca un root arbitrario
  const ok = root.split(sep).length >= 4 && /^[A-Za-z0-9_-]{8}$/.test(root.split(sep).pop() ?? "") &&
    resolve(layout.ws) === join(root, "ws") && resolve(layout.home) === join(root, "home");
  if (!ok) throw new Error(`root de run sospechoso, no se borra: ${root}`);
  rmSync(root, { recursive: true, force: true });
}
