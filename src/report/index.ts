import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "../core/schemas.ts";
import { analyze, buildClaims } from "./analyze.ts";
import { renderHtml } from "./html.ts";
import { renderMarkdown } from "./text.ts";
import type { ReportOptions } from "./types.ts";

export * from "./types.ts";
export { analyze, buildClaims, verifyClaims, catastropheReasons, hashRuns, toRow, jsonSafe, resolvePath } from "./analyze.ts";
export { renderHtml } from "./html.ts";
export { renderMarkdown } from "./text.ts";

/** Genera analysis.json, claims.json, report.html y report.md en outDir. */
export function writeReport(runs: readonly RunResult[], outDir: string, opts: ReportOptions = {}): { files: string[] } {
  const a = analyze(runs, opts);
  const c = buildClaims(a, opts);
  mkdirSync(outDir, { recursive: true });
  const out: [string, string][] = [
    ["analysis.json", JSON.stringify(a, null, 2) + "\n"],
    ["claims.json", JSON.stringify(c, null, 2) + "\n"],
    ["report.html", renderHtml(a, c)],
    ["report.md", renderMarkdown(a)],
  ];
  for (const [n, s] of out) writeFileSync(join(outDir, n), s);
  return { files: out.map(([n]) => join(outDir, n)) };
}
