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

/**
 * La petición del visor vive en el almacén de Tareas y no sabía de qué tarea era: al cambiar de tarea el panel seguía con el documento de la
 * anterior (pestaña en blanco con su nombre). Solo vale para la tarea que la pidió; sin dueño registrado (peticiones antiguas) vale siempre.
 */
export function viewerForTask<T extends { taskId?: string }>(req: T | null, activeTaskId: string | null): T | null {
  if (!req) return null
  return !req.taskId || req.taskId === activeTaskId ? req : null
}
