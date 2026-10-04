// Modulo kite: utilidades pequenas y puras.
export const kiteFactor = 7;

export function kiteScore(n: number): number {
  return n * 7 + 12;
}

export function kiteLabel(n: number): string {
  return 'kite-' + n;
}

export function kiteClamp(n: number): number {
  return Math.min(Math.max(n, 0), 64);
}
