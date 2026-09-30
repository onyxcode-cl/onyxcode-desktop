/**
 * Comprobaciones de URL de la cuenta (puras). Solo `https:`; `http:` únicamente hacia
 * `127.0.0.1:<puerto>` y solo cuando se permite (app sin empaquetar, servidor falso de pruebas).
 */

const LOCAL_HTTP = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

/** Origen del servidor de cuentas (sin ruta ni credenciales), sin barra final; o null si no vale. */
export function isAllowedAccountBase(raw: string, allowLocalHttp: boolean): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (allowLocalHttp && LOCAL_HTTP.test(trimmed)) return trimmed
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u.origin
  } catch {
    return null
  }
}

/** URL que se abre en el navegador del sistema (inicio de sesión con Google): `https:` (o loopback http de pruebas). */
export function isSafeBrowserUrl(raw: unknown, allowLocalHttp: boolean): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return false
  if (allowLocalHttp && /^http:\/\/127\.0\.0\.1:\d{1,5}\//.test(raw)) {
    try {
      new URL(raw)
      return true
    } catch {
      return false
    }
  }
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}
