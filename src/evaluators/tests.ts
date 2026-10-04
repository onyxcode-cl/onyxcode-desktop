import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { runLimited } from "./exec.ts";
import type { EvalSandbox } from "./exec.ts";
import { diffAgainstBase, listBaseFiles, restoreFromBase } from "../workspace/restore.ts";
import { safeCopyTree } from "../workspace/safecopy.ts";
import { matchesAny } from "./glob.ts";
import { parseTestOutput } from "./tap.ts";
import { infraError, notApplicable, type EvalContext, type Evaluator, type EvaluatorResult } from "./types.ts";

export interface TestsOptions {
  timeoutMs?: number;
  /** Globs de archivos de test (relativos a la raíz). */
  testGlobs?: string[];
}

export const DEFAULT_TEST_GLOBS = ["**/*.test.{js,mjs,cjs,ts,mts}", "**/*.spec.{js,mjs,cjs,ts,mts}", "test/**/*.{js,mjs,ts,mts}"];

async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(root, p)));
    else if (e.isFile()) out.push(relative(root, p).split(sep).join("/"));
  }
  return out.sort();
}

export async function runNodeTests(id: string, root: string, files: string[] | null, o: TestsOptions, env?: Record<string, string>, sandbox?: EvalSandbox): Promise<EvaluatorResult> {
  const list = files ?? (await walk(root)).filter((f) => matchesAny(f, o.testGlobs ?? DEFAULT_TEST_GLOBS));
  if (list.length === 0) return notApplicable(id, "no hay archivos de test");
  const args = ["--test", "--test-reporter=tap"];
  if (list.some((f) => /\.m?ts$/.test(f))) args.push("--experimental-strip-types");
  const timeoutMs = o.timeoutMs ?? 60_000;
  const r = await runLimited(process.execPath, [...args, ...list], { cwd: root, timeoutMs, ...(env ? { env } : {}), ...(sandbox ? { sandbox } : {}) });
  const summary = parseTestOutput(r.stdout);
  const details: Record<string, unknown> = { files: list, exitCode: r.code, timedOut: r.timedOut, summary, stderrTail: r.stderr.slice(-1000) };
  const base = { schemaVersion: "1" as const, evaluator: id, applicable: true, durationMs: r.durationMs };
  if (r.timedOut) return { ...base, pass: false, score: summary && summary.total > 0 ? summary.pass / summary.total : 0, details };
  if (!summary) return { ...base, pass: false, score: 0, details: { ...details, parseError: true } };
  const pass = r.code === 0 && summary.fail === 0 && summary.cancelled === 0 && summary.total > 0;
  return { ...base, pass, score: summary.total > 0 ? summary.pass / summary.total : 0, details };
}

export function testsVisible(o: TestsOptions = {}): Evaluator {
  const id = "tests-visible";
  return {
    id,
    async evaluate(ctx: EvalContext) {
      try {
        if (!ctx.baseCommit) return await runNodeTests(id, ctx.workspaceDir, null, o, ctx.env, ctx.sandbox ? { root: ctx.workspaceDir } : undefined);
        return await runWithOriginalTests(id, ctx, o);
      } catch (e) { return infraError(id, String(e)); }
    },
  };
}

/**
 * Anti-trampa: ejecuta en una COPIA del workspace donde los tests visibles del commit base
 * se restauran a su contenido original (el agente no puede editarlos ni borrarlos).
 * El workspace del agente no se modifica. Los tests nuevos añadidos por el agente se ejecutan igualmente.
 */
async function runWithOriginalTests(id: string, ctx: EvalContext, o: TestsOptions): Promise<EvaluatorResult> {
  const baseCommit = ctx.baseCommit!;
  const holder = await mkdtemp(join(tmpdir(), "ab-vis-"));
  const copy = join(holder, "tree");
  try {
    // copia sin seguir enlaces; con gitdir separado el .git del agente nunca se copia y el índice es temporal
    const copied = await safeCopyTree(ctx.workspaceDir, copy, { skip: (rel) => !!ctx.gitDir && rel.split("/").includes(".git") });
    const ro = ctx.gitDir ? { gitDir: ctx.gitDir, indexFile: join(holder, "index") } : {};
    const globs = o.testGlobs ?? DEFAULT_TEST_GLOBS;
    const originals = (await listBaseFiles(copy, baseCommit, ro)).filter((f) => matchesAny(f, globs));
    let tampered: string[] = [];
    if (originals.length > 0) {
      tampered = await diffAgainstBase(copy, baseCommit, originals, ro);
      await restoreFromBase(copy, baseCommit, originals, ro);
    }
    const r = await runNodeTests(id, copy, null, o, ctx.env, ctx.sandbox ? { root: copy } : undefined);
    return { ...r, details: { ...r.details, restoredTests: originals, tamperedTests: tampered, ...(copied.symlinks.length ? { symlinksDropped: copied.symlinks } : {}) } };
  } finally {
    await rm(holder, { recursive: true, force: true });
  }
}

/** Ejecuta SOLO en la copia de evaluación y solo los archivos ocultos inyectados. */
export function testsHidden(o: TestsOptions = {}): Evaluator {
  const id = "tests-hidden";
  return {
    id,
    async evaluate(ctx: EvalContext) {
      if (!ctx.evalDir || !ctx.hiddenFiles || ctx.hiddenFiles.length === 0) return notApplicable(id, "sin tests ocultos");
      try { return await runNodeTests(id, ctx.evalDir, ctx.hiddenFiles, o, ctx.env, ctx.sandbox ? { root: ctx.evalDir } : undefined); }
      catch (e) { return infraError(id, String(e)); }
    },
  };
}
