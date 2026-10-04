/**
 * Acceso de la interfaz móvil al enlace con el Mac (`globalThis.__onyxLink`, lo deja el arranque ligero de la PWA antes de
 * cargar la interfaz). Solo estado de conexión y las dos acciones del celular (bloquear, desvincular); toda llamada de datos
 * sigue yendo por los shims de `window.api`/`fetch`.
 */
import { useSyncExternalStore } from 'react'
import type { LinkStatus, RemoteLink } from '@shared/remote/link'

export const getLink = (): RemoteLink | undefined => (globalThis as { __onyxLink?: RemoteLink }).__onyxLink

const subscribe = (fn: () => void): (() => void) => getLink()?.onStatus(fn) ?? (() => undefined)
const snapshot = (): LinkStatus => getLink()?.status() ?? 'online'

/** Estado del canal con el Mac (reactivo). Sin enlace (pruebas, escritorio) se considera en línea. */
export function useLinkStatus(): LinkStatus {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** «Bloquear ahora»: el Mac pide el PIN otra vez. `false` si este enlace no lo soporta. */
export function lockNow(): boolean {
  const l = getLink()
  if (!l?.lock) return false
  l.lock()
  return true
}

/** «Desvincular este celular»: borra el secreto local y recarga la página. `false` si no se puede. */
export function unlinkThisDevice(): boolean {
  const l = getLink()
  if (!l?.forget) return false
  l.forget()
  return true
}

export type BannerKind = 'reconnecting' | 'offline' | 'recovered'

/**
 * Qué aviso de conexión toca según el estado anterior y el actual (un solo aviso en la interfaz): reconectando y sin conexión
 * mientras dura; «conectado de nuevo» al volver desde cualquiera de los dos. `null` = sin aviso.
 */
export function bannerFor(prev: LinkStatus, cur: LinkStatus): BannerKind | null {
  if (cur === 'reconnecting') return 'reconnecting'
  if (cur === 'offline') return 'offline'
  if (cur === 'online' && (prev === 'reconnecting' || prev === 'offline')) return 'recovered'
  return null
}
