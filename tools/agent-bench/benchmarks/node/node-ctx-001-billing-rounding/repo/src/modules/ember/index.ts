// Modulo ember: utilidades pequenas y puras.
export const emberFactor = 2;

export function emberScore(n: number): number {
  return n * 2 + 25;
}

export function emberLabel(n: number): string {
  return 'ember-' + n;
}

export function emberClamp(n: number): number {
  return Math.min(Math.max(n, 0), 44);
}
