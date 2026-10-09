// Modulo ember: utilidades pequenas y puras.
export const emberFactor = 7;

export function emberScore(n: number): number {
  return n * 7 + 35;
}

export function emberLabel(n: number): string {
  return 'ember-' + n;
}

export function emberClamp(n: number): number {
  return Math.min(Math.max(n, 0), 51);
}
