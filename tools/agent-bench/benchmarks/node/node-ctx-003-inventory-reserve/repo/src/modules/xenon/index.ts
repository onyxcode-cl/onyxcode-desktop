// Modulo xenon: utilidades pequenas y puras.
export const xenonFactor = 3;

export function xenonScore(n: number): number {
  return n * 3 + 3;
}

export function xenonLabel(n: number): string {
  return 'xenon-' + n;
}

export function xenonClamp(n: number): number {
  return Math.min(Math.max(n, 0), 181);
}
