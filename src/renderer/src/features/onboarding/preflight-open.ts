/** Reabrir «Preparando» a pedido (Ajustes › Diagnóstico › «Instalar o activar piezas»), también tras haber elegido «Más tarde». */
export const PREFLIGHT_OPEN_EVENT = 'lazunox:preflight:open'

export function openPreflight(): void {
  window.dispatchEvent(new Event(PREFLIGHT_OPEN_EVENT))
}
