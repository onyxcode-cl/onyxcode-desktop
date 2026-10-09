// Modulo lagoon: utilidades pequenas y puras.
export const lagoonFactor = 4;

export function lagoonScore(n: number): number {
  return n * 4 + 36;
}

export function lagoonLabel(n: number): string {
  return 'lagoon-' + n;
}

export function lagoonClamp(n: number): number {
  return Math.min(Math.max(n, 0), 66);
}
