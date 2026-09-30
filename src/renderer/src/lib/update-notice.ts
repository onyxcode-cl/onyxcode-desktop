import { APP_NAME } from '@shared/brand'
import { isValidRepo, safeReleaseUrl, type UpdateState } from '@shared/update-check'
import { installErrorText, installPercent, type InstallPhase } from '@shared/update-install'

/** Texto del aviso de versión nueva, o null si no hay que mostrarlo. */
export function updateNoticeText(state: UpdateState | null): string | null {
  if (!state || !state.available || !state.latest) return null
  return `Hay una versión nueva de ${APP_NAME} (${state.latest.version}).`
}

export const CHECK_FAILED_TEXT = 'No se pudo comprobar ahora. Inténtalo más tarde.'

/** Resultado de «Buscar ahora»: `startedAt` es el instante (ms) en que se pulsó. */
export function checkResultText(state: UpdateState, startedAt: number): string {
  if (state.latest) return `Hay una versión nueva: ${state.latest.version}`
  if (state.lastCheck !== null && state.lastCheck >= startedAt) return 'Tienes la última versión.'
  return CHECK_FAILED_TEXT
}

/** Devuelve la URL solo si es una página de releases de github.com (defensa en profundidad en el renderer). */
export function downloadUrl(state: UpdateState | null): string | null {
  const url = state?.latest?.url
  if (!state?.latest || !url) return null
  const repo = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\//.exec(url)?.[1]
  if (!repo || !isValidRepo(repo)) return null
  return safeReleaseUrl(url, repo, `v${state.latest.version}`) === url ? url : null
}

export function lastCheckText(lastCheck: number | null): string {
  if (lastCheck === null) return 'Última comprobación: todavía no.'
  return `Última comprobación: ${new Date(lastCheck).toLocaleString('es')}`
}

export type UpdateActionId = 'install' | 'cancel' | 'restart' | 'retry' | 'download-manual' | 'later'

export interface UpdateView {
  phase: InstallPhase
  text: string
  /** 0..100 mientras se descarga; null = sin porcentaje conocido. */
  percent: number | null
  /** Barra de progreso visible (descargando, verificando, instalando). */
  progress: boolean
  actions: { id: UpdateActionId; label: string; primary?: boolean }[]
}

/**
 * Qué mostrar (texto, progreso y botones) según el estado del aviso y de la instalación. `null` = nada.
 * Con `installable=false` la interfaz es la de siempre: «Descargar» / «Más tarde».
 */
export function updateView(state: UpdateState | null, o: { later?: boolean } = {}): UpdateView | null {
  if (!state) return null
  const later = o.later ?? true
  const ver = state.install.version ?? state.latest?.version ?? ''
  const hasUrl = downloadUrl(state) !== null
  const laterBtn = later ? [{ id: 'later' as const, label: 'Más tarde' }] : []
  const i = state.install
  switch (i.phase) {
    case 'downloading':
      return {
        phase: i.phase,
        text: `Descargando ${APP_NAME} ${ver}…`,
        percent: installPercent(i),
        progress: true,
        actions: [{ id: 'cancel', label: 'Cancelar' }]
      }
    case 'verifying':
      return {
        phase: i.phase,
        text: 'Verificando la descarga…',
        percent: null,
        progress: true,
        actions: [{ id: 'cancel', label: 'Cancelar' }]
      }
    case 'ready':
      if (later && !state.available) return null
      return {
        phase: i.phase,
        text: `${APP_NAME} ${ver} está lista: reinicia para terminar de actualizar.`,
        percent: null,
        progress: false,
        actions: [{ id: 'restart', label: 'Reiniciar ahora', primary: true }, ...laterBtn]
      }
    case 'installing':
      return { phase: i.phase, text: 'Instalando la actualización…', percent: null, progress: true, actions: [] }
    case 'restarting':
      return { phase: i.phase, text: `Reiniciando ${APP_NAME}…`, percent: null, progress: true, actions: [] }
    case 'error': {
      const actions: UpdateView['actions'] = []
      if (state.installable && state.latest) actions.push({ id: 'retry', label: 'Reintentar', primary: true })
      if (hasUrl) actions.push({ id: 'download-manual', label: 'Descargar manualmente' })
      return { phase: i.phase, text: installErrorText(i.code), percent: null, progress: false, actions: [...actions, ...laterBtn] }
    }
    default: {
      // idle | cancelled: el aviso de siempre.
      const text = updateNoticeText(state)
      if (!text) return null
      const actions: UpdateView['actions'] = state.installable
        ? [{ id: 'install', label: 'Actualizar', primary: true }]
        : hasUrl
          ? [{ id: 'download-manual', label: 'Descargar' }]
          : []
      return { phase: i.phase, text, percent: null, progress: false, actions: [...actions, ...laterBtn] }
    }
  }
}
