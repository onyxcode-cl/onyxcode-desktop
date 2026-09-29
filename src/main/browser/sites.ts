/**
 * Utilidades puras del navegador propio de Cowork (Lote C, B.10): heurística de sitio (eTLD+1),
 * coincidencia de host con un sitio permitido y validación de esquema de una URL antes de navegar.
 *
 * No es una lista de sufijos públicos real (la PSL cambia y no vale la pena empaquetarla para
 * esto): es la heurística que pide el plan, pensada solo para agrupar `www.ejemplo.com` y
 * `mail.ejemplo.com` bajo el mismo sitio y para separar dominios de segundo nivel tipo
 * `ejemplo.co.uk`. No es exacta para todos los TLD del mundo; es intencionalmente conservadora.
 */

/** Etiquetas de segundo nivel bajo las que casi siempre hay un tercer nivel "real" (co.uk, com.mx…). */
const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'org', 'net', 'gob', 'gov', 'edu', 'ac'])

/** Sitio (eTLD+1 heurístico) de un host: `www.bbc.co.uk` → `bbc.co.uk`, `mail.google.com` → `google.com`. */
export function siteOf(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  const labels = h.split('.').filter(Boolean)
  if (labels.length <= 2) return h
  const secondLast = labels[labels.length - 2]
  const last = labels[labels.length - 1]
  if (SECOND_LEVEL_LABELS.has(secondLast) && last.length === 2) return labels.slice(-3).join('.')
  return labels.slice(-2).join('.')
}

/** true si `host` es exactamente `site` o un subdominio suyo. */
export function matchesSite(host: string, site: string): boolean {
  const h = host.trim().toLowerCase()
  const s = site.trim().toLowerCase()
  if (!s) return false
  return h === s || h.endsWith(`.${s}`)
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

/** Host (en minúsculas, sin puerto) de una URL http(s), o `null` si no se puede parsear. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.hostname ? u.hostname.toLowerCase() : null
  } catch {
    return null
  }
}
