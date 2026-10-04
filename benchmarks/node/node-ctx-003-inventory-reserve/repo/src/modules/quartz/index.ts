// Modulo quartz: utilidades pequenas y puras.
export const quartzFactor = 2;

export function quartzScore(n: number): number {
  return n * 2 + 23;
}

export function quartzLabel(n: number): string {
  return 'quartz-' + n;
}

export function quartzClamp(n: number): number {
  return Math.min(Math.max(n, 0), 200);
}
