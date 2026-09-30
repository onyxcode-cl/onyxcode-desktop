import { APP_NAME } from '@shared/brand'
import { isValidRepo, safeReleaseUrl, type UpdateState } from '@shared/update-check'

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
