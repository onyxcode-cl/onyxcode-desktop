/**
 * Permisos de los conectores (servidores MCP) en el sidecar principal (Chat + Code), F8-B203. Cablea las reglas puras de
 * `@shared/mcp-permissions` (paquete A) en el bloque `permission` de la config inline (`OPENCODE_CONFIG_CONTENT`).
 *
 * Verificado con el motor 1.19 real (`resources/opencode-bin/bin/opencode`, aislado y con un proveedor falso local: ver
 * `docs/SEGURIDAD.md` §3 sexagies bis):
 *  - Sin regla, el agente `build` (`'*': allow`) ejecuta cualquier herramienta MCP SIN preguntar, directa o desde `execute`.
 *  - Las configs se fusionan como objetos: una clave que YA existía en una config anterior (archivo de conectores de la app, global)
 *    conserva SU posición y solo cambia de valor; una clave nueva va AL FINAL. Como gana la última regla que casa, un
 *    `<servidor>_*: allow` nuevo quedaría DESPUÉS de un `<servidor>_<herramienta>: deny` del archivo (herramientas bloqueadas de un
 *    conector local) y lo anularía (comprobado: la herramienta bloqueada se ejecutó).
 *  - Arreglo: tras nuestras reglas se re-afirma cada `deny`/`ask` más específico de las configs anteriores con un ALIAS EXACTO
 *    `"<clave> *"`: el comparador del motor (`Wildcard.match`) trata un `" *"` final como opcional, y los nombres de herramienta no
 *    tienen espacios, así que `x_secret *` casa exactamente con `x_secret` y, por ser clave nueva, queda al final (comprobado: la
 *    herramienta bloqueada deja de ofrecerse, directa y en Code Mode).
 *
 * El bloque vale para TODOS los agentes del sidecar; `chat` y los `.md` con `'*': deny` siguen denegando (su permiso de agente va
 * después del de la config). Overdrive no usa este bloque (su servidor tiene su propia config).
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mcpPermissionRulesForCode, mcpServerPermissionKey } from '@shared/mcp-permissions'

type Action = 'allow' | 'ask' | 'deny'
type RuleValue = Action | Record<string, Action>
/** Severidad: cuanto más alto, más estricto. */
const STRICT: Record<Action, number> = { allow: 0, ask: 1, deny: 2 }
const isAction = (v: unknown): v is Action => v === 'allow' || v === 'ask' || v === 'deny'

/** Sufijo del alias exacto (ver cabecera). */
export const EXACT_ALIAS_SUFFIX = ' *'
/** Tope de servidores que se aceptan de fuentes externas (defensa ante una config inflada). */
const MAX_SERVERS = 300
const SERVER_NAME_MAX = 128

/** Mismo comparador que el motor 1.19 (`Wildcard.match`): `*` cualquier cosa, `?` un carácter, `" *"` final opcional. */
export function wildcardMatch(str: string, pattern: string): boolean {
  const s = str.replaceAll('\\', '/')
  let p = pattern
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  if (p.endsWith(' .*')) p = p.slice(0, -3) + '( .*)?'
  return new RegExp('^' + p + '$', 's').test(s)
}

export interface CodeMcpPermissionInput {
  /** Servidores conocidos: los de la app, los de la config global y los que reporte el motor ya arrancado. */
  servers: readonly string[]
  /** `Settings.codeTrustedMcp`. */
  trusted: readonly string[]
  /** Conectores internos de confianza fija (`CODE_INTERNAL_MCP`). */
  internal: readonly string[]
  /**
   * Bloque `permission` de las configs que el motor fusiona ANTES de la inline (archivo de conectores de la app, config global
   * del usuario). Solo se lee.
   */
  base?: Record<string, unknown>
  /**
   * Reglas fijas que van tras las de los servidores (p. ej. `bgshellConfigPermission()`); los servidores de `fixedServers` se excluyen
   * de las reglas generales (sus herramientas tienen permisos propios).
   */
  fixed?: Record<string, Action>
  fixedServers?: readonly string[]
}

/**
 * Bloque `permission` de la config inline para los conectores en Code. Orden de las claves (gana la última que casa):
 *  1. `<servidor>_*`: `ask` (por defecto) o `allow` (interno o «Sin preguntar en Code»), de `mcpPermissionRulesForCode`.
 *     - Si el archivo de la app pide «Preguntar antes de cada uso» (`<servidor>_*: ask`) o hay un `deny` para el servidor entero,
 *       se respeta: la confianza en Code nunca afloja una regla más estricta ya escrita (gana la más estricta).
 *  2. Las reglas fijas (`bgshell_*`), con el mismo criterio de «gana la más estricta» si la base trae la misma clave.
 *  3. Alias exactos (`"<clave> *"`) de nuestras reglas `ask` que un `allow` posterior taparía (servidor cuyo nombre es prefijo de
 *     otro: `a_*` casa `a_b_<herramienta>`).
 *  4. Alias exactos de cada `deny`/`ask` de la base más específico que una de nuestras claves y más estricto que lo que nuestra clave
 *     diría: así siguen DESPUÉS de nuestros `allow`/`ask`.
 * Nunca lanza; ignora lo que no sean textos.
 */
export function buildCodeMcpPermission(i: CodeMcpPermissionInput): Record<string, RuleValue> {
  const base = i.base && typeof i.base === 'object' && !Array.isArray(i.base) ? i.base : {}
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const fixedServers = new Set(strings(i.fixedServers))
  const baseAction = (key: string): Action | null => (isAction(base[key]) ? (base[key] as Action) : null)
  const servers = strings(i.servers).filter((s) => !fixedServers.has(s))
  // «Preguntar antes de cada uso» (o un deny del servidor entero) gana sobre «Sin preguntar en Code».
  const trusted = strings(i.trusted).filter((s) => {
    const b = baseAction(mcpServerPermissionKey(s))
    return b !== 'ask' && b !== 'deny'
  })
  const rules = mcpPermissionRulesForCode({ servers, trusted, internal: strings(i.internal).filter((s) => !fixedServers.has(s)) })
  const out: Record<string, RuleValue> = {}
  const stricter = (key: string, a: Action): Action => {
    const b = baseAction(key)
    return b && STRICT[b] > STRICT[a] ? b : a
  }
  for (const [k, a] of Object.entries(rules)) out[k] = stricter(k, a)
  for (const [k, a] of Object.entries(i.fixed ?? {})) if (isAction(a)) out[k] = stricter(k, a)

  // Un servidor cuyo nombre es prefijo de otro (`a` y `a_b`): `a_*: allow` casa también `a_b_<herramienta>` y, por ir después,
  // ganaría sobre `a_b_*: ask` (confiar en `a` confiaría en `a_b` sin decirlo). Se re-afirma la regla más estricta al final.
  const mine = Object.entries(out)
  for (let x = 0; x < mine.length; x++) {
    const [k1, a1] = mine[x]!
    if (!isAction(a1)) continue
    for (let y = x + 1; y < mine.length; y++) {
      const [k2, a2] = mine[y]!
      if (isAction(a2) && STRICT[a2] < STRICT[a1] && wildcardMatch(k1, k2)) {
        out[k1 + EXACT_ALIAS_SUFFIX] = a1
        break
      }
    }
  }

  // Alias exactos de las reglas más específicas de la base que nuestras claves taparían.
  const ours = Object.entries(out).filter((e): e is [string, Action] => isAction(e[1]))
  const effectiveOurs = (key: string): Action | null => {
    let hit: Action | null = null
    for (const [k, a] of ours) if (k !== key && wildcardMatch(key, k)) hit = a
    return hit
  }
  for (const [key, value] of Object.entries(base)) {
    if (key === '*' || key.includes(' ') || key in out) continue
    const covering = effectiveOurs(key)
    if (!covering) continue
    if (isAction(value)) {
      if (value !== 'allow' && STRICT[value] > STRICT[covering]) out[key + EXACT_ALIAS_SUFFIX] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Mapa por patrón (raro en MCP): solo se re-afirman sus `deny`/`ask`, en el mismo orden.
      const strict = Object.entries(value as Record<string, unknown>).filter(
        (e): e is [string, Action] => isAction(e[1]) && e[1] !== 'allow' && STRICT[e[1]] > STRICT[covering]
      )
      if (strict.length) out[key + EXACT_ALIAS_SUFFIX] = Object.fromEntries(strict)
    }
  }
  return out
}

/** Huella estable del bloque (para saber si hay que relanzar el motor). */
export function permissionFingerprint(p: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(p))
}

/** Lista de nombres de servidor saneada (textos no vacíos, sin duplicados, con tope). */
export function cleanServerNames(names: Iterable<unknown>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const n of names) {
    if (typeof n !== 'string') continue
    const s = n.trim()
    if (!s || s.length > SERVER_NAME_MAX || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= MAX_SERVERS) break
  }
  return out
}

// ── Config global del usuario (~/.config/opencode) ────────────────────────────────────────────────────────────────

/** Quita comentarios `//` y `/* *\/` fuera de cadenas y comas finales (JSONC del motor). */
export function stripJsonc(text: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const n = text[i + 1]
    if (inStr) {
      out += c
      if (c === '\\') {
        out += n ?? ''
        i++
      } else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && n === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export interface GlobalOpencodeConfigInfo {
  servers: string[]
  permission: Record<string, unknown>
}

/**
 * Servidores MCP y reglas `permission` de la config GLOBAL del usuario (lo que el motor carga antes que la nuestra), leída de
 * `$XDG_CONFIG_HOME/opencode` o `~/.config/opencode` en el mismo orden que el motor (`config.json`, `opencode.json`,
 * `opencode.jsonc`). Mejor esfuerzo y SOLO lectura: un archivo ilegible se ignora (el motor reportará luego lo que cargó).
 */
export function readGlobalOpencodeConfig(env: NodeJS.ProcessEnv = process.env): GlobalOpencodeConfigInfo {
  const dir = join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'opencode')
  const servers: string[] = []
  let permission: Record<string, unknown> = {}
  for (const name of ['config.json', 'opencode.json', 'opencode.jsonc']) {
    const file = join(dir, name)
    try {
      if (!existsSync(file)) continue
      const raw = JSON.parse(stripJsonc(readFileSync(file, 'utf8'))) as unknown
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const o = raw as Record<string, unknown>
      if (o.mcp && typeof o.mcp === 'object' && !Array.isArray(o.mcp)) servers.push(...Object.keys(o.mcp))
      if (typeof o.permission === 'string') permission = { ...permission, '*': o.permission }
      else if (o.permission && typeof o.permission === 'object' && !Array.isArray(o.permission))
        permission = { ...permission, ...(o.permission as Record<string, unknown>) }
    } catch {
      /* ilegible: lo que cargue el motor se verá al preguntarle */
    }
  }
  return { servers: cleanServerNames(servers), permission }
}

// ── Lo que reporta el motor ya arrancado ──────────────────────────────────────────────────────────────────────────

/**
 * Servidores MCP que el motor tiene cargados (`GET /mcp` = `client.mcp.status()` y las claves `mcp` de `GET /config` =
 * `client.config.get()`), en la carpeta dada. Incluye los externos de `~/.config/opencode` y de la carpeta del proyecto.
 * Cualquier fallo → `null` (no se sabe; no se cambia nada).
 */
export async function fetchEngineMcpServers(conn: { baseUrl: string; authorization: string }, directory: string): Promise<string[] | null> {
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(`${conn.baseUrl}${path}?directory=${encodeURIComponent(directory)}`, {
      headers: { Authorization: conn.authorization },
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  try {
    const [status, config] = await Promise.all([get('/mcp'), get('/config')])
    const names: unknown[] = []
    if (status && typeof status === 'object' && !Array.isArray(status)) names.push(...Object.keys(status))
    const mcp = (config as { mcp?: unknown } | null)?.mcp
    if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) names.push(...Object.keys(mcp))
    return cleanServerNames(names)
  } catch {
    return null
  }
}
