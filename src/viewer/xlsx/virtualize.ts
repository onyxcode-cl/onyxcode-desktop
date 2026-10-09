/**
 * Virtualización vertical de la grilla (Fase 3 del plan del visor): con filas de alto variable
 * (`rowHeightsPx`), calcula qué rango de filas hay que pintar para un `scrollTop`/alto de viewport
 * dados, más un margen (`overscan`) para que no se vea un parpadeo al hacer scroll rápido. Módulo
 * PURO, sin React ni DOM: así se puede probar con 100k filas sin levantar nada.
 */
export interface VisibleRange {
  /** Primera fila a pintar (inclusive). */
  start: number
  /** Última fila a pintar (exclusive). */
  end: number
  /** Alto acumulado de todas las filas antes de `start`, en px (para posicionar el bloque pintado). */
  offsetY: number
  /** Alto total de la grilla, en px (para que el contenedor de scroll tenga el tamaño correcto). */
  totalHeight: number
}

/** Offsets acumulados (prefijo), `offsets[i]` = alto de las filas `[0, i)`. `offsets[rowHeightsPx.length]` = total. */
export function cumulativeOffsets(rowHeightsPx: number[]): number[] {
  const offsets = new Array<number>(rowHeightsPx.length + 1)
  offsets[0] = 0
  for (let i = 0; i < rowHeightsPx.length; i++) offsets[i + 1] = offsets[i] + rowHeightsPx[i]
  return offsets
}

/** Primer índice `i` con `offsets[i] > y` menos uno (búsqueda binaria: O(log filas), no O(filas)). */
function rowAtOffset(offsets: number[], y: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function visibleRowRange(scrollTop: number, viewportHeightPx: number, rowHeightsPx: number[], overscan = 4): VisibleRange {
  const offsets = cumulativeOffsets(rowHeightsPx)
  const totalHeight = offsets[offsets.length - 1]
  const n = rowHeightsPx.length
  if (n === 0) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 }

  const top = Math.max(0, scrollTop)
  const bottom = top + Math.max(0, viewportHeightPx)
  const firstVisible = rowAtOffset(offsets, top)
  const lastVisible = Math.min(n - 1, rowAtOffset(offsets, Math.max(top, bottom - 1)))

  const start = Math.max(0, firstVisible - overscan)
  const end = Math.min(n, lastVisible + 1 + overscan)
  return { start, end, offsetY: offsets[start], totalHeight }
}
