// Modulo beacon: utilidades pequenas y puras.
export const beaconFactor = 7;

export function beaconScore(n: number): number {
  return n * 7 + 3;
}

export function beaconLabel(n: number): string {
  return 'beacon-' + n;
}

export function beaconClamp(n: number): number {
  return Math.min(Math.max(n, 0), 132);
}
