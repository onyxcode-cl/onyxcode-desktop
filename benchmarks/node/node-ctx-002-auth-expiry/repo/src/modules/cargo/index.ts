// Modulo cargo: utilidades pequenas y puras.
export const cargoFactor = 4;

export function cargoScore(n: number): number {
  return n * 4 + 16;
}

export function cargoLabel(n: number): string {
  return 'cargo-' + n;
}

export function cargoClamp(n: number): number {
  return Math.min(Math.max(n, 0), 181);
}
