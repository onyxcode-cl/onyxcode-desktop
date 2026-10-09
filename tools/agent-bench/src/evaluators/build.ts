import { runLimited } from "./exec.ts";
import { notApplicable, type EvalContext, type Evaluator } from "./types.ts";

/** Evaluador build/typecheck con comando configurable (argv, sin shell). Sin comando: no aplica. */
export function buildCheck(o: { id?: string; command?: string[]; timeoutMs?: number }): Evaluator {
  const id = o.id ?? "build";
  return {
    id,
    async evaluate(ctx: EvalContext) {
      if (!o.command || o.command.length === 0) return notApplicable(id, "sin comando configurado");
      const [cmd, ...args] = o.command;
      const r = await runLimited(cmd!, args, { cwd: ctx.workspaceDir, timeoutMs: o.timeoutMs ?? 120_000, ...(ctx.env ? { env: ctx.env } : {}), ...(ctx.sandbox ? { sandbox: { root: ctx.workspaceDir } } : {}) });
      const pass = r.code === 0 && !r.timedOut;
      return {
        schemaVersion: "1", evaluator: id, applicable: true, pass, score: pass ? 1 : 0, durationMs: r.durationMs,
        details: { command: o.command, exitCode: r.code, timedOut: r.timedOut, outputTail: (r.stdout + r.stderr).slice(-2000) },
      };
    },
  };
}
