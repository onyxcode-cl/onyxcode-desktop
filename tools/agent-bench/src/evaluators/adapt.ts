// Adaptador: resultado local de evaluador -> EvaluatorResult de src/core/schemas.ts (zod).
import { EvaluatorKindSchema, EvaluatorResultSchema, type EvaluatorResult as CoreEvaluatorResult } from "../core/schemas.ts";
import type { EvaluatorResult as LocalEvaluatorResult } from "./types.ts";

const MAX_DETAILS = 4000;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function violationsOf(d: Record<string, unknown>): string[] {
  const out: string[] = [];
  const v = d.violations;
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === "string") out.push(x);
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        out.push(`${String(o.rule ?? "violation")}:${String(o.file ?? "")}`);
      }
    }
  }
  const f = d.findings;
  if (Array.isArray(f)) for (const x of f) out.push(typeof x === "string" ? x : JSON.stringify(x));
  return out;
}

/** Mapea el resultado local al esquema de core. `kind` sale del id del evaluador (debe ser un EvaluatorKind válido). */
export function toCoreEvaluatorResult(r: LocalEvaluatorResult): CoreEvaluatorResult {
  const kind = EvaluatorKindSchema.parse(r.evaluator);
  const d = r.details ?? {};
  const summary = (d.summary ?? null) as Record<string, unknown> | null;
  const passedCount = summary ? num(summary.pass) : null;
  const total = summary ? num(summary.total) : null;
  let details = JSON.stringify(d);
  if (r.error) details = JSON.stringify({ error: r.error, ...d });
  if (details.length > MAX_DETAILS) details = details.slice(0, MAX_DETAILS);
  return EvaluatorResultSchema.parse({
    schemaVersion: "1",
    kind,
    // No aplica o error de infraestructura => null (indeterminado), nunca false.
    passed: r.applicable && !r.error ? r.pass : null,
    score: r.applicable && !r.error ? r.score : null,
    testsPassed: passedCount,
    testsTotal: total,
    violations: violationsOf(d),
    details,
    durationMs: r.durationMs === null ? null : Math.round(r.durationMs),
  });
}
