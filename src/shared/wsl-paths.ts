/**
 * Rutas Windows ↔ rutas dentro de la distro WSL de Tareas (módulo PURO, sin `fs` ni Electron).
 *
 * `C:\Users\Ben\Docs\x` ⇄ `/win/c/Users/Ben/Docs/x` (letra de unidad en minúscula; el resto conserva
 * mayúsculas). El agente solo ve los montajes de `/win/...` que el lanzador crea; todo lo demás no existe.
 *
 * Reglas (todas FALLAN CERRADO con un motivo tipado, nunca se «arregla» una ruta sospechosa):
 *  - solo rutas absolutas con unidad (`C:\` o `C:/`); relativas, `C:foo` (relativa a la unidad actual), UNC
 *    (`\\srv\x`, `//srv/x`), de dispositivo (`\\?\`, `\\.\`) y `\\wsl.localhost\` se rechazan;
 *  - `..` se rechaza (no se resuelve); `.` y separadores repetidos se descartan;
 *  - flujos alternativos de datos: un `:` en cualquier segmento (`a.txt:oculto`, `x::$DATA`);
 *  - nombres reservados de Windows (`CON`, `NUL`, `COM1`… con o sin extensión, sin distinguir mayúsculas);
 *  - segmentos que Windows normaliza en silencio (terminan en punto o espacio) y nombres cortos 8.3 (`PROGRA~1`);
 *  - caracteres inválidos (`<>"|?*`), de control y la barra invertida dentro de una ruta Linux;
 *  - longitud: sin límite de 260 (drvfs usa rutas largas), pero ≤ 4096 en total y ≤ 255 por segmento.
 * Los enlaces simbólicos y las junctions NO se pueden detectar sin tocar el disco: `checkNoLinks` lo hace con un
 * `lstat` inyectado (la prueba usa dobles). Ver docs/WINDOWS-TAREAS.md (ataques A2-A4).
 */

export const SANDBOX_ROOT = '/win'
export const MAX_PATH_TOTAL = 4096
export const MAX_SEGMENT = 255

export type PathRejectReason =
  | 'empty'
  | 'control'
  | 'unc'
  | 'device'
  | 'relative'
  | 'drive-relative'
  | 'dotdot'
  | 'ads'
  | 'reserved'
  | 'trailing'
  | 'shortname'
  | 'invalid-char'
  | 'backslash'
  | 'too-long'
  | 'outside'
  | 'link'

export type PathResult = { ok: true; path: string } | { ok: false; reason: PathRejectReason }

export interface PathMount {
  /** Ruta Windows de la carpeta montada (`C:\Users\Ben\Docs\x`). */
  win: string
  /** Ruta dentro de la distro (`/win/c/Users/Ben/Docs/x`). */
  linux: string
}

const RESERVED = /^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9¹²³]|lpt[0-9¹²³])$/i
const INVALID_CHARS = /[<>"|?*]/
const CONTROL = /[\u0000-\u001f\u007f]/
const SHORTNAME = /~[0-9]/

const bad = (reason: PathRejectReason): PathResult => ({ ok: false, reason })

/** Valida un segmento de nombre (ya sin separadores). Devuelve el motivo del rechazo o null. */
export function segmentProblem(seg: string): PathRejectReason | null {
  if (seg === '..') return 'dotdot'
  if (seg.length > MAX_SEGMENT) return 'too-long'
  if (CONTROL.test(seg)) return 'control'
  if (seg.includes(':')) return 'ads'
  if (INVALID_CHARS.test(seg)) return 'invalid-char'
  if (seg.endsWith('.') || seg.endsWith(' ')) return 'trailing'
  // Windows ignora la extensión y los espacios finales del nombre base: `nul.txt`, `NUL .x`.
  const base = seg.split('.')[0]!.replace(/ +$/, '')
  if (RESERVED.test(base)) return 'reserved'
  if (SHORTNAME.test(seg)) return 'shortname'
  return null
}

function splitWin(rest: string): string[] | PathRejectReason {
  const out: string[] = []
  for (const seg of rest.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue
    const p = segmentProblem(seg)
    if (p) return p
    out.push(seg)
  }
  return out
}

/** `C:\a\b` → `/win/c/a/b`. */
export function toSandboxPath(winPath: string): PathResult {
  if (typeof winPath !== 'string' || winPath.length === 0) return bad('empty')
  if (winPath.length > MAX_PATH_TOTAL) return bad('too-long')
  if (CONTROL.test(winPath)) return bad('control')
  if (/^[\\/]{2}/.test(winPath)) return bad(/^[\\/]{2}[?.][\\/]?/.test(winPath) ? 'device' : 'unc')
  const m = /^([A-Za-z]):(.*)$/s.exec(winPath)
  if (!m) return bad('relative')
  const rest = m[2]!
  // `C:foo` es relativa al directorio actual de la unidad; `C:` a secas también.
  if (rest !== '' && !/^[\\/]/.test(rest)) return bad('drive-relative')
  if (rest === '') return bad('drive-relative')
  const segs = splitWin(rest)
  if (typeof segs === 'string') return bad(segs)
  const path = [SANDBOX_ROOT, m[1]!.toLowerCase(), ...segs].join('/')
  return path.length > MAX_PATH_TOTAL ? bad('too-long') : { ok: true, path }
}

/** Montaje para una carpeta Windows (la ruta Linux sale de `toSandboxPath`). */
export function mountFor(winFolder: string): { ok: true; mount: PathMount } | { ok: false; reason: PathRejectReason } {
  const r = toSandboxPath(winFolder)
  if (!r.ok) return r
  return { ok: true, mount: { win: toWinCanonical(r.path)!, linux: r.path } }
}

/** `/win/c/a/b` → `C:\a\b` (sin validar montajes). Null si no tiene la forma `/win/<letra>[/...]`. */
export function toWinCanonical(linux: string): string | null {
  const m = /^\/win\/([a-z])(?:\/(.*))?$/.exec(linux)
  if (!m) return null
  const rest = m[2] ? m[2].split('/').join('\\') : ''
  return `${m[1]!.toUpperCase()}:\\${rest}`
}

/**
 * `/win/<letra>[/...]` → ruta Windows canónica, validando cada segmento (sin mirar montajes: eso es
 * autorización y lo decide `assertInsideApproved`). Acepta solo la forma exacta con letra de unidad
 * minúscula; `..`, ADS, reservados, 8.3, barras invertidas y control se rechazan con motivo tipado.
 */
export function winFromLinuxAbsolute(linuxPath: string): PathResult {
  if (typeof linuxPath !== 'string' || linuxPath.length === 0) return bad('empty')
  if (linuxPath.length > MAX_PATH_TOTAL) return bad('too-long')
  if (CONTROL.test(linuxPath)) return bad('control')
  if (linuxPath.includes('\\')) return bad('backslash')
  if (!linuxPath.startsWith('/')) return bad('relative')
  const segs: string[] = []
  for (const seg of linuxPath.split('/')) {
    if (seg === '' || seg === '.') continue
    const p = segmentProblem(seg)
    if (p) return bad(p)
    segs.push(seg)
  }
  if (segs[0] !== 'win' || !/^[a-z]$/.test(segs[1] ?? '')) return bad('outside')
  const win = toWinCanonical('/' + segs.join('/'))
  return win ? { ok: true, path: win } : bad('outside')
}

/**
 * Ruta de la distro → ruta Windows, SOLO si cae dentro de alguno de los `mounts`. Cualquier otra cosa
 * (`/etc/passwd`, `/win/d/x` no montada, `/win/c/otra`) devuelve `outside`. La ruta Windows se reconstruye a
 * partir del montaje + el resto validado: nunca se devuelve texto del agente sin pasar por `segmentProblem`.
 */
export function fromSandboxPath(linuxPath: string, mounts: readonly PathMount[]): PathResult {
  if (typeof linuxPath !== 'string' || linuxPath.length === 0) return bad('empty')
  if (linuxPath.length > MAX_PATH_TOTAL) return bad('too-long')
  if (CONTROL.test(linuxPath)) return bad('control')
  if (linuxPath.includes('\\')) return bad('backslash')
  if (!linuxPath.startsWith('/')) return bad('relative')
  const segs: string[] = []
  for (const seg of linuxPath.split('/')) {
    if (seg === '' || seg === '.') continue
    const p = segmentProblem(seg)
    if (p) return bad(p)
    segs.push(seg)
  }
  const canon = '/' + segs.join('/')
  const lower = canon.toLowerCase()
  // El montaje más específico gana (no importa el orden de la lista).
  const sorted = [...mounts].sort((a, b) => b.linux.length - a.linux.length)
  for (const mnt of sorted) {
    const ml = mnt.linux.toLowerCase()
    if (lower === ml || lower.startsWith(ml + '/')) {
      const rest = canon.slice(mnt.linux.length).split('/').filter(Boolean)
      const base = mnt.win.replace(/[\\/]+$/, '')
      return { ok: true, path: rest.length ? `${base}\\${rest.join('\\')}` : mnt.win }
    }
  }
  return bad('outside')
}

export interface LinkStat {
  isSymbolicLink(): boolean
}

/**
 * Recorre `rest` (segmentos ya validados) bajo `rootWin` con un `lstat` inyectado y rechaza si algún componente
 * existente es un enlace simbólico o una junction (Node las presenta como `isSymbolicLink()` en Windows).
 * Un componente que no existe corta el recorrido sin error (se va a crear). Cualquier otro error del `lstat`
 * (permisos, etc.) falla cerrado.
 */
export function checkNoLinks(
  rootWin: string,
  rest: readonly string[],
  lstat: (p: string) => LinkStat | null
): { ok: true } | { ok: false; reason: 'link'; at: string } {
  let cur = rootWin.replace(/[\\/]+$/, '')
  for (const seg of rest) {
    cur = `${cur}\\${seg}`
    let st: LinkStat | null
    try {
      st = lstat(cur)
    } catch {
      return { ok: false, reason: 'link', at: cur }
    }
    if (st === null) return { ok: true }
    if (st.isSymbolicLink()) return { ok: false, reason: 'link', at: cur }
  }
  return { ok: true }
}
