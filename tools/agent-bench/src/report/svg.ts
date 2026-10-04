// Gráficos SVG hechos a mano, sin dependencias ni recursos externos. Colores vía clases CSS (tema claro/oscuro).
import type { ConfigReport, Dist, StabilityRow } from "./types.ts";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const f = (n: number) => (Math.round(n * 100) / 100).toString();
const pct = (x: number) => `${(x * 100).toFixed(0)} %`;
const LABEL_W = 150;

function open(id: string, w: number, h: number, title: string, desc: string): string {
  return `<svg id="${id}" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-labelledby="${id}-t ${id}-d" preserveAspectRatio="xMinYMin meet"><title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(desc)}</desc>`;
}
const cls = (i: number) => `s${i % 6}`;

/** Barras de tasa de éxito con IC de Wilson (ITT). */
export function successBars(configs: ConfigReport[]): string {
  const rowH = 30, top = 24, w = 640, plotW = w - LABEL_W - 70, h = top + configs.length * rowH + 28;
  const x = (p: number) => LABEL_W + p * plotW;
  const desc = configs.map((c) => `${c.configId}: ${pct(c.itt.rate)} (IC ${pct(c.itt.wilson.lo)} a ${pct(c.itt.wilson.hi)})`).join("; ");
  let s = open("svg-success", w, h, "Tasa de éxito con intervalo de Wilson", desc);
  for (let t = 0; t <= 4; t++) {
    const p = t / 4;
    s += `<line class="grid" x1="${f(x(p))}" y1="${top - 6}" x2="${f(x(p))}" y2="${h - 24}"/><text class="tick" x="${f(x(p))}" y="${h - 8}" text-anchor="middle">${pct(p)}</text>`;
  }
  configs.forEach((c, i) => {
    const y = top + i * rowH;
    const r = c.itt.rate, lo = c.itt.wilson.lo, hi = c.itt.wilson.hi;
    s += `<text class="lbl" x="${LABEL_W - 8}" y="${y + 15}" text-anchor="end">${esc(c.label)}</text>`;
    if (Number.isFinite(r)) {
      s += `<rect class="${cls(i)} fill" x="${f(x(0))}" y="${y + 4}" width="${f(Math.max(0, r * plotW))}" height="16"><title>${esc(c.configId)}: ${pct(r)}</title></rect>`;
      s += `<line class="whisk" x1="${f(x(lo))}" y1="${y + 12}" x2="${f(x(hi))}" y2="${y + 12}"/><line class="whisk" x1="${f(x(lo))}" y1="${y + 6}" x2="${f(x(lo))}" y2="${y + 18}"/><line class="whisk" x1="${f(x(hi))}" y1="${y + 6}" x2="${f(x(hi))}" y2="${y + 18}"/>`;
      s += `<text class="val" x="${f(x(Math.max(hi, r)) + 6)}" y="${y + 16}">${pct(r)}</text>`;
    } else s += `<text class="val" x="${f(x(0) + 4)}" y="${y + 16}">sin datos</text>`;
  });
  return s + "</svg>";
}

/** Cajas en escala log (Q1-Q3, mediana, rango min-max). */
export function logBoxes(id: string, title: string, unit: string, configs: ConfigReport[], pick: (c: ConfigReport) => Dist): string {
  const ds = configs.map((c) => ({ c, d: pick(c) }));
  const vals = ds.flatMap(({ d }) => (d.min !== null && d.max !== null ? [d.min, d.max] : []));
  const rowH = 30, top = 24, w = 640, plotW = w - LABEL_W - 40, h = top + configs.length * rowH + 30;
  if (!vals.length) return open(id, w, 60, title, "sin datos") + `<text class="val" x="10" y="30">sin datos (null)</text></svg>`;
  let lo = Math.floor(Math.log10(Math.min(...vals))), hi = Math.ceil(Math.log10(Math.max(...vals)));
  if (hi === lo) hi = lo + 1;
  const x = (v: number) => LABEL_W + ((Math.log10(v) - lo) / (hi - lo)) * plotW;
  const desc = ds.map(({ c, d }) => `${c.configId}: mediana ${d.median === null ? "sin datos" : Math.round(d.median)} ${unit}`).join("; ");
  let s = open(id, w, h, `${title} (escala logarítmica)`, desc);
  for (let e = lo; e <= hi; e++) {
    const px = LABEL_W + ((e - lo) / (hi - lo)) * plotW;
    s += `<line class="grid" x1="${f(px)}" y1="${top - 6}" x2="${f(px)}" y2="${h - 26}"/><text class="tick" x="${f(px)}" y="${h - 10}" text-anchor="middle">1e${e}</text>`;
  }
  s += `<text class="tick" x="${w - 4}" y="${h - 10}" text-anchor="end">${esc(unit)}</text>`;
  ds.forEach(({ c, d }, i) => {
    const y = top + i * rowH;
    s += `<text class="lbl" x="${LABEL_W - 8}" y="${y + 15}" text-anchor="end">${esc(c.label)}</text>`;
    if (d.min === null || d.q1 === null || d.q3 === null || d.median === null || d.max === null) {
      s += `<text class="val" x="${LABEL_W + 4}" y="${y + 16}">sin datos (null)</text>`;
      return;
    }
    s += `<line class="whisk" x1="${f(x(d.min))}" y1="${y + 12}" x2="${f(x(d.max))}" y2="${y + 12}"/>`;
    s += `<rect class="${cls(i)} fillsoft" x="${f(x(d.q1))}" y="${y + 3}" width="${f(Math.max(1, x(d.q3) - x(d.q1)))}" height="18"><title>${esc(c.configId)} Q1-Q3 ${Math.round(d.q1)}-${Math.round(d.q3)} ${esc(unit)}</title></rect>`;
    s += `<line class="med" x1="${f(x(d.median))}" y1="${y + 1}" x2="${f(x(d.median))}" y2="${y + 23}"/>`;
  });
  return s + "</svg>";
}

/** Frente de Pareto calidad (éxito ITT) vs coste. Relleno = en el frente; hueco = dominado. */
export function paretoChart(configs: ConfigReport[], costLabel: string): string {
  const useUsd = configs.every((c) => c.costUsdMean !== null);
  const pts = configs.map((c, i) => ({ c, i, cost: useUsd ? c.costUsdMean : Number.isFinite(c.itt.tokens.geoMean) ? c.itt.tokens.geoMean : null }));
  const ok = pts.filter((p) => p.cost !== null && Number.isFinite(p.c.itt.rate));
  const w = 640, h = 320, L = 56, R = 120, T = 20, B = 44;
  if (!ok.length) return open("svg-pareto", w, 60, "Frente de Pareto", "sin datos") + `<text class="val" x="10" y="30">sin datos de coste (null)</text></svg>`;
  const cmin = Math.min(...ok.map((p) => p.cost!)), cmax = Math.max(...ok.map((p) => p.cost!));
  const span = cmax - cmin || cmax || 1;
  const x = (c: number) => L + ((c - cmin + span * 0.1) / (span * 1.2)) * (w - L - R);
  const y = (r: number) => T + (1 - r) * (h - T - B);
  const desc = ok.map((p) => `${p.c.configId}: éxito ${pct(p.c.itt.rate)}, coste ${f(p.cost!)}${p.c.onParetoFront ? ", en el frente" : ", dominado"}`).join("; ");
  let s = open("svg-pareto", w, h, "Frente de Pareto calidad-coste", desc);
  for (let t = 0; t <= 4; t++) s += `<line class="grid" x1="${L}" y1="${f(y(t / 4))}" x2="${w - R}" y2="${f(y(t / 4))}"/><text class="tick" x="${L - 6}" y="${f(y(t / 4) + 4)}" text-anchor="end">${pct(t / 4)}</text>`;
  s += `<text class="tick" x="${(L + w - R) / 2}" y="${h - 6}" text-anchor="middle">${esc(costLabel)} (menos es mejor)</text>`;
  s += `<text class="tick" x="12" y="${T + 6}">éxito</text>`;
  const front = ok.filter((p) => p.c.onParetoFront).sort((a, b) => a.cost! - b.cost!);
  if (front.length > 1) s += `<polyline class="front" fill="none" points="${front.map((p) => `${f(x(p.cost!))},${f(y(p.c.itt.rate))}`).join(" ")}"/>`;
  for (const p of ok) {
    const cx = f(x(p.cost!)), cy = f(y(p.c.itt.rate));
    s += `<circle class="${cls(p.i)} ${p.c.onParetoFront ? "fill" : "hollow"}" cx="${cx}" cy="${cy}" r="7"><title>${esc(p.c.configId)}: éxito ${pct(p.c.itt.rate)}, coste ${f(p.cost!)}${p.c.onParetoFront ? " (frente)" : " (dominado)"}</title></circle>`;
    s += `<text class="lbl" x="${f(x(p.cost!) + 11)}" y="${f(y(p.c.itt.rate) + 4)}">${esc(p.c.label)}</text>`;
  }
  return s + "</svg>";
}

const GLYPH = { siempre: "✓", nunca: "✗", "a veces": "~", "sin datos": "?" } as const;

/** Mapa de estabilidad: por caso y configuración, siempre / nunca / a veces. */
export function stabilityMap(rows: StabilityRow[], configIds: string[]): string {
  const cw = 78, rh = 22, lw = 190, top = 40, w = lw + configIds.length * cw + 10, h = top + rows.length * rh + 10;
  const desc = `${rows.length} casos por ${configIds.length} configuraciones; ✓ siempre, ✗ nunca, ~ a veces.`;
  let s = open("svg-stability", w, h, "Mapa de estabilidad por caso", desc);
  configIds.forEach((id, j) => { s += `<text class="lbl" x="${lw + j * cw + cw / 2}" y="${top - 10}" text-anchor="middle">${esc(id.length > 11 ? id.slice(0, 10) + "…" : id)}</text>`; });
  rows.forEach((r, i) => {
    const y = top + i * rh;
    s += `<text class="lbl" x="${lw - 8}" y="${y + 15}" text-anchor="end">${esc(r.caseId.length > 26 ? r.caseId.slice(0, 25) + "…" : r.caseId)}</text>`;
    configIds.forEach((id, j) => {
      const c = r.cells[id] ?? { state: "sin datos" as const, successes: 0, runs: 0 };
      const k = c.state.replace(" ", "");
      s += `<rect class="cell ${k}" x="${lw + j * cw + 2}" y="${y + 1}" width="${cw - 4}" height="${rh - 2}" rx="3"><title>${esc(r.caseId)} / ${esc(id)}: ${c.state} (${c.successes}/${c.runs})</title></rect>`;
      s += `<text class="cellt" x="${lw + j * cw + cw / 2}" y="${y + 15}" text-anchor="middle">${GLYPH[c.state]} ${c.successes}/${c.runs}</text>`;
    });
  });
  return s + "</svg>";
}
