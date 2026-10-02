/**
 * Redactor de Diagnóstico: todo texto que sale de main hacia el renderer, el portapapeles o un archivo
 * exportado pasa por aquí. Orden:
 *   1. secretos EXACTOS conocidos (contraseña del sidecar, valores de `auth.json`, cabeceras y entorno de los
 *      MCP), del más largo al más corto;
 *   2. patrones de claves/tokens (`shared/redact-patterns.ts`, lineales: sin ReDoS);
 *   3. la carpeta del usuario → `~` (en Windows, todas sus variantes: `C:\Users\x`, `C:/Users/x`, `C:\\Users\\x`
 *      de JSON, `c:\users\X` sin distinguir mayúsculas, `file:///C:/Users/x`, `%5C` codificado, `/c/Users/x` de Git Bash,
 *      `/mnt/c/Users/x` de WSL; además cualquier `<unidad>:\Users\<nombre>` aunque no sea el usuario actual);
 *   4. se recorta la línea a 4000 caracteres.
 * Se redacta ANTES de recortar: un secreto cortado por el límite dejaría un prefijo a la vista.
 */
import { maskSecretPatterns, REDACT_MASK } from '@shared/redact-patterns'

export const MAX_LINE_CHARS = 4000
/** Un secreto exacto más corto que esto se ignora (sustituiría palabras comunes: «true», «api»…). */
const MIN_EXACT_LENGTH = 6

export interface RedactorOptions {
  exact: readonly string[]
  /** Carpeta del usuario (`os.homedir()`); se sustituye por `~`. */
  home?: string
}

export type Redactor = (text: string) => string

const REGEX_META = /[.*+?^${}()|[\]\\/-]/g
const escapeRe = (x: string): string => x.replace(REGEX_META, '\\$&')
/** Un separador en cualquiera de sus formas: `\`, `/`, `\\` (JSON), `%5C`, `%2F`, repetidos. */
const SEP = '(?:[\\\\/]|%5[Cc]|%2[Ff])+'
/** Lo que NO puede seguir al final del nombre de usuario (si sigue, es otro nombre más largo). */
const NAME_END = '(?![^\\\\/\\s"\'<>|:*?%,;)\\]}])'

/** ¿Parece una carpeta de Windows (`C:\…`, `C:/…` o UNC `\\servidor\…`)? */
function isWindowsHome(h: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(h) || /^\\\\[^\\]/.test(h)
}

/**
 * Expresiones que cubren todas las variantes de escritura de una carpeta de Windows. Sin distinguir
 * mayúsculas (el sistema de archivos tampoco). Lineales: separadores y segmentos sin anidar cuantificadores.
 */
export function windowsHomePatterns(home: string): RegExp[] {
  const h = home.replace(/[\\/]+$/, '')
  const m = /^([A-Za-z]):[\\/]+(.*)$/.exec(h)
  const unc = /^[\\/]{2}([^\\/].*)$/.exec(h)
  let head: string
  let rest: string
  if (m) {
    const d = escapeRe(m[1] as string)
    // `C:`/`C%3A`, `file:///C:` (queda cubierto: la parte `file:///` no es parte del patrón), Git Bash `/c`, WSL `/mnt/c`.
    head = `(?:${d}(?::|%3[Aa])|/(?:mnt/)?${d}(?=[\\\\/]|%5[Cc]|%2[Ff]))`
    rest = m[2] as string
  } else if (unc) {
    head = '(?:[\\\\/]|%5[Cc]|%2[Ff]){2}'
    rest = unc[1] as string
  } else {
    return []
  }
  const segs = rest.split(/[\\/]+/).filter(Boolean)
  const body = segs.map(escapeRe).join(SEP)
  const lead = m ? SEP : ''
  // `head` + separador + segmentos. Para UNC `head` ya incluye los dos separadores iniciales.
  return [new RegExp(`${head}${lead}${body}${NAME_END}`, 'gi')]
}

/** Cualquier perfil `<unidad>:\Users\<nombre>`: aunque no sea el usuario actual (otro perfil, un log ajeno). */
const ANY_WINDOWS_PROFILE = new RegExp(
  `(?:[A-Za-z](?::|%3[Aa])|/(?:mnt/)?[A-Za-z](?=[\\\\/]))${SEP}Users${SEP}[^\\\\/\\s"'<>|:*?%,;)\\]}]+`,
  'gi'
)

export function makeRedactor(o: RedactorOptions): Redactor {
  // «Bearer xyz» / «Basic xyz»: además del valor completo, se oculta la credencial sola.
  const withoutScheme = o.exact.map((s) => /^(?:Bearer|Basic)\s+(\S+)$/i.exec(s)?.[1]).filter((s): s is string => Boolean(s))
  const exact = [...new Set([...o.exact, ...withoutScheme].filter((s) => typeof s === 'string' && s.length >= MIN_EXACT_LENGTH))].sort(
    (a, b) => b.length - a.length
  )
  const rawHome = o.home && o.home.length > 1 ? o.home : ''
  const winHome = rawHome !== '' && isWindowsHome(rawHome)
  const winPatterns = winHome ? windowsHomePatterns(rawHome) : []
  const home = rawHome && !winHome && rawHome !== '/' ? rawHome.replace(/\/+$/, '') : ''
  return (line) => {
    let out = line
    for (const secret of exact) if (out.includes(secret)) out = out.split(secret).join(REDACT_MASK)
    out = maskSecretPatterns(out)
    if (home) out = out.split(home).join('~')
    for (const re of winPatterns) out = out.replace(re, '~')
    // Perfiles de Windows en cualquier forma, también sin `home` de Windows (p. ej. logs que traen rutas ajenas).
    out = out.replace(ANY_WINDOWS_PROFILE, '~')
    return out.length > MAX_LINE_CHARS ? `${out.slice(0, MAX_LINE_CHARS)} […]` : out
  }
}

/**
 * Todos los valores de cadena de un JSON (recursivo), salvo los de claves `type` (`api`, `oauth`…), que no
 * son secretos. Se usa con `auth.json`: cualquier cadena de ahí (clave, token de acceso, refresco) cuenta.
 */
export function collectStringValues(value: unknown, out: string[] = [], key = ''): string[] {
  if (typeof value === 'string') {
    if (key !== 'type') out.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) collectStringValues(v, out, key)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStringValues(v, out, k)
  }
  return out
}

/** Secretos de la configuración de MCP: valores de `headers` y `environment` de cada servidor. */
export function collectMcpSecrets(config: unknown): string[] {
  const out: string[] = []
  const mcp = config && typeof config === 'object' ? (config as { mcp?: unknown }).mcp : undefined
  if (!mcp || typeof mcp !== 'object') return out
  for (const entry of Object.values(mcp)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { headers?: unknown; environment?: unknown }
    for (const bag of [e.headers, e.environment]) {
      if (bag && typeof bag === 'object') for (const v of Object.values(bag)) if (typeof v === 'string') out.push(v)
    }
  }
  return out
}
