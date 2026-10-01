import { APP_NAME } from '@shared/brand'
import { localeTag, t } from '@shared/i18n'
import { isValidRepo, safeReleaseUrl, type UpdateState } from '@shared/update-check'
import { installErrorText, installPercent, type InstallPhase } from '@shared/update-install'

/** Texto del aviso de versión nueva, o null si no hay que mostrarlo. */
export function updateNoticeText(state: UpdateState | null): string | null {
  if (!state || !state.available || !state.latest) return null
  return t('notices.update.available', { app: APP_NAME, version: state.latest.version })
}

/** Texto de «no se pudo comprobar» en el idioma activo. */
export function checkFailedText(): string {
  return t('notices.update.checkFailed')
}

/** Resultado de «Buscar ahora»: `startedAt` es el instante (ms) en que se pulsó. */
export function checkResultText(state: UpdateState, startedAt: number): string {
  if (state.latest) return t('notices.update.newVersion', { version: state.latest.version })
  if (state.lastCheck !== null && state.lastCheck >= startedAt) return t('notices.update.upToDate')
  return checkFailedText()
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
  if (lastCheck === null) return t('notices.update.lastNever')
  return t('notices.update.lastCheck', { date: new Date(lastCheck).toLocaleString(localeTag()) })
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
  const laterBtn = later ? [{ id: 'later' as const, label: t('notices.update.later') }] : []
  const i = state.install
  switch (i.phase) {
    case 'downloading':
      return {
        phase: i.phase,
        text: t('notices.update.downloading', { app: APP_NAME, version: ver }),
        percent: installPercent(i),
        progress: true,
        actions: [{ id: 'cancel', label: t('common.cancel') }]
      }
    case 'verifying':
      return {
        phase: i.phase,
        text: t('notices.update.verifying'),
        percent: null,
        progress: true,
        actions: [{ id: 'cancel', label: t('common.cancel') }]
      }
    case 'ready':
      if (later && !state.available) return null
      return {
        phase: i.phase,
        text: t('notices.update.ready', { app: APP_NAME, version: ver }),
        percent: null,
        progress: false,
        actions: [{ id: 'restart', label: t('notices.update.restartNow'), primary: true }, ...laterBtn]
      }
    case 'installing':
      return { phase: i.phase, text: t('notices.update.installing'), percent: null, progress: true, actions: [] }
    case 'restarting':
      return { phase: i.phase, text: t('notices.update.restarting', { app: APP_NAME }), percent: null, progress: true, actions: [] }
    case 'error': {
      const actions: UpdateView['actions'] = []
      if (state.installable && state.latest) actions.push({ id: 'retry', label: t('common.retry'), primary: true })
      if (hasUrl) actions.push({ id: 'download-manual', label: t('notices.update.downloadManual') })
      return { phase: i.phase, text: installErrorText(i.code), percent: null, progress: false, actions: [...actions, ...laterBtn] }
    }
    default: {
      // idle | cancelled: el aviso de siempre.
      const text = updateNoticeText(state)
      if (!text) return null
      const actions: UpdateView['actions'] = state.installable
        ? [{ id: 'install', label: t('notices.update.install'), primary: true }]
        : hasUrl
          ? [{ id: 'download-manual', label: t('notices.update.download') }]
          : []
      return { phase: i.phase, text, percent: null, progress: false, actions: [...actions, ...laterBtn] }
    }
  }
}
