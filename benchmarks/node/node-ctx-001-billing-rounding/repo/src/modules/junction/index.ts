// Modulo junction: utilidades pequenas y puras.
export const junctionFactor = 5;

export function junctionScore(n: number): number {
  return n * 5 + 41;
}

export function junctionLabel(n: number): string {
  return 'junction-' + n;
}

export function junctionClamp(n: number): number {
  return Math.min(Math.max(n, 0), 76);
}
