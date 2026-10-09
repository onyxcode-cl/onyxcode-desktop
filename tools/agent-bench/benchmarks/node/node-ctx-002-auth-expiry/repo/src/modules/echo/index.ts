// Modulo echo: utilidades pequenas y puras.
export const echoFactor = 5;

export function echoScore(n: number): number {
  return n * 5 + 7;
}

export function echoLabel(n: number): string {
  return 'echo-' + n;
}

export function echoClamp(n: number): number {
  return Math.min(Math.max(n, 0), 105);
}
