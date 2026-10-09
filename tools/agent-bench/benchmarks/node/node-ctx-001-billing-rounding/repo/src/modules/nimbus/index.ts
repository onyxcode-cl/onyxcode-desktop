// Modulo nimbus: utilidades pequenas y puras.
export const nimbusFactor = 3;

export function nimbusScore(n: number): number {
  return n * 3 + 20;
}

export function nimbusLabel(n: number): string {
  return 'nimbus-' + n;
}

export function nimbusClamp(n: number): number {
  return Math.min(Math.max(n, 0), 156);
}
