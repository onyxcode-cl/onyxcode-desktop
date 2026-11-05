/**
 * Pestaña del panel derecho que se muestra de verdad. La pestaña elegida (`asideTab`) es estado local de la pantalla, pero el visor
 * (`viewerRequest`) y el navegador (`browserOwner`) viven en otro sitio y pueden desaparecer sin avisar (cambio de carpeta, nueva
 * conexión): si la pestaña elegida ya no tiene contenido, el panel quedaba en negro con ninguna pestaña marcada. Aquí se vuelve a «Progreso».
 */
export type AsideTab = 'progress' | 'browser' | 'viewer'

export function effectiveAsideTab(tab: AsideTab, has: { viewer: boolean; browser: boolean }): AsideTab {
  if (tab === 'viewer' && !has.viewer) return 'progress'
  if (tab === 'browser' && !has.browser) return 'progress'
  return tab
}
