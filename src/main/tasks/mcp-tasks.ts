/**
 * MCP del usuario disponibles en Tareas.
 *
 * Los servidores Tareas NO reciben `OPENCODE_CONFIG` (solo el sidecar lo tiene), así que sin esto
 * no habría ningún MCP del usuario dentro de Tareas. Aquí se leen los servidores que la app
 * administra (`readAppMcpConfig()`), se filtran los activos y marcados "Disponible en Tareas" y
 * se devuelven como bloque `mcp` para la config inline (`manager.inlineConfig`).
 *
 * Las marcas propias de Tareas viven en `userData/tasks-mcp.json`
 * (`{ servers: { <nombre>: { tasks, askEachTool } } }`). NUNCA se escribe en
 * `userData/opencode/opencode.json`: OpenCode valida ese archivo de forma estricta.
 */
import { RESERVED_MCP_NAMES } from '../documents/names'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TasksMcpInfo } from '@shared/ipc-tasks'
import type { McpEntry } from '@shared/ipc-extras'
import { CatalogProvenanceStore } from '../extras/mcp-catalog-install'
import { readAppMcpConfig } from '../extras/mcp-config'
import { hostOf } from '../util/url'
import { HIDDEN_SHELL_ENV } from './hidden-env'
import type { McpRouteClientConfig, McpRouteSpec } from './mcp-proxy'

export interface TasksMcpContribution {
  /** Bloque `mcp` de OpenCode a inyectar. */
  mcp: Record<string, unknown>
  /** Permisos por herramienta (`"<servidor>_*": 'ask'`). */
  permission: Record<string, 'ask' | 'allow'>
  /** Hosts remotos a sumar a la lista blanca de red del sandbox. */
  hosts: string[]
  /**
   * Solo sandbox: servidores marcados «Disponible en Tareas» que NO entran porque no se pueden proteger (F8-B79):
   * locales con variables de entorno secretas (viven en el entorno del proceso del sandbox, legible con `ps eww`) o
   * remotos cuyo proxy no pudo registrarse. Falla cerrado.
   */
  blocked: string[]
}

/** Registro de destinos del proxy MCP (fuera del sandbox): devuelve la URL y el token de sesión que ve el servidor. */
export type McpRouteRegistrar = (spec: McpRouteSpec) => McpRouteClientConfig

/** ¿Tiene secretos que el sandbox no debe ver? Remoto con cabeceras, o local con variables de entorno. */
export function mcpEntryHasSecrets(entry: McpEntry): boolean {
  if (entry.type === 'local') return !!entry.environment && Object.keys(entry.environment).length > 0
  return !!entry.headers && Object.keys(entry.headers).length > 0
}

/** `oauth` sin campos secretos (`clientSecret`…): lo que sí puede viajar a la config del sandbox. */
function oauthWithoutSecrets(oauth: McpRemoteOauth): McpRemoteOauth {
  if (!oauth || typeof oauth !== 'object') return oauth
  return Object.fromEntries(Object.entries(oauth).filter(([k]) => !/secret|token|password|key/i.test(k)))
}
type McpRemoteOauth = false | Record<string, string | number> | undefined

interface McpFlags {
  tasks: boolean
  askEachTool: boolean
}

interface Persisted {
  servers: Record<string, McpFlags>
}

/**
 * Prefijo que quita del entorno del MCP local las credenciales del propio servidor OpenCode
 * (el MCP hereda `process.env` del servidor y no debe ver contraseñas ni la puerta del plan).
 */
export const MCP_ENV_WRAPPER: readonly string[] = ['/usr/bin/env', ...HIDDEN_SHELL_ENV.flatMap((name) => ['-u', name])]

/** Nombres de los servidores que son conectores LOCALES del catálogo (se leen de la procedencia; vacío si no se puede leer). */
function localCatalogServers(): Set<string> {
  try {
    const prov = new CatalogProvenanceStore(join(app.getPath('userData'), 'mcp-catalog-installs.json')).read()
    return new Set(
      Object.entries(prov)
        .filter(([, p]) => !!p.local)
        .map(([n]) => n)
    )
  } catch {
    return new Set()
  }
}

function flagsFile(): string {
  return join(app.getPath('userData'), 'tasks-mcp.json')
}

function readFlags(): Persisted {
  const out: Persisted = { servers: {} }
  try {
    const file = flagsFile()
    if (!existsSync(file)) return out
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Persisted>
    if (raw.servers && typeof raw.servers === 'object' && !Array.isArray(raw.servers)) {
      for (const [name, v] of Object.entries(raw.servers)) {
        if (!v || typeof v !== 'object') continue
        const o = v as Partial<McpFlags>
        out.servers[name] = { tasks: o.tasks === true, askEachTool: o.askEachTool === true }
      }
    }
  } catch (err) {
    console.error('[tasks] tasks-mcp.json inválido:', err)
  }
  return out
}

function writeFlags(data: Persisted): void {
  const file = flagsFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
}

/**
 * true si el MCP remoto probablemente use OAuth (sus tokens viven en el XDG del usuario, que el
 * sandbox no tiene): OAuth explícito, o autodetección activa (`oauth !== false`) sin cabeceras.
 */
function usesOAuth(entry: McpEntry): boolean {
  if (entry.type !== 'remote') return false
  if (entry.oauth === false) return false
  if (entry.oauth && typeof entry.oauth === 'object') return true
  return !entry.headers || Object.keys(entry.headers).length === 0
}

function infoOf(name: string, entry: McpEntry, flags: McpFlags | undefined): TasksMcpInfo {
  const host = entry.type === 'remote' ? hostOf(entry.url) : null
  return {
    name,
    type: entry.type,
    enabled: entry.enabled !== false,
    tasks: flags?.tasks === true,
    askEachTool: flags?.askEachTool === true,
    // Con cabeceras secretas el sandbox habla con el proxy de main, no con el host: no se suma a su red (F8-B79).
    hosts: host && !mcpEntryHasSecrets(entry) ? [host] : [],
    oauth: usesOAuth(entry),
    ...(entry.type === 'local' && mcpEntryHasSecrets(entry) ? { localSecrets: true } : {})
  }
}

/**
 * Bloque `mcp`/`permission`/`hosts` a inyectar en un servidor Tareas. Solo entran los servidores
 * activos y marcados "Disponible en Tareas". Los hosts solo importan en sandbox (allowlist del proxy).
 */
export function tasksMcpContribution(opts: { sandboxed: boolean; registerRoute?: McpRouteRegistrar }): TasksMcpContribution {
  const out: TasksMcpContribution = { mcp: {}, permission: {}, hosts: [], blocked: [] }
  let servers: Record<string, McpEntry>
  try {
    servers = readAppMcpConfig().servers
  } catch (err) {
    console.error('[tasks] no se pudo leer la config MCP de la app:', err)
    return out
  }
  const flags = readFlags().servers
  const hosts = new Set<string>()
  const catalogLocal = localCatalogServers()
  for (const [name, entry] of Object.entries(servers)) {
    const f = flags[name]
    if (!f?.tasks || entry.enabled === false) continue
    if (RESERVED_MCP_NAMES.has(name)) {
      // `documentos` es la herramienta propia de la app: un MCP del usuario con ese nombre la taparía.
      out.blocked.push(name)
      continue
    }
    if (catalogLocal.has(name)) {
      // Programas de terceros instalados desde el catálogo (F8-B186): nunca dentro de Overdrive, ni con sandbox ni sin él.
      out.blocked.push(name)
      continue
    }
    if (opts.sandboxed && entry.type === 'local' && mcpEntryHasSecrets(entry)) {
      // Sus variables de entorno irían al entorno del proceso del sandbox (legible con `ps eww`): no entra.
      out.blocked.push(name)
      continue
    }
    if (opts.sandboxed && entry.type === 'remote' && mcpEntryHasSecrets(entry)) {
      // Las cabeceras reales las pone el proxy MCP de main; el sandbox solo recibe URL loopback + token de sesión.
      let route: McpRouteClientConfig | null = null
      try {
        route = opts.registerRoute ? opts.registerRoute({ name, url: entry.url, headers: entry.headers }) : null
      } catch (err) {
        console.error(`[tasks] MCP "${name}" no entra en el sandbox:`, err instanceof Error ? err.message : 'error')
      }
      if (!route) {
        out.blocked.push(name)
        continue
      }
      out.mcp[name] = {
        type: 'remote',
        url: route.url,
        headers: route.headers,
        oauth: false,
        enabled: true,
        ...(entry.timeout ? { timeout: entry.timeout } : {})
      }
      if (f.askEachTool) out.permission[`${name}_*`] = 'ask'
      continue
    }
    if (entry.type === 'local') {
      out.mcp[name] = {
        type: 'local',
        command: [...MCP_ENV_WRAPPER, ...entry.command],
        ...(entry.environment ? { environment: entry.environment } : {}),
        ...(entry.cwd ? { cwd: entry.cwd } : {}),
        enabled: true,
        ...(entry.timeout ? { timeout: entry.timeout } : {})
      }
    } else {
      out.mcp[name] = {
        type: 'remote',
        url: entry.url,
        ...(entry.headers ? { headers: entry.headers } : {}),
        ...(entry.oauth !== undefined ? { oauth: opts.sandboxed ? oauthWithoutSecrets(entry.oauth) : entry.oauth } : {}),
        enabled: true,
        ...(entry.timeout ? { timeout: entry.timeout } : {})
      }
      const host = hostOf(entry.url)
      if (host && opts.sandboxed && !mcpEntryHasSecrets(entry)) hosts.add(host)
    }
    if (f.askEachTool) out.permission[`${name}_*`] = 'ask'
  }
  out.hosts = [...hosts]
  return out
}

export class TasksMcpPrefs {
  /** Todos los MCP de la app (para la lista de Ajustes), con sus marcas de Tareas. */
  list(): TasksMcpInfo[] {
    let servers: Record<string, McpEntry> = {}
    try {
      servers = readAppMcpConfig().servers
    } catch (err) {
      console.error('[tasks] no se pudo leer la config MCP de la app:', err)
    }
    const flags = readFlags().servers
    return Object.entries(servers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => infoOf(name, entry, flags[name]))
  }

  set(name: string, patch: { tasks?: boolean; askEachTool?: boolean }): TasksMcpInfo[] {
    const servers = readAppMcpConfig().servers
    if (!(name in servers)) throw new Error(`No existe el conector "${name}".`)
    const data = readFlags()
    // Limpia marcas de servidores que ya no existen.
    for (const n of Object.keys(data.servers)) if (!(n in servers)) delete data.servers[n]
    const cur = data.servers[name] ?? { tasks: false, askEachTool: false }
    if (typeof patch.tasks === 'boolean') cur.tasks = patch.tasks
    if (typeof patch.askEachTool === 'boolean') cur.askEachTool = patch.askEachTool
    data.servers[name] = cur
    writeFlags(data)
    return this.list()
  }
}

export const tasksMcpPrefs = new TasksMcpPrefs()
