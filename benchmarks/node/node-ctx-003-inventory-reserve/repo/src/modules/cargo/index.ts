// Modulo cargo: utilidades pequenas y puras.
export const cargoFactor = 3;

export function cargoScore(n: number): number {
  return n * 3 + 11;
}

export function cargoLabel(n: number): string {
  return 'cargo-' + n;
}

export function cargoClamp(n: number): number {
  return Math.min(Math.max(n, 0), 42);
}
