/**
 * MCP del usuario disponibles en Cowork.
 *
 * Los servidores Cowork NO reciben `OPENCODE_CONFIG` (solo el sidecar lo tiene), así que sin esto
 * no habría ningún MCP del usuario dentro de Cowork. Aquí se leen los servidores que la app
 * administra (`readAppMcpConfig()`), se filtran los activos y marcados "Disponible en Cowork" y
 * se devuelven como bloque `mcp` para la config inline (`manager.inlineConfig`).
 *
 * Las marcas propias de Cowork viven en `userData/tasks-mcp.json`
 * (`{ servers: { <nombre>: { cowork, askEachTool } } }`). NUNCA se escribe en
 * `userData/opencode/opencode.json`: OpenCode valida ese archivo de forma estricta.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CoworkMcpInfo } from '@shared/ipc-tasks'
import type { McpEntry } from '@shared/ipc-extras'
import { readAppMcpConfig } from '../extras/mcp-config'
import { hostOf } from '../util/url'

export interface CoworkMcpContribution {
  /** Bloque `mcp` de OpenCode a inyectar. */
  mcp: Record<string, unknown>
  /** Permisos por herramienta (`"<servidor>_*": 'ask'`). */
  permission: Record<string, 'ask' | 'allow'>
  /** Hosts remotos a sumar a la lista blanca de red del sandbox. */
  hosts: string[]
}

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
export const MCP_ENV_WRAPPER: readonly string[] = [
  '/usr/bin/env',
  '-u',
  'OPENCODE_SERVER_PASSWORD',
  '-u',
  'OPENCODE_SERVER_USERNAME',
  '-u',
  'OPENCODE_AUTH_CONTENT',
  '-u',
  'OPENCODE_CONFIG_CONTENT',
  '-u',
  'ONYXCODE_PLAN_GATE_URL'
]

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

function infoOf(name: string, entry: McpEntry, flags: McpFlags | undefined): CoworkMcpInfo {
  const host = entry.type === 'remote' ? hostOf(entry.url) : null
  return {
    name,
    type: entry.type,
    enabled: entry.enabled !== false,
    tasks: flags?.tasks === true,
    askEachTool: flags?.askEachTool === true,
    hosts: host ? [host] : [],
    oauth: usesOAuth(entry)
  }
}

/**
 * Bloque `mcp`/`permission`/`hosts` a inyectar en un servidor Cowork. Solo entran los servidores
 * activos y marcados "Disponible en Cowork". Los hosts solo importan en sandbox (allowlist del proxy).
 */
export function coworkMcpContribution(opts: { sandboxed: boolean }): CoworkMcpContribution {
  const out: CoworkMcpContribution = { mcp: {}, permission: {}, hosts: [] }
  let servers: Record<string, McpEntry>
  try {
    servers = readAppMcpConfig().servers
  } catch (err) {
    console.error('[tasks] no se pudo leer la config MCP de la app:', err)
    return out
  }
  const flags = readFlags().servers
  const hosts = new Set<string>()
  for (const [name, entry] of Object.entries(servers)) {
    const f = flags[name]
    if (!f?.tasks || entry.enabled === false) continue
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
        ...(entry.oauth !== undefined ? { oauth: entry.oauth } : {}),
        enabled: true,
        ...(entry.timeout ? { timeout: entry.timeout } : {})
      }
      const host = hostOf(entry.url)
      if (host && opts.sandboxed) hosts.add(host)
    }
    if (f.askEachTool) out.permission[`${name}_*`] = 'ask'
  }
  out.hosts = [...hosts]
  return out
}

export class CoworkMcpPrefs {
  /** Todos los MCP de la app (para la lista de Ajustes), con sus marcas de Cowork. */
  list(): CoworkMcpInfo[] {
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

  set(name: string, patch: { tasks?: boolean; askEachTool?: boolean }): CoworkMcpInfo[] {
    const servers = readAppMcpConfig().servers
    if (!(name in servers)) throw new Error(`No existe el servidor MCP "${name}".`)
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

export const coworkMcpPrefs = new CoworkMcpPrefs()
