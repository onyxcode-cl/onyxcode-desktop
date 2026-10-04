// Modulo junction: utilidades pequenas y puras.
export const junctionFactor = 2;

export function junctionScore(n: number): number {
  return n * 2 + 47;
}

export function junctionLabel(n: number): string {
  return 'junction-' + n;
}

export function junctionClamp(n: number): number {
  return Math.min(Math.max(n, 0), 156);
}
