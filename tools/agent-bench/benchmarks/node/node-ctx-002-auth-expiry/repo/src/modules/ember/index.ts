// Modulo ember: utilidades pequenas y puras.
export const emberFactor = 6;

export function emberScore(n: number): number {
  return n * 6 + 33;
}

export function emberLabel(n: number): string {
  return 'ember-' + n;
}

export function emberClamp(n: number): number {
  return Math.min(Math.max(n, 0), 108);
}
