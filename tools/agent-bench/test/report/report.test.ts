import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, buildClaims, renderHtml, renderMarkdown, verifyClaims, resolvePath, writeReport, hashRuns } from "../../src/report/index.ts";
import { makeRuns } from "./fixtures/synthetic.ts";

const runs = makeRuns();
const opts = { baselineId: "base", B: 500, powerSims: 100 };
const analysis = analyze(runs, opts);
const claims = buildClaims(analysis, opts);
const html = renderHtml(analysis, claims);

/** Comprobador mínimo de XML bien formado (pila de etiquetas, atributos entrecomillados, entidades válidas). */
function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<[^>]*>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const [tok, close, name, , self] = m;
    if (tok!.startsWith("<")) {
      assert.ok(name, `etiqueta mal formada: ${tok}`);
      if (self) continue;
      if (close) assert.equal(stack.pop(), name, `cierre inesperado </${name}>`);
      else stack.push(name!);
    } else {
      assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(tok!), `entidad inválida en: ${tok!.slice(0, 40)}`);
    }
  }
  assert.deepEqual(stack, []);
}

test("HTML autocontenido: sin http://, https:// ni recursos externos", () => {
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<link\b|<script[^>]*\bsrc=|@import|url\(|<img\b|<iframe/i);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /<html lang="es"/);
});

test("grep real del archivo escrito: sin http:// ni https://", () => {
  const d = mkdtempSync(join(tmpdir(), "ab-report-"));
  try {
    const { files } = writeReport(runs, d, opts);
    for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /https?:\/\//i, f);
    assert.equal(files.length, 4);
    JSON.parse(readFileSync(join(d, "analysis.json"), "utf8"));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("todos los SVG están bien formados y accesibles", () => {
  const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
  assert.ok(svgs.length === 5, `esperaba 5 SVG, hay ${svgs.length}`);
  for (const s of svgs) {
    assertWellFormed(s);
    assert.match(s, /role="img"/);
    assert.match(s, /<title id="[^"]+">/);
    assert.doesNotMatch(s, /NaN|undefined|Infinity/);
  }
  assertWellFormed(`<root>${svgs.join("")}</root>`);
});

test("secciones requeridas presentes", () => {
  for (const id of ["resumen", "avisos", "ab", "exito", "dist", "pareto", "estab", "ittpp", "cat", "comp", "claims"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Efecto mínimo detectable/);
  assert.match(html, /ITT frente a PP/);
  assert.match(html, /Tasa de catástrofes/);
});

test("análisis: skill-a mejora, skill-b regresa; avisos y catástrofes calculados", () => {
  const a = analysis.comparisons.find((c) => c.id === "base__vs__skill-a")!;
  const b = analysis.comparisons.find((c) => c.id === "base__vs__skill-b")!;
  assert.ok(["MEJORA", "MEJORA MENOR"].includes(a.comparison.itt.overall), a.comparison.itt.overall);
  assert.equal(b.comparison.itt.overall, "PEOR-REGRESIÓN");
  const cat = Object.fromEntries(analysis.configs.map((c) => [c.configId, c.catastrophe]));
  assert.ok(cat["skill-b"]!.catastrophes > cat["skill-a"]!.catastrophes);
  assert.ok(analysis.configs.some((c) => c.onParetoFront));
  assert.ok(analysis.stability.length === 12);
  assert.ok(["siempre", "nunca", "a veces"].some((s) => analysis.stability.some((r) => r.cells["base"]!.state === s)));
  assert.ok(analysis.warnings.some((w) => /sin tokens/.test(w)), "null declarado, no 0");
});

test("aviso de baja potencia con pocos datos", () => {
  const small = analyze(makeRuns(3, 3, 2), { baselineId: "base", B: 300, powerSims: 60 });
  assert.ok(small.warnings.some((w) => /potencia/i.test(w)));
  assert.match(renderHtml(small, buildClaims(small)), /class="warn"/);
});

test("analysis.json no contiene NaN (todo null)", () => {
  const s = JSON.stringify(analysis);
  assert.doesNotMatch(s, /NaN|Infinity/);
});

test("claims reproducibles: comando, hash y valores recomputables", () => {
  assert.ok(claims.claims.length > 20);
  const h = hashRuns(runs);
  for (const c of claims.claims) {
    assert.equal(c.dataHash, h);
    assert.match(c.command, /^node bin\/agent-bench report .*--verify-claim /);
    assert.ok(c.command.includes(c.id));
    assert.doesNotMatch(c.command, /agent-bench\.ts/, "el binario real es bin/agent-bench, sin extensión");
    assert.deepEqual(resolvePath(analysis, c.path) ?? null, c.value, c.id);
  }
  assert.equal(hashRuns([...runs].reverse()), h, "hash independiente del orden");
  const v = verifyClaims([...runs].reverse(), claims, opts);
  assert.deepEqual(v.mismatches, []);
  assert.ok(v.ok);
  // determinismo byte a byte
  assert.equal(JSON.stringify(analyze(runs, opts)), JSON.stringify(analysis));
  // un cambio en los datos se detecta
  const mutated = runs.map((r, i) => (i === 0 ? { ...r, durationMs: r.durationMs + 1 } : r));
  assert.ok(!verifyClaims(mutated, claims, opts).ok);
});

test("score compuesto desactivado por defecto; activado nunca oculta regresiones", () => {
  assert.equal(analysis.composite, null);
  assert.doesNotMatch(html, /<h2 id="comp">[^<]*<\/h2><div class="card">/);
  assert.match(html, /Score compuesto desactivado/);
  const o2 = { ...opts, composite: true };
  const a2 = analyze(runs, o2);
  const h2 = renderHtml(a2, buildClaims(a2, o2));
  const e = a2.composite!.entries.find((x) => x.configId === "skill-b")!;
  assert.ok(e.regressions.length > 0);
  assert.match(h2, /Regresiones detectadas/);
  assert.match(h2, /skill-b/);
  assert.ok(a2.composite!.entries.every((x) => x.score === null || (x.score >= 0 && x.score <= 1)));
});

test("markdown para terminal", () => {
  const md = renderMarkdown(analysis);
  assert.match(md, /## Comparaciones A\/B/);
  assert.match(md, /PEOR-REGRESIÓN/);
  assert.match(md, /✓|✗|~/);
});

// ---- Cambios tras la auditoría ----
import { dedupeRuns } from "../../src/report/index.ts";

test("A9: analyze deduplica por (caso, config, repetición), avisa y registra los descartados", () => {
  const base = makeRuns(7, 12, 2);
  const retry = base.filter((r) => r.configurationId === "base" && r.repetition === 0).map((r, i) => ({
    ...r, runId: `ffffffff-0000-4000-8000-${String(i).padStart(12, "0")}`, outcome: "infra_error" as const, success: null,
    startedAt: "2020-01-01T00:00:00.000Z", finishedAt: "2020-01-01T00:00:01.000Z",
  }));
  const withDup = [...base, ...retry];
  assert.equal(dedupeRuns(withDup).discarded, retry.length);
  const a = analyze(withDup, { baselineId: "base", B: 200, powerSims: 30 });
  const b = analyze(base, { baselineId: "base", B: 200, powerSims: 30 });
  assert.equal(a.data.duplicatesDiscarded, retry.length);
  assert.equal(a.data.runs, base.length);
  assert.equal(a.data.runsRaw, withDup.length);
  assert.ok(a.warnings.some((w) => /descartados por repetición duplicada/.test(w)));
  // Los intentos viejos (anteriores) no alteran los resultados.
  assert.deepEqual(a.comparisons, b.comparisons);
  assert.deepEqual(a.configs, b.configs);
});

test("M1: el informe no cuenta duración/tokens de runs infra_error en las distribuciones", () => {
  const rs = makeRuns(7, 12, 2).map((r, i) => (i === 0 ? { ...r, outcome: "infra_error" as const, success: null, durationMs: 3 } : r));
  const cfg = analyze(rs, { baselineId: "base", B: 100, powerSims: 20 }).configs.find((c) => c.configId === rs[0]!.configurationId)!;
  assert.ok(cfg.duration.min !== 3);
});

test("A8: informe con 3 casos x 1 rep: SIN EVIDENCIA con aviso de pocos casos, nunca EQUIVALENTE", () => {
  const a = analyze(makeRuns(7, 3, 1), { baselineId: "base", B: 100, powerSims: 20 });
  for (const c of a.comparisons) {
    assert.equal(c.comparison.itt.metrics.success!.decision.veredicto, "SIN EVIDENCIA");
    assert.notEqual(c.comparison.itt.overall, "EQUIVALENTE");
    assert.ok(c.warnings.some((w) => /Pocos casos/.test(w.message)));
  }
});

test("M3: el informe describe la potencia con la regla real IC > MPE", () => {
  const a = analyze(runs, opts);
  const p = a.comparisons[0]!.power!;
  assert.equal(p.rule, "IC inferior > MPE");
  assert.equal(p.delta, 0.1);
  assert.ok(p.powerAnyEffect !== null);
});
