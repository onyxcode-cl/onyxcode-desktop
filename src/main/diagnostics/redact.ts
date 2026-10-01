/**
 * Redactor de Diagnóstico: todo texto que sale de main hacia el renderer, el portapapeles o un archivo
 * exportado pasa por aquí. Orden:
 *   1. secretos EXACTOS conocidos (contraseña del sidecar, valores de `auth.json`, cabeceras y entorno de los
 *      MCP), del más largo al más corto;
 *   2. patrones de claves/tokens (`shared/redact-patterns.ts`, lineales: sin ReDoS);
 *   3. la carpeta del usuario → `~`;
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

export function makeRedactor(o: RedactorOptions): Redactor {
  // «Bearer xyz» / «Basic xyz»: además del valor completo, se oculta la credencial sola.
  const withoutScheme = o.exact.map((s) => /^(?:Bearer|Basic)\s+(\S+)$/i.exec(s)?.[1]).filter((s): s is string => Boolean(s))
  const exact = [...new Set([...o.exact, ...withoutScheme].filter((s) => typeof s === 'string' && s.length >= MIN_EXACT_LENGTH))].sort(
    (a, b) => b.length - a.length
  )
  const home = o.home && o.home.length > 1 && o.home !== '/' ? o.home.replace(/\/+$/, '') : ''
  return (line) => {
    let out = line
    for (const secret of exact) if (out.includes(secret)) out = out.split(secret).join(REDACT_MASK)
    out = maskSecretPatterns(out)
    if (home) out = out.split(home).join('~')
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
