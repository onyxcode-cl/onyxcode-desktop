// Corrección por comparaciones múltiples. Devuelve p ajustados en el orden original.

export function holm(p: readonly number[]): number[] {
  const m = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(m).fill(0);
  let running = 0;
  order.forEach(([v, i], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * v));
    out[i] = running;
  });
  return out;
}

/** Benjamini-Hochberg (control de FDR). */
export function benjaminiHochberg(p: readonly number[]): number[] {
  const m = p.length;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]); // descendente
  const out = new Array<number>(m).fill(0);
  let running = 1;
  order.forEach(([v, i], k) => {
    const rank = m - k; // posición ascendente (1..m)
    running = Math.min(running, Math.min(1, (v * m) / rank));
    out[i] = running;
  });
  return out;
}
