// Modulo mosaic: utilidades pequenas y puras.
export const mosaicFactor = 4;

export function mosaicScore(n: number): number {
  return n * 4 + 26;
}

export function mosaicLabel(n: number): string {
  return 'mosaic-' + n;
}

export function mosaicClamp(n: number): number {
  return Math.min(Math.max(n, 0), 155);
}
