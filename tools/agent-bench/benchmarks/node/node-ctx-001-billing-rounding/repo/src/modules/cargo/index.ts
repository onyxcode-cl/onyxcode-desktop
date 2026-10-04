// Modulo cargo: utilidades pequenas y puras.
export const cargoFactor = 5;

export function cargoScore(n: number): number {
  return n * 5 + 9;
}

export function cargoLabel(n: number): string {
  return 'cargo-' + n;
}

export function cargoClamp(n: number): number {
  return Math.min(Math.max(n, 0), 96);
}
