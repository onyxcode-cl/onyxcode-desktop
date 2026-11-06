/**
 * Sistema del equipo al que está conectada la PWA (Mac o PC), SOLO para los textos: con `win32` se usan las variantes `.win`
 * («tu PC») de `@shared/i18n`. Las capacidades siguen siendo las de la superficie `remote` (`window.api.platform` no cambia).
 * El dato llega en `app:info.hostPlatform`; un Mac de una versión anterior no lo manda y entonces nada cambia.
 */
import { getI18nPlatform, setI18nPlatform } from '@shared/i18n'
import { parseHostPlatform, type RemoteHostPlatform } from '@shared/ipc-remote'
import { REMOTE_SURFACE } from '@shared/platform-caps'

export const HOST_PLATFORM_KEY = 'lazunox.hostPlatform'

/** Último sistema visto en este celular (para pintar bien desde el primer cuadro). Sin almacenamiento o sin valor: `undefined`. */
export function readCachedHostPlatform(): RemoteHostPlatform | undefined {
  try {
    return parseHostPlatform(localStorage.getItem(HOST_PLATFORM_KEY))
  } catch {
    return undefined
  }
}

function cacheHostPlatform(p: RemoteHostPlatform | undefined): void {
  try {
    if (p) localStorage.setItem(HOST_PLATFORM_KEY, p)
    else localStorage.removeItem(HOST_PLATFORM_KEY)
  } catch {
    /* sin almacenamiento: solo se pierde el primer cuadro correcto */
  }
}

/** Fija la plataforma de los textos. Devuelve `true` si cambió (hay que volver a pintar). Sin dato, vuelve a los textos de siempre. */
export function applyHostPlatform(p: RemoteHostPlatform | undefined): boolean {
  const next = p === 'win32' ? 'win32' : REMOTE_SURFACE
  if (getI18nPlatform() === next) return false
  setI18nPlatform(next)
  return true
}

type Invoke = (channel: 'app:info') => Promise<{ ok: boolean; data?: unknown }>

/** Lee `app:info` del equipo, recuerda el sistema y lo aplica. Devuelve `true` si ya se pudo leer (con o sin campo). */
export async function syncHostPlatform(invoke: Invoke, onChanged: () => void): Promise<boolean> {
  try {
    const r = await invoke('app:info')
    if (!r.ok) return false
    const info = typeof r.data === 'object' && r.data !== null ? (r.data as { hostPlatform?: unknown }) : {}
    const p = parseHostPlatform(info.hostPlatform)
    cacheHostPlatform(p)
    if (applyHostPlatform(p)) onChanged()
    return true
  } catch {
    return false
  }
}
