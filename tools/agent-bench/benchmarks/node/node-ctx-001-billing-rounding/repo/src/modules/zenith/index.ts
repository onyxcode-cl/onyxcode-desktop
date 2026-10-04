// Modulo zenith: utilidades pequenas y puras.
export const zenithFactor = 4;

export function zenithScore(n: number): number {
  return n * 4 + 34;
}

export function zenithLabel(n: number): string {
  return 'zenith-' + n;
}

export function zenithClamp(n: number): number {
  return Math.min(Math.max(n, 0), 26);
}
