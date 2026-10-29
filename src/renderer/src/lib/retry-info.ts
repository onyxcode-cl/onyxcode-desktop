import { create } from 'zustand'
import { friendlyError, redactSecrets } from '@shared/ai-errors'
import { useT } from './i18n'

/**
 * Por qué el motor está reintentando una respuesta. El estado de la sesión solo guarda «retry»; el motivo (p. ej. «se acabó el uso
 * gratuito del modelo») viaja en el evento `session.status` y antes se tiraba, dejando a la persona mirando «reintentando…» sin explicación.
 */
export type RetryKind = 'free' | 'auth' | 'network' | 'quota' | 'unavailable' | 'other'

export interface RetryInfo {
  /** Mensaje del proveedor, de una línea, sin claves y recortado (nunca el cuerpo crudo de la respuesta). */
  message: string
  /** Se acabó el uso gratuito del modelo (el motor lo marca con `action.reason === 'free_tier_limit'` o lo dice el mensaje). */
  free: boolean
  /** Causa probable, para decir qué hacer sin depender del proveedor concreto. */
  kind: RetryKind
  /** Número de intento que informa el motor (1 = primer reintento); `undefined` si no lo dice. */
  attempt?: number
}

export const useRetryInfo = create<{ bySession: Record<string, RetryInfo | undefined> }>(() => ({ bySession: {} }))

interface StatusEventLike {
  type?: string
  properties?: {
    sessionID?: string
    status?: { type?: string; message?: unknown; attempt?: unknown; action?: { reason?: unknown } }
  }
}

const FREE_RE = /free\s*usage\s*limit|FreeUsageLimit|free.{0,20}(usage|tier|quota).{0,30}(limit|exceed|reach|exhaust)/i

/** Causa probable del reintento, por la señal del motor y, si no, por el texto (sin depender del proveedor). */
export function classifyRetry(message: string, reason?: unknown): RetryKind {
  if (reason === 'free_tier_limit' || FREE_RE.test(message)) return 'free'
  if (!message) return 'other'
  const kind = friendlyError(new Error(message)).kind
  return kind === 'auth' || kind === 'network' || kind === 'quota' || kind === 'unavailable' ? kind : 'other'
}

/** Una línea, sin claves y recortada: el mensaje del proveedor puede traer ruido o datos que no deben mostrarse enteros. */
function cleanMessage(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return redactSecrets(raw).replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** Anota (o borra) el motivo del reintento según un evento `session.status`. Barato: ignora todo lo demás. */
export function noteRetryStatus(ev: StatusEventLike): void {
  const type = ev?.type
  if (type !== 'session.status' && type !== 'session.idle' && type !== 'session.error') return
  const sessionID = ev.properties?.sessionID
  if (!sessionID) return
  const cur = useRetryInfo.getState().bySession
  const status = type === 'session.status' ? ev.properties?.status : undefined
  if (type === 'session.status' && !status) return
  if (status?.type === 'retry') {
    const message = cleanMessage(status.message)
    const kind = classifyRetry(message, status.action?.reason)
    const free = kind === 'free'
    const attempt = typeof status.attempt === 'number' && status.attempt > 0 ? Math.floor(status.attempt) : undefined
    const prev = cur[sessionID]
    if (prev && prev.message === message && prev.free === free && prev.kind === kind && prev.attempt === attempt) return
    useRetryInfo.setState({ bySession: { ...cur, [sessionID]: { message, free, kind, ...(attempt !== undefined ? { attempt } : {}) } } })
  } else if (cur[sessionID]) {
    const { [sessionID]: _gone, ...rest } = cur
    void _gone
    useRetryInfo.setState({ bySession: rest })
  }
}

/** Claves de texto por causa (explícitas para que el tipo `Messages` las compruebe). */
const LABEL_KEY = {
  free: 'chat.msg.retryFree',
  auth: 'chat.msg.retryAuth',
  network: 'chat.msg.retryNetwork',
  quota: 'chat.msg.retryQuota',
  unavailable: 'chat.msg.retryUnavailable'
} as const

/** Texto para el indicador mientras el motor reintenta; `undefined` si no hay motivo conocido (se usa el genérico). */
export function useRetryLabel(sessionID: string | null | undefined): string | undefined {
  const t = useT()
  const info = useRetryInfo((s) => (sessionID ? s.bySession[sessionID] : undefined))
  if (!info) return undefined
  const base =
    info.kind !== 'other' ? t(LABEL_KEY[info.kind]) : info.message ? t('chat.msg.retryWhy', { message: info.message }) : undefined
  if (!base) return undefined
  return info.attempt && info.attempt > 1 ? `${base} ${t('chat.msg.retryAttemptN', { attempt: info.attempt })}` : base
}
