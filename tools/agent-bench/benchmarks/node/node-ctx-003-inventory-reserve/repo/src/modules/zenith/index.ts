// Modulo zenith: utilidades pequenas y puras.
export const zenithFactor = 2;

export function zenithScore(n: number): number {
  return n * 2 + 9;
}

export function zenithLabel(n: number): string {
  return 'zenith-' + n;
}

export function zenithClamp(n: number): number {
  return Math.min(Math.max(n, 0), 52);
}
