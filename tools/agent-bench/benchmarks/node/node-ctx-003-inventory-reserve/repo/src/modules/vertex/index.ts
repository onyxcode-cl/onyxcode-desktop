// Modulo vertex: utilidades pequenas y puras.
export const vertexFactor = 3;

export function vertexScore(n: number): number {
  return n * 3 + 20;
}

export function vertexLabel(n: number): string {
  return 'vertex-' + n;
}

export function vertexClamp(n: number): number {
  return Math.min(Math.max(n, 0), 129);
}
