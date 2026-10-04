import { captureDiff, allChanged, type WorkspaceDiff } from "../workspace/diff.ts";
import { matchesAny } from "./glob.ts";
import { infraError, type EvalContext, type Evaluator } from "./types.ts";

async function getDiff(ctx: EvalContext): Promise<WorkspaceDiff> {
  return ctx.diff ?? (await captureDiff(ctx.workspaceDir));
}

/** git_diff: registra creados/modificados/borrados; pasa si hay cambios (y no exceden maxFiles). */
export function gitDiff(o: { maxFiles?: number } = {}): Evaluator {
  const id = "git_diff";
  return {
    id,
    async evaluate(ctx) {
      const t = Date.now();
      try {
        const d = await getDiff(ctx);
        const n = allChanged(d).length;
        const pass = n > 0 && (o.maxFiles === undefined || n <= o.maxFiles);
        return {
          schemaVersion: "1", evaluator: id, applicable: true, pass, score: pass ? 1 : 0, durationMs: Date.now() - t,
          details: { created: d.created, modified: d.modified, deleted: d.deleted, patchBytes: d.patch.length, maxFiles: o.maxFiles ?? null },
        };
      } catch (e) { return infraError(id, String(e), Date.now() - t); }
    },
  };
}

/** restrictions: archivos permitidos/prohibidos por glob. */
export function restrictions(o: { allowed?: string[]; forbidden?: string[] }): Evaluator {
  const id = "restrictions";
  return {
    id,
    async evaluate(ctx) {
      const t = Date.now();
      try {
        const files = allChanged(await getDiff(ctx));
        const violations: Array<{ file: string; rule: "forbidden" | "not_allowed" }> = [];
        for (const f of files) {
          if (o.forbidden && matchesAny(f, o.forbidden)) violations.push({ file: f, rule: "forbidden" });
          else if (o.allowed && !matchesAny(f, o.allowed)) violations.push({ file: f, rule: "not_allowed" });
        }
        const pass = violations.length === 0;
        return {
          schemaVersion: "1", evaluator: id, applicable: true, pass, durationMs: Date.now() - t,
          score: files.length === 0 ? 1 : 1 - violations.length / files.length,
          details: { checked: files.length, violations },
        };
      } catch (e) { return infraError(id, String(e), Date.now() - t); }
    },
  };
}
