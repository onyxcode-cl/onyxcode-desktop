// Modulo jolt: utilidades pequenas y puras.
export const joltFactor = 6;

export function joltScore(n: number): number {
  return n * 6 + 22;
}

export function joltLabel(n: number): string {
  return 'jolt-' + n;
}

export function joltClamp(n: number): number {
  return Math.min(Math.max(n, 0), 120);
}
