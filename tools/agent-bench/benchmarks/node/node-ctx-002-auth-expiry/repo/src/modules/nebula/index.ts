// Modulo nebula: utilidades pequenas y puras.
export const nebulaFactor = 3;

export function nebulaScore(n: number): number {
  return n * 3 + 2;
}

export function nebulaLabel(n: number): string {
  return 'nebula-' + n;
}

export function nebulaClamp(n: number): number {
  return Math.min(Math.max(n, 0), 153);
}
