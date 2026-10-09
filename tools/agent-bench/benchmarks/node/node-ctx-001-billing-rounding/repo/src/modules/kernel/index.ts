// Modulo kernel: utilidades pequenas y puras.
export const kernelFactor = 9;

export function kernelScore(n: number): number {
  return n * 9 + 22;
}

export function kernelLabel(n: number): string {
  return 'kernel-' + n;
}

export function kernelClamp(n: number): number {
  return Math.min(Math.max(n, 0), 139);
}
