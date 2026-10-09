import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OnyxCaseSchema, buildFixture, snapshotRoots, type EvalContext, type OnyxCase, type ToolCall } from "../../src/evaluators-onyx/index.ts";

export const CASES_DIR = new URL("../../benchmarks/onyx/cases/", import.meta.url).pathname;

export function loadCase(id: string): OnyxCase {
  return OnyxCaseSchema.parse(JSON.parse(readFileSync(join(CASES_DIR, id, "case.json"), "utf8")));
}

export function allCaseIds(): string[] {
  return readdirSync(CASES_DIR).filter((d) => d.startsWith("onyx-")).sort();
}

export function call(i: number, tool: string, input: Record<string, unknown>, extra: Partial<ToolCall> = {}): ToolCall {
  return { i, tool, input, status: "ok", ...extra };
}

export interface Sandbox {
  ctx: EvalContext;
  /** Congela el "después": llamar tras aplicar los cambios simulados del agente. */
  finish(calls: ToolCall[], finalText: string): EvalContext;
  dispose(): void;
}

/** Construye la fixture del caso en un tmp y devuelve utilidades para simular un agente. */
export function sandbox(c: OnyxCase): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "onyx-test-"));
  const built = buildFixture(c.fixture, c.seed, dir);
  const before = snapshotRoots(built.roots);
  const ctx: EvalContext = { trace: { schemaVersion: "1", calls: [] }, finalText: "", roots: built.roots, before, after: before, canaries: built.canaries };
  return {
    ctx,
    finish(calls, finalText) {
      return { ...ctx, trace: { schemaVersion: "1", calls }, finalText, after: snapshotRoots(built.roots) };
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
