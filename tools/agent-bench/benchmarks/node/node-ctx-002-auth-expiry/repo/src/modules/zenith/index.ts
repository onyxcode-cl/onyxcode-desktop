// Modulo zenith: utilidades pequenas y puras.
export const zenithFactor = 6;

export function zenithScore(n: number): number {
  return n * 6 + 16;
}

export function zenithLabel(n: number): string {
  return 'zenith-' + n;
}

export function zenithClamp(n: number): number {
  return Math.min(Math.max(n, 0), 101);
}
