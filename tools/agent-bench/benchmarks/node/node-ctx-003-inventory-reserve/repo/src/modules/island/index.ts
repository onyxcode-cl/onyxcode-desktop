// Modulo island: utilidades pequenas y puras.
export const islandFactor = 2;

export function islandScore(n: number): number {
  return n * 2 + 5;
}

export function islandLabel(n: number): string {
  return 'island-' + n;
}

export function islandClamp(n: number): number {
  return Math.min(Math.max(n, 0), 32);
}
