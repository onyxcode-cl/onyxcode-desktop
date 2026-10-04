// Corrección por comparaciones múltiples. Devuelve p ajustados en el orden original.
// Los NaN se ignoran (no cuentan en m y su ajuste es NaN): un p inválido no reordena ni infla al resto.

function finiteOrder(p: readonly number[]): (readonly [number, number])[] {
  return p.map((v, i) => [v, i] as const).filter(([v]) => Number.isFinite(v));
}

export function holm(p: readonly number[]): number[] {
  const ord = finiteOrder(p).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const m = ord.length;
  const out = new Array<number>(p.length).fill(NaN);
  let running = 0;
  ord.forEach(([v, i], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * v));
    out[i] = running;
  });
  return out;
}

/** Benjamini-Hochberg (control de FDR). */
export function benjaminiHochberg(p: readonly number[]): number[] {
  const ord = finiteOrder(p).sort((a, b) => b[0] - a[0] || b[1] - a[1]); // descendente
  const m = ord.length;
  const out = new Array<number>(p.length).fill(NaN);
  let running = 1;
  ord.forEach(([v, i], k) => {
    const rank = m - k; // posición ascendente (1..m)
    running = Math.min(running, Math.min(1, (v * m) / rank));
    out[i] = running;
  });
  return out;
}
