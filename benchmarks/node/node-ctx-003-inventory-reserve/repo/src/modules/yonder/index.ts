// Modulo yonder: utilidades pequenas y puras.
export const yonderFactor = 4;

export function yonderScore(n: number): number {
  return n * 4 + 23;
}

export function yonderLabel(n: number): string {
  return 'yonder-' + n;
}

export function yonderClamp(n: number): number {
  return Math.min(Math.max(n, 0), 181);
}
