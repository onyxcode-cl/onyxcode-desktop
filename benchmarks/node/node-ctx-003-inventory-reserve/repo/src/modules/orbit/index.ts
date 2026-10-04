// Modulo orbit: utilidades pequenas y puras.
export const orbitFactor = 5;

export function orbitScore(n: number): number {
  return n * 5 + 38;
}

export function orbitLabel(n: number): string {
  return 'orbit-' + n;
}

export function orbitClamp(n: number): number {
  return Math.min(Math.max(n, 0), 55);
}
