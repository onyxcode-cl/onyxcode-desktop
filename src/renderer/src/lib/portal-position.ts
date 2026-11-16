type Side = 'top' | 'bottom'

/** Alto natural del panel con borde de 1px y una lista que puede encogerse; ignora la escala de la animación. */
export function portalContentHeight(panel: HTMLElement, scrolling: HTMLElement | null, limit = Infinity): number {
  return Array.from(panel.children).reduce(
    (sum, child) => sum + (child === scrolling ? Math.min(scrolling.scrollHeight, limit) : (child as HTMLElement).offsetHeight),
    2
  )
}

/** Posición fija dentro de la ventana. La preferencia solo manda cuando cabe el contenido. */
export function portalPosition({
  anchor,
  viewportWidth,
  viewportHeight,
  height,
  width,
  placement,
  topInset = 0,
  gap = 4,
  align = 'end'
}: {
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>
  viewportWidth: number
  viewportHeight: number
  height: number
  width: number
  placement: Side
  topInset?: number
  gap?: number
  align?: 'start' | 'end'
}): { side: Side; top?: number; bottom?: number; left: number; width: number; maxHeight: number } {
  const margin = 8
  const minY = topInset + margin
  const maxY = Math.max(minY, viewportHeight - margin)
  const aboveEnd = Math.max(minY, Math.min(maxY, anchor.top - gap))
  const belowStart = Math.max(minY, Math.min(maxY, anchor.bottom + gap))
  const above = aboveEnd - minY
  const below = maxY - belowStart
  const preferredSpace = placement === 'top' ? above : below
  const side = preferredSpace >= height ? placement : above > below ? 'top' : 'bottom'
  const fittedWidth = Math.max(0, Math.min(width, viewportWidth - 2 * margin))
  return {
    side,
    ...(side === 'top' ? { bottom: viewportHeight - aboveEnd } : { top: belowStart }),
    left: Math.max(margin, Math.min(align === 'start' ? anchor.left : anchor.right - fittedWidth, viewportWidth - margin - fittedWidth)),
    width: fittedWidth,
    maxHeight: side === 'top' ? above : below
  }
}
