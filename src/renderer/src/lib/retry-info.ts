import { create } from 'zustand'
import { useT } from './i18n'

/**
 * Por qué el motor está reintentando una respuesta. El estado de la sesión solo guarda «retry»; el motivo (p. ej. «se acabó el uso
 * gratuito del modelo») viaja en el evento `session.status` y antes se tiraba, dejando a la persona mirando «reintentando…» sin explicación.
 */
export interface RetryInfo {
  message: string
  /** Se acabó el uso gratuito del modelo (el motor lo marca con `action.reason === 'free_tier_limit'`). */
  free: boolean
}

export const useRetryInfo = create<{ bySession: Record<string, RetryInfo | undefined> }>(() => ({ bySession: {} }))

interface StatusEventLike {
  type?: string
  properties?: { sessionID?: string; status?: { type?: string; message?: unknown; action?: { reason?: unknown } } }
}

/** Anota (o borra) el motivo del reintento según un evento `session.status`. Barato: ignora todo lo demás. */
export function noteRetryStatus(ev: StatusEventLike): void {
  if (ev?.type !== 'session.status') return
  const sessionID = ev.properties?.sessionID
  const status = ev.properties?.status
  if (!sessionID || !status) return
  const cur = useRetryInfo.getState().bySession
  if (status.type === 'retry') {
    const message = typeof status.message === 'string' ? status.message.slice(0, 300) : ''
    const free = status.action?.reason === 'free_tier_limit'
    const prev = cur[sessionID]
    if (prev && prev.message === message && prev.free === free) return
    useRetryInfo.setState({ bySession: { ...cur, [sessionID]: { message, free } } })
  } else if (cur[sessionID]) {
    const { [sessionID]: _gone, ...rest } = cur
    void _gone
    useRetryInfo.setState({ bySession: rest })
  }
}

/** Texto para el indicador mientras el motor reintenta; `undefined` si no hay motivo conocido (se usa el genérico). */
export function useRetryLabel(sessionID: string | null | undefined): string | undefined {
  const t = useT()
  const info = useRetryInfo((s) => (sessionID ? s.bySession[sessionID] : undefined))
  if (!info) return undefined
  if (info.free) return t('chat.msg.retryFree')
  return info.message ? t('chat.msg.retryWhy', { message: info.message }) : undefined
}
