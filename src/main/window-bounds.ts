/**
 * Tamaño de la ventana principal ajustado al área útil de la pantalla (puro, sin Electron).
 * A 200 % en 1920×1080 el área útil es de ~960×492 DIP, menor que el `minHeight` de 560: sin ajuste el
 * compositor queda fuera de pantalla. `workArea` está en DIP (como `screen.getDisplayNearestPoint().workArea`).
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DesiredBounds {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export interface ClampedBounds extends DesiredBounds {
  x: number
  y: number
}

/** Fracción máxima del área útil que ocupa el tamaño inicial. */
export const INITIAL_FRACTION = 0.9

/** Alinea a píxeles físicos enteros (a 125 %/150 % un DIP fraccionario daría medios píxeles). */
function snap(v: number, scale: number): number {
  return Math.max(1, Math.floor(v * scale) / scale)
}

export function clampBounds(workArea: Rect, scaleFactor: number, desired: DesiredBounds): ClampedBounds {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  const minWidth = Math.floor(Math.min(desired.minWidth, workArea.width))
  const minHeight = Math.floor(Math.min(desired.minHeight, workArea.height))
  const width = Math.floor(Math.max(minWidth, Math.min(desired.width, snap(workArea.width * INITIAL_FRACTION, scale))))
  const height = Math.floor(Math.max(minHeight, Math.min(desired.height, snap(workArea.height * INITIAL_FRACTION, scale))))
  return {
    width,
    height,
    minWidth,
    minHeight,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2)
  }
}
