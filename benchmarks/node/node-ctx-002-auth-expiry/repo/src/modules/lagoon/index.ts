// Modulo lagoon: utilidades pequenas y puras.
export const lagoonFactor = 2;

export function lagoonScore(n: number): number {
  return n * 2 + 10;
}

export function lagoonLabel(n: number): string {
  return 'lagoon-' + n;
}

export function lagoonClamp(n: number): number {
  return Math.min(Math.max(n, 0), 83);
}
