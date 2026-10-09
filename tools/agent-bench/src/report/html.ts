// Informe HTML autocontenido: sin URLs, sin fuentes ni scripts externos. Tema claro/oscuro, accesible.
import type { MetricComparison, PolicyComparison } from "../stats/index.ts";
import type { Analysis, ClaimsFile, ConfigReport } from "./types.ts";
import { esc, logBoxes, paretoChart, stabilityMap, successBars } from "./svg.ts";

const P = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "n/d" : `${(x * 100).toFixed(d)} %`);
const N = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "n/d" : x.toFixed(d));

const CSS = `
:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1c2127;--mut:#59636e;--line:#d6dbe0;--card:#fff;--ok:#1b7f55;--bad:#b3261e;--warn:#9a6700;--okbg:#d9f2e5;--badbg:#fbdad7;--warnbg:#fbe9b8;--nobg:#e6e9ec;
--c0:#2a6fdb;--c1:#c2570c;--c2:#1b8a5a;--c3:#8a4fd0;--c4:#b3265f;--c5:#5b6770}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14181c;--fg:#e7eaed;--mut:#a3adb7;--line:#343c44;--card:#1b2127;--ok:#4cc790;--bad:#ff8a80;--warn:#f2c14e;--okbg:#17402e;--badbg:#4a2220;--warnbg:#4a3a12;--nobg:#2a3138;
--c0:#6ea8ff;--c1:#f0a35e;--c2:#4cc790;--c3:#b794f4;--c4:#f07aa3;--c5:#a3b0ba}}
:root[data-theme="dark"]{--bg:#14181c;--fg:#e7eaed;--mut:#a3adb7;--line:#343c44;--card:#1b2127;--ok:#4cc790;--bad:#ff8a80;--warn:#f2c14e;--okbg:#17402e;--badbg:#4a2220;--warnbg:#4a3a12;--nobg:#2a3138;
--c0:#6ea8ff;--c1:#f0a35e;--c2:#4cc790;--c3:#b794f4;--c4:#f07aa3;--c5:#a3b0ba}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-size:1.5rem;margin:.2em 0}h2{font-size:1.15rem;margin:1.6em 0 .4em;border-bottom:1px solid var(--line);padding-bottom:.2em}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:var(--card);padding:6px;z-index:9}
.meta,.note{color:var(--mut);font-size:.85rem}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:8px 0;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums}caption{text-align:left;color:var(--mut);padding:4px 0}
.tag{display:inline-block;border-radius:4px;padding:1px 7px;font-weight:600;font-size:.8rem}
.v-mejora,.v-mejoramenor{background:var(--okbg);color:var(--ok)}.v-peor,.v-posible{background:var(--badbg);color:var(--bad)}.v-equivalente,.v-sinevidencia{background:var(--nobg);color:var(--fg)}
.warn{background:var(--warnbg);color:var(--fg);border-left:4px solid var(--warn);padding:6px 10px;margin:6px 0;border-radius:4px}
.alert{background:var(--badbg);border-left:4px solid var(--bad);padding:6px 10px;margin:6px 0;border-radius:4px}
button{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid var(--c0);outline-offset:2px}
svg{max-width:100%;height:auto;display:block}svg text{fill:var(--fg);font:12px system-ui,sans-serif}svg .tick{fill:var(--mut);font-size:11px}svg .val{font-weight:600}
svg .grid{stroke:var(--line);stroke-width:1}svg .whisk{stroke:var(--fg);stroke-width:1.5}svg .med{stroke:var(--fg);stroke-width:2.5}svg .front{stroke:var(--mut);stroke-width:1.5;stroke-dasharray:5 3}
.s0{--c:var(--c0)}.s1{--c:var(--c1)}.s2{--c:var(--c2)}.s3{--c:var(--c3)}.s4{--c:var(--c4)}.s5{--c:var(--c5)}
svg .fill{fill:var(--c)}svg .fillsoft{fill:var(--c);fill-opacity:.45;stroke:var(--c);stroke-width:1.5}svg .hollow{fill:var(--card);stroke:var(--c);stroke-width:2.5}
svg .cell.siempre{fill:var(--okbg);stroke:var(--ok)}svg .cell.nunca{fill:var(--badbg);stroke:var(--bad)}svg .cell.aveces{fill:var(--warnbg);stroke:var(--warn)}svg .cell.sindatos{fill:var(--nobg);stroke:var(--line)}svg .cellt{font-size:11px}
code{font:12px ui-monospace,Menlo,monospace;word-break:break-all}@media print{button{display:none}}`;

const SCRIPT = `(function(){var b=document.getElementById("theme");if(!b)return;b.addEventListener("click",function(){var r=document.documentElement,d=r.getAttribute("data-theme")==="dark"||(!r.getAttribute("data-theme")&&window.matchMedia("(prefers-color-scheme: dark)").matches);r.setAttribute("data-theme",d?"light":"dark");});})();`;

export function verdictTag(v: string): string {
  const k = v === "MEJORA" ? "mejora" : v === "MEJORA MENOR" ? "mejoramenor" : v.startsWith("PEOR") ? "peor" : v.startsWith("POSIBLE") ? "posible" : v === "EQUIVALENTE" ? "equivalente" : "sinevidencia";
  const icon = k.startsWith("mejora") ? "▲" : k === "peor" || k === "posible" ? "▼" : k === "equivalente" ? "=" : "?";
  return `<span class="tag v-${k}">${icon} ${esc(v)}</span>`;
}

function cell(m: MetricComparison | undefined): string {
  if (!m) return `<td colspan="4">sin datos</td>`;
  const ratio = m.scale === "log";
  const eff = ratio ? `${N((m.pctChange ?? NaN) * 100, 1)} % [${N((m.pctChangeCi?.lo ?? NaN) * 100, 1)}; ${N((m.pctChangeCi?.hi ?? NaN) * 100, 1)}]` : `${N(m.delta * 100, 1)} pp [${N(m.ci.lo * 100, 1)}; ${N(m.ci.hi * 100, 1)}]`;
  const mde = ratio ? `${N((Math.exp(m.decision.mde) - 1) * 100, 1)} %` : `${N(m.decision.mde * 100, 1)} pp`;
  return `<td class="n">${eff}</td><td class="n">${mde}${m.decision.powered ? "" : " (baja potencia)"}</td><td class="n">${N(m.pSignFlipHolm, 4)}</td><td>${verdictTag(m.decision.veredicto)}</td>`;
}

function abTable(a: Analysis): string {
  if (!a.comparisons.length) return `<p class="note">Solo hay una configuración: no hay comparaciones A/B.</p>`;
  let s = "";
  for (const c of a.comparisons) {
    s += `<div class="card"><table><caption>${esc(c.comparison.candidateId)} frente a ${esc(c.comparison.baselineId)} (ITT) · veredicto global ${verdictTag(c.comparison.itt.overall)}</caption>
<thead><tr><th scope="col">Métrica</th><th scope="col">Efecto [IC 95 %]</th><th scope="col">Efecto mínimo detectable</th><th scope="col">p (Holm)</th><th scope="col">Veredicto</th></tr></thead><tbody>`;
    for (const [m, name] of [["success", "Éxito (puntos porcentuales)"], ["tokens", "Tokens (cambio relativo)"], ["duration", "Duración (cambio relativo)"]] as const) {
      s += `<tr><th scope="row">${name}</th>${cell(c.comparison.itt.metrics[m])}</tr>`;
    }
    s += `</tbody></table><p class="note">Pareado por caso; IC por bootstrap de casos. Margen práctico: éxito ${P(a.options.mpe.success, 0)}, tokens ${P(a.options.mpe.tokens, 0)}, duración ${P(a.options.mpe.duration, 0)}.${c.power && c.power.power !== null ? ` Potencia estimada de declarar MEJORA (IC inferior > MPE) si la mejora real es de ${P(c.power.delta, 0)}: ${P(c.power.power, 0)}; de excluir 0 con una mejora igual al MPE: ${P(c.power.powerAnyEffect, 0)} (${c.power.nCases} casos x ${c.power.repsPerCase} reps${c.power.truncated ? ", truncada por tiempo" : ""}).` : ""}</p></div>`;
  }
  return s;
}

function ittPp(a: Analysis): string {
  if (!a.comparisons.length) return `<p class="note">Sin comparaciones.</p>`;
  const rows = (p: "itt" | "pp", pc: PolicyComparison, id: string) => `<tr><th scope="row">${esc(id)}</th><td>${p.toUpperCase()}</td><td class="n">${pc.runsBaseline}/${pc.runsCandidate}</td><td class="n">${pc.metrics.success ? N(pc.metrics.success.delta * 100, 1) + " pp" : "n/d"}</td><td>${verdictTag(pc.overall)}</td></tr>`;
  let s = `<div class="card"><table><caption>ITT cuenta todos los runs (la infraestructura fallida cuenta como fallo); PP excluye infra_error, rate_limited y cancelled.</caption><thead><tr><th scope="col">Comparación</th><th scope="col">Política</th><th scope="col">Runs base/cand.</th><th scope="col">Efecto éxito</th><th scope="col">Veredicto global</th></tr></thead><tbody>`;
  for (const c of a.comparisons) s += rows("itt", c.comparison.itt, c.id) + rows("pp", c.comparison.pp, c.id);
  s += `</tbody></table></div>`;
  for (const c of a.comparisons) if (c.comparison.policiesDisagree) s += `<div class="warn" role="note">ITT y PP discrepan en ${esc(c.id)}: la conclusión es sensible a los runs de infraestructura.</div>`;
  return s;
}

function cfgTable(cs: ConfigReport[]): string {
  let s = `<div class="card"><table><caption>Resumen por configuración (ITT)</caption><thead><tr><th scope="col">Configuración</th><th scope="col">Runs</th><th scope="col">Éxito [Wilson]</th><th scope="col">pass^3</th><th scope="col">Consistencia</th><th scope="col">Tokens (media geom.)</th><th scope="col">Duración ms (media geom.)</th><th scope="col">Pareto</th></tr></thead><tbody>`;
  for (const c of cs) {
    const k3 = c.itt.passK.find((x) => x.k === 3);
    s += `<tr><th scope="row">${esc(c.configId)}</th><td class="n">${c.itt.runs}</td><td class="n">${P(c.itt.rate)} [${P(c.itt.wilson.lo, 0)}; ${P(c.itt.wilson.hi, 0)}]</td><td class="n">${P(k3?.passPowK, 0)}</td><td class="n">${N(c.itt.stability.consistency, 2)}</td><td class="n">${N(c.itt.tokens.geoMean)}${c.itt.tokens.nulls ? ` (${c.itt.tokens.nulls} null)` : ""}</td><td class="n">${N(c.itt.duration.geoMean)}</td><td>${c.onParetoFront ? "en el frente" : "dominada"}</td></tr>`;
  }
  return s + `</tbody></table></div>`;
}

function catTable(cs: ConfigReport[]): string {
  let s = `<div class="card"><table><caption>Catástrofe: violación de anti-trampas, restricciones, fs_diff, canarios o escalada; run colgado; procesos huérfanos.</caption><thead><tr><th scope="col">Configuración</th><th scope="col">Catástrofes/runs</th><th scope="col">Tasa [Wilson]</th><th scope="col">Motivos</th></tr></thead><tbody>`;
  for (const c of cs) {
    const k = c.catastrophe;
    s += `<tr><th scope="row">${esc(c.configId)}</th><td class="n">${k.catastrophes}/${k.runs}</td><td class="n">${P(k.rate)} [${P(k.wilson.lo, 0)}; ${P(k.wilson.hi, 0)}]</td><td>${Object.entries(k.reasons).map(([r, n]) => `${esc(r)}: ${n}`).join(", ") || "ninguno"}</td></tr>`;
  }
  return s + `</tbody></table></div>`;
}

function compositeSection(a: Analysis): string {
  const c = a.composite;
  if (!c) return `<p class="note">Score compuesto desactivado (predeterminado). Los datos originales son la fuente de verdad.</p>`;
  const regs = c.entries.filter((e) => e.regressions.length);
  let s = c.entries.length ? "" : "";
  if (regs.length) s += `<div class="alert" role="alert"><strong>Regresiones detectadas:</strong> ${regs.map((e) => `${esc(e.configId)} (${e.regressions.map(esc).join(", ")})`).join("; ")}. El score compuesto no las compensa.</div>`;
  s += `<div class="card"><table><caption>${esc(c.note)} Pesos: éxito ${c.weights.success}, tokens ${c.weights.tokens}, duración ${c.weights.duration}.</caption><thead><tr><th scope="col">Configuración</th><th scope="col">Score</th><th scope="col">Éxito</th><th scope="col">Tokens</th><th scope="col">Duración</th><th scope="col">Regresiones</th></tr></thead><tbody>`;
  for (const e of c.entries) s += `<tr><th scope="row">${esc(e.configId)}</th><td class="n">${N(e.score, 3)}</td><td class="n">${N(e.components.success, 3)}</td><td class="n">${N(e.components.tokens, 3)}</td><td class="n">${N(e.components.duration, 3)}</td><td>${e.regressions.length ? e.regressions.map(esc).join(", ") : "ninguna"}</td></tr>`;
  return s + `</tbody></table></div>`;
}

export function renderHtml(a: Analysis, claims: ClaimsFile): string {
  const useUsd = a.configs.every((c) => c.costUsdMean !== null);
  const ids = a.configs.map((c) => c.configId);
  const allWarn = a.comparisons.flatMap((c) => c.warnings);
  const sec = (id: string, h: string, body: string) => `<section aria-labelledby="${id}"><h2 id="${id}">${h}</h2>${body}</section>`;
  const body = [
    sec("resumen", "Resumen", cfgTable(a.configs)),
    sec("avisos", "Avisos de baja potencia", allWarn.length ? allWarn.map((w) => `<div class="warn" role="note">${esc(w.message)}</div>`).join("") : `<p class="note">Sin avisos de potencia.</p>`),
    sec("ab", "Comparación A/B", abTable(a)),
    sec("exito", "Tasa de éxito", `<div class="card">${successBars(a.configs)}</div><p class="note">Barras: tasa ITT; bigotes: intervalo de Wilson al 95 % (descriptivo, asume runs independientes).</p>`),
    sec("dist", "Tokens y duración", `<div class="card">${logBoxes("svg-tokens", "Tokens por run", "tokens", a.configs, (c) => c.tokens)}</div><div class="card">${logBoxes("svg-duration", "Duración por run", "ms", a.configs, (c) => c.duration)}</div><p class="note">Caja = Q1 a Q3, línea gruesa = mediana, bigotes = mínimo y máximo. Los valores null se excluyen, no cuentan como 0.</p>`),
    sec("pareto", "Frente de Pareto calidad-coste", `<div class="card">${paretoChart(a.configs, useUsd ? "coste medio por run (USD)" : "tokens (media geométrica)")}</div><p class="note">Círculo relleno = no dominada; hueco = dominada por otra con mejor o igual éxito y menor coste.</p>`),
    sec("estab", "Estabilidad por caso", `<div class="card">${stabilityMap(a.stability, ids)}</div><p class="note">✓ siempre pasa · ✗ nunca pasa · ~ a veces (inestable). Entre paréntesis: éxitos/runs.</p>`),
    sec("ittpp", "ITT frente a PP", ittPp(a)),
    sec("cat", "Tasa de catástrofes", catTable(a.configs)),
    sec("comp", "Score compuesto (opcional)", compositeSection(a)),
    sec("claims", "Afirmaciones reproducibles", `<div class="card"><p class="note">Cada afirmación está en claims.json con su comando y el hash de datos <code>${esc(claims.dataHash.slice(0, 16))}</code> (${esc(claims.dataVersion)}). Total: ${claims.claims.length}.</p><details><summary>Ver comando de ejemplo</summary><code>${esc(claims.claims[0]?.command ?? "")}</code></details></div>`),
  ].join("\n");
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(a.title)}</title><style>${CSS}</style></head><body>
<a class="skip" href="#resumen">Saltar al contenido</a>
<main><header><h1>${esc(a.title)}</h1><p class="meta">${a.data.runs} runs · ${a.data.cases} casos · ${a.data.configs} configuraciones · base: ${esc(a.options.baselineId)} · semilla ${a.options.seed} · hash de datos ${esc(a.data.dataHash.slice(0, 16))}</p><button id="theme" type="button" aria-label="Cambiar tema claro u oscuro">Tema</button></header>
${body}
</main><script>${SCRIPT}</script></body></html>
`;
}
