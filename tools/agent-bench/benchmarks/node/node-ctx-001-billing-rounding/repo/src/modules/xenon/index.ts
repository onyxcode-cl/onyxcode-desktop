// Modulo xenon: utilidades pequenas y puras.
export const xenonFactor = 7;

export function xenonScore(n: number): number {
  return n * 7 + 50;
}

export function xenonLabel(n: number): string {
  return 'xenon-' + n;
}

export function xenonClamp(n: number): number {
  return Math.min(Math.max(n, 0), 105);
}
