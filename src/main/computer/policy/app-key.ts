/**
 * Clave de concesión por app en Windows (plan C §2, «AppRef.bundleId pasa a ser appKey»). Puro.
 *  - Ejecutable clásico: `exe:<ruta en minúsculas>|pub:<editor>` (la ruta completa y el editor de Authenticode
 *    evitan que un `chrome.exe` falso en %TEMP% herede la concesión).
 *  - App de la Store/UWP: `aumid:<id>`.
 * Falla cerrado: rutas relativas, UNC, con `..`, con caracteres que rompen la clave o en formato corto 8.3 se rechazan.
 */

export const UNSIGNED_PUBLISHER = '(sin firma)'

export type AppKeyResult = { ok: true; key: string } | { ok: false; reason: string }

export type ParsedAppKey = { kind: 'exe'; path: string; publisher: string } | { kind: 'aumid'; id: string }

const bad = (reason: string): AppKeyResult => ({ ok: false, reason })

/** Segmento 8.3: `PROGRA~1`, `DOCUME~2.TXT`, `ARCHIV~1.EXE`. */
const SHORT_83 = /^[^.\s]{1,6}~[0-9]+(\.[^.]{0,3})?$/

export function normalizeExePath(raw: string): AppKeyResult {
  let p = raw.trim()
  if (p.startsWith('\\\\?\\') && !p.toLowerCase().startsWith('\\\\?\\unc\\')) p = p.slice(4)
  if (!p) return bad('Ruta del programa vacía')
  p = p.replace(/\//g, '\\')
  if (p.startsWith('\\\\')) return bad('Las rutas de red (UNC) no se pueden conceder')
  if (!/^[a-zA-Z]:\\/.test(p)) return bad('La ruta del programa debe ser absoluta (unidad:\\…)')
  if (/[|<>"*?\u0000-\u001f]/.test(p.slice(2))) return bad('La ruta del programa contiene caracteres no válidos')
  if (p.slice(2).includes(':')) return bad('La ruta del programa contiene caracteres no válidos')
  const parts = p.slice(3).split('\\').filter(Boolean)
  if (parts.length === 0) return bad('La ruta no apunta a un programa')
  if (parts.some((s) => s === '.' || s === '..')) return bad('La ruta del programa no puede contener «.» ni «..»')
  if (parts.some((s) => SHORT_83.test(s))) return bad('Ruta corta 8.3 rechazada: usa la ruta completa')
  if (parts.some((s) => s.endsWith(' ') || s.endsWith('.'))) return bad('La ruta del programa contiene un nombre no válido')
  return { ok: true, key: (p.slice(0, 3) + parts.join('\\')).toLowerCase() }
}

export function normalizePublisher(raw: string | null | undefined): AppKeyResult {
  const src = raw ?? ''
  if (/[|\u0000-\u001f]/.test(src)) return bad('Editor del programa no válido')
  const v = src.replace(/\s+/g, ' ').trim()
  if (!v) return { ok: true, key: UNSIGNED_PUBLISHER }
  if (v.length > 200) return bad('Editor del programa no válido')
  return { ok: true, key: v }
}

export function exeKey(path: string, publisher?: string | null): AppKeyResult {
  const p = normalizeExePath(path)
  if (!p.ok) return p
  const pub = normalizePublisher(publisher)
  if (!pub.ok) return pub
  return { ok: true, key: `exe:${p.key}|pub:${pub.key}` }
}

/** AUMID: `Paquete_hash!App` (UWP) o un id de app de escritorio. Sin distinguir mayúsculas (se guarda en minúsculas). */
export function aumidKey(aumid: string): AppKeyResult {
  const v = aumid.trim()
  if (!v || v.length > 256) return bad('AUMID vacío o demasiado largo')
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-!]*$/.test(v) || (v.match(/!/g)?.length ?? 0) > 1 || v.endsWith('!')) return bad('AUMID no válido')
  return { ok: true, key: `aumid:${v.toLowerCase()}` }
}

/** UWP (con AUMID) manda sobre la ruta del exe (que sería `ApplicationFrameHost.exe`, común a todas). */
export function appKeyFor(app: { aumid?: string | null; exePath?: string | null; publisher?: string | null }): AppKeyResult {
  if (app.aumid) return aumidKey(app.aumid)
  if (app.exePath) return exeKey(app.exePath, app.publisher)
  return bad('Falta el AUMID o la ruta del programa')
}

export function parseAppKey(key: string): ParsedAppKey | null {
  if (key.startsWith('aumid:')) {
    const r = aumidKey(key.slice(6))
    return r.ok && r.key === key ? { kind: 'aumid', id: key.slice(6) } : null
  }
  if (!key.startsWith('exe:')) return null
  const i = key.indexOf('|pub:')
  if (i < 0) return null
  const path = key.slice(4, i)
  const publisher = key.slice(i + 5)
  const r = exeKey(path, publisher === UNSIGNED_PUBLISHER ? '' : publisher)
  return r.ok && r.key === key ? { kind: 'exe', path, publisher } : null
}

/** Nombre del ejecutable (`chrome.exe`) de una clave `exe:`; null si es AUMID o no válida. */
export function exeBaseName(key: string): string | null {
  const p = parseAppKey(key)
  return p?.kind === 'exe' ? p.path.slice(p.path.lastIndexOf('\\') + 1) : null
}
