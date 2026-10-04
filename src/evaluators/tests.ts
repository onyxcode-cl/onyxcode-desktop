import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { runLimited } from "./exec.ts";
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

export async function runNodeTests(id: string, root: string, files: string[] | null, o: TestsOptions, env?: Record<string, string>): Promise<EvaluatorResult> {
  const list = files ?? (await walk(root)).filter((f) => matchesAny(f, o.testGlobs ?? DEFAULT_TEST_GLOBS));
  if (list.length === 0) return notApplicable(id, "no hay archivos de test");
  const args = ["--test", "--test-reporter=tap"];
  if (list.some((f) => /\.m?ts$/.test(f))) args.push("--experimental-strip-types");
  const timeoutMs = o.timeoutMs ?? 60_000;
  const r = await runLimited(process.execPath, [...args, ...list], { cwd: root, timeoutMs, ...(env ? { env } : {}) });
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
      try { return await runNodeTests(id, ctx.workspaceDir, null, o, ctx.env); }
      catch (e) { return infraError(id, String(e)); }
    },
  };
}

/** Ejecuta SOLO en la copia de evaluación y solo los archivos ocultos inyectados. */
export function testsHidden(o: TestsOptions = {}): Evaluator {
  const id = "tests-hidden";
  return {
    id,
    async evaluate(ctx: EvalContext) {
      if (!ctx.evalDir || !ctx.hiddenFiles || ctx.hiddenFiles.length === 0) return notApplicable(id, "sin tests ocultos");
      try { return await runNodeTests(id, ctx.evalDir, ctx.hiddenFiles, o, ctx.env); }
      catch (e) { return infraError(id, String(e)); }
    },
  };
}
