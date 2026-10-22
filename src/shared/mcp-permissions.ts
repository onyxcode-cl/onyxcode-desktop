/**
 * Permisos de los conectores (servidores MCP) en Code: PREGUNTAR por defecto, como Claude Code; la persona marca en cuáles confía
 * («Sin preguntar en Code», `Settings.codeTrustedMcp`). Funciones puras, sin Electron, compartidas por main y UI.
 *
 * Verificado en el binario del motor 1.19 (`resources/opencode-bin/bin/opencode`):
 *  - el nombre de una herramienta MCP, y con él su clave de permiso, es `sanea(servidor) + "_" + sanea(herramienta)`, con
 *    `sanea(x) = x.replace(/[^a-zA-Z0-9_-]/g, "_")`;
 *  - `evaluate` toma la ÚLTIMA regla cuyo permiso y patrón casan por comodín y, si ninguna casa, el valor por defecto es `ask`;
 *  - las llamadas internas de Code Mode (`execute` → `tools.<servidor>.<herramienta>`) piden permiso con esa misma clave, así que una sola
 *    regla `<servidor>_*` cubre la llamada directa y la de Code Mode.
 * Por eso la regla de un servidor es la clave `<servidor saneado>_*` (la misma forma que ya usa `mcpPermissionKey`).
 */
import { MCP_NAME_RE } from './catalogo'

/**
 * Conectores que la app inyecta en el motor principal y que son de confianza fija (no aparecen como configurables):
 * `browser` es el navegador integrado (`src/main/embedded-browser/mcp-server.ts`, tiene su propio permiso por sitio y
 * por acción); `computer` es el control del equipo, que solo existe en los servidores de Overdrive con acceso total
 * (tiene su propio consentimiento) y se lista por si algún día se inyecta también aquí.
 * `shell_bg` NO está: puede ejecutar comandos, así que debe preguntar como `bash`.
 */
export const CODE_INTERNAL_MCP: readonly string[] = ['browser', 'computer']

/** Tope de conectores de confianza que se guardan (defensa ante un archivo de ajustes inflado). */
export const MAX_CODE_TRUSTED_MCP = 200

/** Nombre de herramienta MCP del motor: cada trozo se sanea con la misma regla que usa el motor. */
export const sanitizeMcpName = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, '_')

/** Clave de permiso que cubre TODAS las herramientas de un servidor (`<servidor saneado>_*`). */
export const mcpServerPermissionKey = (server: string): string => `${sanitizeMcpName(server)}_*`

/** ¿Es un conector interno de la app (de confianza fija)? */
export function isInternalCodeMcp(name: string): boolean {
  return CODE_INTERNAL_MCP.includes(name)
}

/**
 * Normaliza `Settings.codeTrustedMcp` leído de disco. Nunca lanza: lo que no sea una lista de nombres válidos de conector se descarta,
 * sin duplicados, sin los internos (ya son de confianza) y con tope.
 */
export function normalizeCodeTrustedMcp(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string' || !MCP_NAME_RE.test(v) || isInternalCodeMcp(v) || seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= MAX_CODE_TRUSTED_MCP) break
  }
  return out
}

/** Lista nueva con `name` marcado o desmarcado como de confianza (normalizada; sin tocar la original). */
export function withCodeTrust(trusted: readonly string[], name: string, on: boolean): string[] {
  const rest = normalizeCodeTrustedMcp(trusted).filter((n) => n !== name)
  return normalizeCodeTrustedMcp(on ? [...rest, name] : rest)
}

export interface McpPermissionInput {
  /** Servidores conocidos al construir la config (los de la app y los que reporte el motor). */
  servers: readonly string[]
  /** `Settings.codeTrustedMcp`. */
  trusted: readonly string[]
  /** Conectores internos de la app (`CODE_INTERNAL_MCP`, más los que el que llama sepa que inyectó). */
  internal: readonly string[]
}

/**
 * Regla de permiso del motor por conector: `{ '<servidor>_*': 'ask' | 'allow' }`.
 *  - interno o de confianza → `allow`; cualquier otro → `ask` (el valor por defecto de Code).
 *  - Los internos se incluyen aunque no estén en `servers` (por si el motor los carga más tarde); los de confianza que ya no
 *    existen NO (no se inventan reglas para servidores ausentes).
 *  - Si dos nombres distintos se sanean igual (`a b` y `a.b` → `a_b_*`), gana `ask`: nunca se confía por homonimia.
 *  - Orden: primero los que preguntan, luego los permitidos (el motor aplica la última regla que casa).
 *  - Nombres vacíos o no textuales se ignoran. Nunca lanza.
 *
 * ADVERTENCIA para quien la cablea: un `allow` de esta función se escribe con la clave `<servidor>_*`; si el archivo de conectores de
 * la app ya trae reglas por herramienta (`<servidor>_<herramienta>: deny` de los conectores locales), éstas deben quedar DESPUÉS
 * (la última gana). Ver el informe de F8-B203 y `docs/SEGURIDAD.md`.
 */
export function mcpPermissionRulesForCode(input: McpPermissionInput): Record<string, 'ask' | 'allow'> {
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [])
  const internal = new Set(list(input?.internal))
  const trusted = new Set(list(input?.trusted))
  const verdict = new Map<string, 'ask' | 'allow'>()
  const decide = (name: string, v: 'ask' | 'allow'): void => {
    const key = mcpServerPermissionKey(name)
    verdict.set(key, verdict.get(key) === 'ask' || v === 'ask' ? 'ask' : 'allow')
  }
  for (const name of list(input?.servers)) decide(name, internal.has(name) || trusted.has(name) ? 'allow' : 'ask')
  for (const name of internal) if (!list(input?.servers).includes(name)) decide(name, 'allow')
  const asks = [...verdict].filter(([, v]) => v === 'ask')
  const allows = [...verdict].filter(([, v]) => v === 'allow')
  return Object.fromEntries([...asks, ...allows])
}
