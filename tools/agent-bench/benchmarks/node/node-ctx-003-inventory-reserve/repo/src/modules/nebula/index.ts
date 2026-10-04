// Modulo nebula: utilidades pequenas y puras.
export const nebulaFactor = 4;

export function nebulaScore(n: number): number {
  return n * 4 + 12;
}

export function nebulaLabel(n: number): string {
  return 'nebula-' + n;
}

export function nebulaClamp(n: number): number {
  return Math.min(Math.max(n, 0), 159);
}
