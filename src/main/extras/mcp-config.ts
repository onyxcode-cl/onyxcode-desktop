/**
 * Servidores MCP administrados por la app.
 *
 * Mecanismo (verificado contra opencode 1.18.32):
 * - La app es dueña de `userData/opencode/opencode.json`. El sidecar debe lanzarse con
 *   `OPENCODE_CONFIG=<ese archivo>` (ver `appOpencodeConfigEnv()`); OpenCode lo fusiona entre
 *   la config global (~/.config/opencode) y la del proyecto. NUNCA se toca la config global.
 * - `POST /mcp` (SDK `mcp.add`) sólo agrega en memoria: no persiste.
 * - Tras editar el archivo, `POST /global/dispose` (SDK `global.dispose`) hace que el servidor
 *   recargue la config sin reiniciar el proceso (las instancias se recrean en la siguiente
 *   petición; las respuestas en curso se interrumpen).
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppMcpConfig, McpEntry, McpLocalEntry, McpRemoteEntry } from '@shared/ipc-extras'

const SCHEMA = 'https://opencode.ai/config.json'
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

export function appOpencodeConfigPath(): string {
  return join(app.getPath('userData'), 'opencode', 'opencode.json')
}

/** Garantiza que el archivo exista (OpenCode falla si OPENCODE_CONFIG apunta a la nada). */
export function ensureAppOpencodeConfig(): string {
  const path = appOpencodeConfigPath()
  if (!existsSync(path)) writeRaw({ $schema: SCHEMA, mcp: {} })
  return path
}

/** Variables de entorno a añadir al `spawn` de `opencode serve`. */
export function appOpencodeConfigEnv(): { OPENCODE_CONFIG: string } {
  return { OPENCODE_CONFIG: ensureAppOpencodeConfig() }
}

type RawConfig = Record<string, unknown> & { mcp?: Record<string, unknown> }

function readRaw(): RawConfig {
  const path = appOpencodeConfigPath()
  if (!existsSync(path)) return { $schema: SCHEMA, mcp: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as RawConfig
  } catch (err) {
    throw new Error(`El archivo ${path} no es JSON válido: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { $schema: SCHEMA, mcp: {} }
}

function writeRaw(raw: RawConfig): void {
  const path = appOpencodeConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}

function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k.trim() && typeof val === 'string') out[k.trim()] = val
  }
  return Object.keys(out).length ? out : undefined
}

function toEntry(v: unknown): McpEntry | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const enabled = typeof o.enabled === 'boolean' ? o.enabled : undefined
  const timeout = typeof o.timeout === 'number' && o.timeout > 0 ? o.timeout : undefined
  if (o.type === 'local') {
    if (!Array.isArray(o.command)) return null
    const command = o.command.filter((c): c is string => typeof c === 'string')
    if (!command.length || !command[0].trim()) return null
    const e: McpLocalEntry = { type: 'local', command }
    const env = stringRecord(o.environment)
    if (env) e.environment = env
    if (typeof o.cwd === 'string' && o.cwd.trim()) e.cwd = o.cwd.trim()
    if (enabled !== undefined) e.enabled = enabled
    if (timeout !== undefined) e.timeout = timeout
    return e
  }
  if (o.type === 'remote') {
    if (typeof o.url !== 'string') return null
    let url: URL
    try {
      url = new URL(o.url.trim())
    } catch {
      return null
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const e: McpRemoteEntry = { type: 'remote', url: url.toString() }
    const headers = stringRecord(o.headers)
    if (headers) e.headers = headers
    if (enabled !== undefined) e.enabled = enabled
    if (timeout !== undefined) e.timeout = timeout
    if (o.oauth === false) e.oauth = false
    else if (o.oauth && typeof o.oauth === 'object') e.oauth = o.oauth as Record<string, string | number>
    return e
  }
  return null
}

export function readAppMcpConfig(): AppMcpConfig {
  const raw = readRaw()
  const servers: Record<string, McpEntry> = {}
  if (raw.mcp && typeof raw.mcp === 'object') {
    for (const [name, value] of Object.entries(raw.mcp)) {
      const e = toEntry(value)
      if (e) servers[name] = e
    }
  }
  return { path: appOpencodeConfigPath(), servers }
}

function mutate(fn: (mcp: Record<string, unknown>) => void): AppMcpConfig {
  const raw = readRaw()
  const mcp: Record<string, unknown> =
    raw.mcp && typeof raw.mcp === 'object' && !Array.isArray(raw.mcp) ? { ...raw.mcp } : {}
  fn(mcp)
  writeRaw({ $schema: SCHEMA, ...raw, mcp })
  return readAppMcpConfig()
}

export function saveMcpServer(name: string, entry: McpEntry, previousName?: string): AppMcpConfig {
  const clean = name.trim()
  if (!NAME_RE.test(clean)) {
    throw new Error('Nombre inválido: usa sólo letras, números, "-" o "_" (máx. 64).')
  }
  const valid = toEntry(entry)
  if (!valid) {
    throw new Error(
      entry.type === 'remote' ? 'URL inválida (debe ser http:// o https://).' : 'Falta el comando del servidor.'
    )
  }
  return mutate((mcp) => {
    if (previousName && previousName !== clean) delete mcp[previousName]
    else if (!previousName && clean in mcp) throw new Error(`Ya existe un servidor MCP llamado "${clean}".`)
    mcp[clean] = valid
  })
}

export function removeMcpServer(name: string): AppMcpConfig {
  return mutate((mcp) => {
    delete mcp[name]
  })
}

export function setMcpServerEnabled(name: string, enabled: boolean): AppMcpConfig {
  return mutate((mcp) => {
    const cur = mcp[name]
    if (!cur || typeof cur !== 'object') throw new Error(`No existe el servidor MCP "${name}".`)
    mcp[name] = { ...(cur as Record<string, unknown>), enabled }
  })
}
