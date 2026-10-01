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
import { t } from '@shared/i18n'
import { app } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppMcpConfig, McpEntry, McpLocalEntry, McpRemoteEntry } from '@shared/ipc-extras'
import { MCP_NAME_RE as NAME_RE, mcpPermissionKey } from '@shared/mcp-catalog'

const SCHEMA = 'https://opencode.ai/config.json'

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
    throw new Error(t('merr.mcp.badJson', { path, detail: err instanceof Error ? err.message : String(err) }))
  }
  return { $schema: SCHEMA, mcp: {} }
}

function writeRaw(raw: RawConfig): void {
  const path = appOpencodeConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  // 0600: puede contener un token en las cabeceras de un servidor remoto (como en el flujo manual).
  writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  chmodSync(tmp, 0o600)
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

function mutate(fn: (mcp: Record<string, unknown>) => void, perm?: (permission: PermissionRaw) => void): AppMcpConfig {
  const raw = readRaw()
  const mcp: Record<string, unknown> = raw.mcp && typeof raw.mcp === 'object' && !Array.isArray(raw.mcp) ? { ...raw.mcp } : {}
  fn(mcp)
  const next: RawConfig = { $schema: SCHEMA, ...raw, mcp }
  if (perm) {
    const before = permissionObject(raw)
    const permission = { ...before }
    perm(permission)
    // Sin cambios no se reescribe la clave `permission` (ni se convierte una cadena en objeto).
    if (JSON.stringify(permission) !== JSON.stringify(before)) {
      if (Object.keys(permission).length) (next as Record<string, unknown>).permission = permission
      else delete (next as Record<string, unknown>).permission
    }
  }
  writeRaw(next)
  return readAppMcpConfig()
}

type PermissionRaw = Record<string, unknown>

/** `permission` como objeto (una cadena global equivale a `{"*": valor}`); no toca nada más. */
function permissionObject(raw: RawConfig): PermissionRaw {
  const cur = (raw as { permission?: unknown }).permission
  if (typeof cur === 'string') return { '*': cur }
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) return { ...(cur as PermissionRaw) }
  return {}
}

/** ¿El servidor tiene «Preguntar antes de cada uso» (`permission["<nombre>_*"] = "ask"`)? */
export function mcpAsksEachUse(name: string): boolean {
  return permissionObject(readRaw())[mcpPermissionKey(name)] === 'ask'
}

export function saveMcpServer(name: string, entry: McpEntry, previousName?: string, opts: { askEachUse?: boolean } = {}): AppMcpConfig {
  const clean = name.trim()
  if (!NAME_RE.test(clean)) {
    throw new Error(t('merr.mcp.invalidNameAlt'))
  }
  const valid = toEntry(entry)
  if (!valid) {
    throw new Error(entry.type === 'remote' ? t('merr.mcp.badUrl') : t('merr.mcp.noCommand'))
  }
  return mutate(
    (mcp) => {
      if (previousName && previousName !== clean) delete mcp[previousName]
      else if (!previousName && clean in mcp) throw new Error(t('merr.mcp.exists', { name: clean }))
      mcp[clean] = valid
    },
    (perm) => {
      // Al renombrar, la regla «ask» de la app se va con el servidor (si no, dejaría de preguntar sin avisar).
      if (previousName && previousName !== clean && perm[mcpPermissionKey(previousName)] === 'ask') {
        delete perm[mcpPermissionKey(previousName)]
        perm[mcpPermissionKey(clean)] = 'ask'
      }
      if (opts.askEachUse) perm[mcpPermissionKey(clean)] = 'ask'
    }
  )
}

export function removeMcpServer(name: string): AppMcpConfig {
  return mutate(
    (mcp) => {
      delete mcp[name]
    },
    // Solo se limpia lo que puso la app («ask»): una regla propia de la persona se respeta.
    (perm) => {
      if (perm[mcpPermissionKey(name)] === 'ask') delete perm[mcpPermissionKey(name)]
    }
  )
}

export function setMcpServerEnabled(name: string, enabled: boolean): AppMcpConfig {
  return mutate((mcp) => {
    const cur = mcp[name]
    if (!cur || typeof cur !== 'object') throw new Error(t('merr.mcp.missing', { name }))
    mcp[name] = { ...(cur as Record<string, unknown>), enabled }
  })
}
