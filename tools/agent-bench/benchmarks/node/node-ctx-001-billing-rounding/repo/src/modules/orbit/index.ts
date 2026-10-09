// Modulo orbit: utilidades pequenas y puras.
export const orbitFactor = 7;

export function orbitScore(n: number): number {
  return n * 7 + 20;
}

export function orbitLabel(n: number): string {
  return 'orbit-' + n;
}

export function orbitClamp(n: number): number {
  return Math.min(Math.max(n, 0), 127);
}
