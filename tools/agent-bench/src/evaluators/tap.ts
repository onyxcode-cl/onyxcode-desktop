export interface TestSummary { total: number; pass: number; fail: number; skipped: number; cancelled: number; failedNames: string[] }

/** Parsea la salida TAP de `node --test` (resumen "# tests/pass/fail/...") o, si no hay, un JSON {total|tests,pass,fail}. */
export function parseTestOutput(text: string): TestSummary | null {
  const num = (k: string) => {
    const m = text.match(new RegExp(`^# ${k} (\\d+)\\s*$`, "m"));
    return m ? Number(m[1]) : null;
  };
  const total = num("tests");
  if (total !== null) {
    const failedNames: string[] = [];
    for (const m of text.matchAll(/^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/gm)) failedNames.push(m[1]!);
    return { total, pass: num("pass") ?? 0, fail: num("fail") ?? 0, skipped: num("skipped") ?? 0, cancelled: num("cancelled") ?? 0, failedNames };
  }
  const start = text.indexOf("{");
  if (start >= 0) {
    try {
      const j = JSON.parse(text.slice(start)) as Record<string, unknown>;
      const pass = Number(j.pass), fail = Number(j.fail);
      const t = Number(j.total ?? j.tests ?? pass + fail);
      if ([pass, fail, t].every(Number.isFinite)) return { total: t, pass, fail, skipped: Number(j.skipped ?? 0), cancelled: Number(j.cancelled ?? 0), failedNames: [] };
    } catch { /* no es JSON */ }
  }
  return null;
}
