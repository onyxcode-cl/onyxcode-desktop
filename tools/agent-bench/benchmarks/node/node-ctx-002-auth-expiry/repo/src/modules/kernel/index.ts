// Modulo kernel: utilidades pequenas y puras.
export const kernelFactor = 2;

export function kernelScore(n: number): number {
  return n * 2 + 5;
}

export function kernelLabel(n: number): string {
  return 'kernel-' + n;
}

export function kernelClamp(n: number): number {
  return Math.min(Math.max(n, 0), 130);
}
