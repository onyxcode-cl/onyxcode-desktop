// Salida en texto/markdown para terminal.
import type { Analysis } from "./types.ts";

const P = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "n/d" : `${(x * 100).toFixed(d)}%`);
const N = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "n/d" : x.toFixed(d));

export function renderMarkdown(a: Analysis): string {
  const L: string[] = [];
  L.push(`# ${a.title}`, "", `${a.data.runs} runs, ${a.data.cases} casos, ${a.data.configs} configuraciones. Base: ${a.options.baselineId}. Hash de datos: ${a.data.dataHash.slice(0, 16)}.`, "");
  L.push("## Configuraciones (ITT)", "", "| Config | Runs | Éxito [Wilson] | pass^3 | Tokens | Duración ms | Catástrofes |", "|---|---:|---|---:|---:|---:|---:|");
  for (const c of a.configs) {
    const k3 = c.itt.passK.find((x) => x.k === 3);
    L.push(`| ${c.configId} | ${c.itt.runs} | ${P(c.itt.rate)} [${P(c.itt.wilson.lo, 0)}; ${P(c.itt.wilson.hi, 0)}] | ${P(k3?.passPowK, 0)} | ${N(c.itt.tokens.geoMean)} | ${N(c.itt.duration.geoMean)} | ${P(c.catastrophe.rate)} |`);
  }
  L.push("", "## Comparaciones A/B", "");
  if (!a.comparisons.length) L.push("Solo hay una configuración.");
  for (const c of a.comparisons) {
    L.push(`### ${c.comparison.candidateId} vs ${c.comparison.baselineId}: ITT ${c.comparison.itt.overall} / PP ${c.comparison.pp.overall}`, "", "| Métrica | Efecto [IC] | MDE | Veredicto |", "|---|---|---|---|");
    for (const m of ["success", "tokens", "duration"] as const) {
      const x = c.comparison.itt.metrics[m];
      if (!x) { L.push(`| ${m} | sin datos | | |`); continue; }
      const log = x.scale === "log";
      const eff = log ? `${N((x.pctChange ?? NaN) * 100, 1)}% [${N((x.pctChangeCi?.lo ?? NaN) * 100, 1)}; ${N((x.pctChangeCi?.hi ?? NaN) * 100, 1)}]` : `${N(x.delta * 100, 1)} pp [${N(x.ci.lo * 100, 1)}; ${N(x.ci.hi * 100, 1)}]`;
      const mde = log ? `${N((Math.exp(x.decision.mde) - 1) * 100, 1)}%` : `${N(x.decision.mde * 100, 1)} pp`;
      L.push(`| ${m} | ${eff} | ${mde}${x.decision.powered ? "" : " (baja potencia)"} | ${x.decision.veredicto} |`);
    }
    L.push("");
  }
  const w = a.comparisons.flatMap((c) => c.warnings);
  if (w.length) L.push("## Avisos", "", ...w.map((x) => `- ${x.message}`), "");
  L.push("## Estabilidad por caso (✓ siempre, ✗ nunca, ~ a veces)", "", `| Caso | ${a.configs.map((c) => c.configId).join(" | ")} |`, `|---|${a.configs.map(() => "---").join("|")}|`);
  const g = { siempre: "✓", nunca: "✗", "a veces": "~", "sin datos": "?" } as const;
  for (const r of a.stability) L.push(`| ${r.caseId} | ${a.configs.map((c) => { const x = r.cells[c.configId]!; return `${g[x.state]} ${x.successes}/${x.runs}`; }).join(" | ")} |`);
  if (a.composite) {
    L.push("", "## Score compuesto (opcional)", "");
    for (const e of a.composite.entries) L.push(`- ${e.configId}: ${N(e.score, 3)}${e.regressions.length ? `  REGRESIONES: ${e.regressions.join(", ")}` : ""}`);
  }
  return L.join("\n") + "\n";
}
