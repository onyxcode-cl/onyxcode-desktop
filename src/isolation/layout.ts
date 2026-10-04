import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { RunLayout } from "./types.ts";

export function defaultBase(): string {
  return join(homedir(), "ab", "r");
}

/** Crea ~/ab/r/<runId8>/{ws,home,tmp,eval,out}. La base es configurable. */
export function createRunLayout(runId: string, base: string = defaultBase()): RunLayout {
  if (!/^[A-Za-z0-9_-]{8,}$/.test(runId)) throw new Error(`runId inválido: ${runId}`);
  const runId8 = runId.slice(0, 8);
  mkdirSync(base, { recursive: true });
  const root = join(realpathSync(resolve(base)), runId8);
  const dirs = ["ws", "home", "tmp", "eval", "out"] as const;
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true, mode: 0o700 });
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
  };
}

export function removeRunLayout(layout: RunLayout): void {
  rmSync(layout.root, { recursive: true, force: true });
}
