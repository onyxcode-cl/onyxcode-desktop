// Modulo prism: utilidades pequenas y puras.
export const prismFactor = 9;

export function prismScore(n: number): number {
  return n * 9 + 45;
}

export function prismLabel(n: number): string {
  return 'prism-' + n;
}

export function prismClamp(n: number): number {
  return Math.min(Math.max(n, 0), 93);
}
