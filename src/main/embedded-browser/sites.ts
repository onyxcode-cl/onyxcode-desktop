/**
 * Utilidades puras del navegador integrado: heurística de sitio (eTLD+1), host de una URL y
 * validación de esquema de una URL antes de navegar.
 *
 * No es una lista de sufijos públicos real (la PSL cambia y no vale la pena empaquetarla para
 * esto): es la heurística que pide el plan, pensada solo para agrupar `www.ejemplo.com` y
 * `mail.ejemplo.com` bajo el mismo sitio y para separar dominios de segundo nivel tipo
 * `ejemplo.co.uk`. No es exacta para todos los TLD del mundo; es intencionalmente conservadora.
 */

import { hostOf } from '../util/url'

/** Etiquetas de segundo nivel bajo las que casi siempre hay un tercer nivel "real" (co.uk, com.mx…). */
const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'org', 'net', 'gob', 'gov', 'edu', 'ac'])

/** Sitio (eTLD+1 heurístico) de un host: `www.bbc.co.uk` → `bbc.co.uk`, `mail.google.com` → `google.com`. */
export function siteOf(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  // IPs literales (v4, o v6 con `:`/`[`): no hay eTLD+1; `93.184.216.34` y `1.2.216.34` no comparten sitio.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.includes('[')) return h
  const labels = h.split('.').filter(Boolean)
  if (labels.length <= 2) return h
  const secondLast = labels[labels.length - 2]
  const last = labels[labels.length - 1]
  if (SECOND_LEVEL_LABELS.has(secondLast) && last.length === 2) return labels.slice(-3).join('.')
  return labels.slice(-2).join('.')
}

/**
 * true si la URL tiene un esquema que el navegador propio puede navegar: `http:`, `https:` o la
 * página en blanco. Todo lo demás (`file:`, `chrome:`, `javascript:`, `data:`…) se rechaza, cierre
 * en caso de duda (el gateway nunca navega si esto da `false`).
 */
export function checkUrl(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Esquema de una URL en minúsculas y con los dos puntos (`mailto:`, `https:`), o `null` si no
 * tiene esquema reconocible. Sirve para registrar SOLO el esquema al bloquear (nunca la dirección
 * de correo ni el teléfono de un `mailto:`/`tel:`).
 */
export function schemeOf(url: string): string | null {
  const m = /^[\s\u0000-\u001f]*([a-z][a-z0-9+.-]*):/i.exec(url)
  return m ? `${m[1].toLowerCase()}:` : null
}

const SUBFRAME_SCHEMES = new Set(['http:', 'https:', 'about:', 'data:', 'blob:'])

/**
 * Política de esquemas para subframes (anuncios, embebidos): pueden cargar contenido web normal y
 * `about:`/`data:`/`blob:`, pero nunca un esquema que abra otra aplicación (`mailto:`, `tel:`…) ni
 * `file:`/`chrome:`/`javascript:`. La navegación de primer nivel sigue usando `checkUrl`.
 */
export function subframeUrlAllowed(url: string): boolean {
  const scheme = schemeOf(url)
  return scheme !== null && SUBFRAME_SCHEMES.has(scheme)
}

export { hostOf }

/**
 * Origen `host:puerto` de una URL con el formato de `localOrigins` (`store.ts`): `localhost:5173`,
 * `127.0.0.1:4173` o `[::1]:8080`; el puerto por defecto se hace explícito (80/443). `null` si no es http(s).
 */
export function hostPortOf(url: string | URL): string | null {
  try {
    const u = typeof url === 'string' ? new URL(url) : url
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') return null
    const secure = u.protocol === 'https:' || u.protocol === 'wss:'
    const port = u.port || (secure ? '443' : '80')
    const host = u.hostname.toLowerCase()
    return `${host === '::1' ? '[::1]' : host}:${port}`
  } catch {
    return null
  }
}

/**
 * ¿Puede un SUBRECURSO (CSS, JS, imagen, fetch, subframe…) con destino local cargarse desde la página `top`?
 * (regla de red de `session.ts`; el frame principal tiene su propia puerta de aprobación)
 *
 * - Mismo origen que la página (`host:puerto` idénticos): SÍ. La página ya está cargada desde ahí (la aprobó el
 *   usuario al escribirla, o el agente/usuario con «en esta tarea»/«siempre»); pedir otra aprobación por su CSS no
 *   protege nada y dejaba la página sin estilos.
 * - Otro origen local (otro puerto u otro nombre de host): solo si el origen de la página está aprobado con
 *   «Permitir siempre» (`approved`). «En esta tarea» y lo escrito por el usuario NO alcanzan otros puertos.
 * - Sin página (`top` null: service worker, webContents destruido…): NO.
 */
export function localSubresourceAllowed(dest: string | URL, top: string | null, approved: (origin: string) => boolean): boolean {
  if (!top) return false
  if (hostPortOf(dest) === top) return true
  return approved(top)
}
