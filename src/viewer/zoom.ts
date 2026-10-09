/**
 * Zoom (50–400 %, pasos fijos) compartido por los visores de documento (PDF, Word…). Módulo PURO:
 * no toca el motor de cada formato, solo calcula el próximo valor — quien llama lo aplica (p. ej.
 * `PDFViewer.currentScale` o un `transform: scale()` en CSS). `clampPage` es específico de PDF.js.
 */
export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300, 400] as const
export const ZOOM_MIN = ZOOM_STEPS[0]
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]

/** Al paso siguiente mayor que `current` (el más chico de la lista si `current` es menor que todos). */
export function zoomIn(current: number): number {
  const next = ZOOM_STEPS.find((s) => s > current)
  return next ?? ZOOM_MAX
}

/** Al paso anterior menor que `current` (el más grande de la lista si `current` es mayor que todos). */
export function zoomOut(current: number): number {
  const prev = [...ZOOM_STEPS].reverse().find((s) => s < current)
  return prev ?? ZOOM_MIN
}

/** Recorta un número de página a `[1, total]` (o 1 si `total` es 0, documento vacío). */
export function clampPage(page: number, total: number): number {
  if (total <= 0) return 1
  return Math.min(Math.max(1, Math.round(page)), total)
}

/** Porcentaje → fracción que entiende `PDFViewer.currentScale` (p. ej. 150 → 1.5). */
export function scaleOf(percent: number): number {
  return percent / 100
}
