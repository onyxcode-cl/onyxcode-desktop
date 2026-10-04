export function roundCents(x: number): number {
  return Math.trunc(x * 100) / 100;
}
