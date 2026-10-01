/**
 * Instalación de servidores del catálogo MCP curado (F8-B24).
 *
 * - `buildCatalogEntry` construye la entrada de `opencode.json` desde la copia del catálogo que lleva main;
 *   el renderer solo manda id, nombre y valores de las entradas del formulario.
 * - La procedencia (qué servidor vino de qué ficha, versión y URL) vive en `userData/mcp-catalog-installs.json`
 *   (0600), NO como claves nuevas dentro de `opencode.json` (OpenCode podría rechazarlas).
 * - `computeInstalled` detecta el desvío: si la URL, el tipo o las cabeceras ya no son las que instaló el catálogo,
 *   el servidor se marca «modificado».
 */
import { t } from '@shared/i18n'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppMcpConfig, McpEntry, McpRemoteEntry } from '@shared/ipc-extras'
import {
  findCatalogItem,
  MCP_CATALOG,
  MCP_CATALOG_VERSION,
  MCP_NAME_RE,
  type McpCatalogItem,
  type McpCatalogProvenance,
  type McpCatalogState
} from '@shared/mcp-catalog'
import { removeMcpServer, saveMcpServer } from './mcp-config'

/** Nombres de cabecera que el catálogo coloca (para comparar el desvío). */
const headerNames = (item: McpCatalogItem): string[] => item.inputs.map((i) => i.target.header).sort()

export function validateCatalogName(name: string): string {
  const clean = name.trim()
  if (!MCP_NAME_RE.test(clean)) throw new Error(t('merr.mcp.invalidName'))
  return clean
}

/**
 * Construye la entrada remota. Valida cada valor contra el patrón de la ficha y rechaza CR/LF (inyección de cabeceras).
 * Token y sin credencial llevan `oauth:false` (no se intenta inicio de sesión); OAuth deja la autodetección.
 */
export function buildCatalogEntry(item: McpCatalogItem, inputs: Record<string, string>, enable = true): McpRemoteEntry {
  if (item.transport !== 'remote') throw new Error(t('merr.mcp.remoteOnly'))
  const known = new Set(item.inputs.map((i) => i.id))
  for (const key of Object.keys(inputs)) if (!known.has(key)) throw new Error(t('merr.mcp.unknownInput', { key }))
  const headers: Record<string, string> = {}
  for (const input of item.inputs) {
    const value = inputs[input.id]
    if (typeof value !== 'string' || value === '') throw new Error(t('merr.mcp.missingInput', { label: input.label }))
    if (/[\r\n\0]/.test(value)) throw new Error(t('merr.mcp.noNewlines', { label: input.label }))
    if (value.length > input.maxLength) throw new Error(t('merr.mcp.tooLong', { label: input.label }))
    if (!new RegExp(input.pattern).test(value)) throw new Error(t('merr.mcp.badFormat', { label: input.label }))
    // Función de reemplazo: un `$&` en el valor no se interpreta.
    headers[input.target.header] = input.target.template.replace('{value}', () => value)
  }
  const entry: McpRemoteEntry = { type: 'remote', url: item.url, enabled: enable }
  if (Object.keys(headers).length) entry.headers = headers
  if (item.auth !== 'oauth') entry.oauth = false
  return entry
}

// ---- procedencia ----

export type ProvenanceMap = Record<string, McpCatalogProvenance>

function isProvenance(v: unknown): v is McpCatalogProvenance {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.catalogId === 'string' && typeof o.version === 'number' && typeof o.installedAt === 'number' && typeof o.url === 'string'
}

export class CatalogProvenanceStore {
  constructor(private readonly path: string) {}

  read(): ProvenanceMap {
    if (!existsSync(this.path)) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const out: ProvenanceMap = {}
      for (const [name, v] of Object.entries(parsed as Record<string, unknown>)) if (isProvenance(v)) out[name] = v
      return out
    } catch {
      return {}
    }
  }

  private write(map: ProvenanceMap): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, this.path)
  }

  record(name: string, item: McpCatalogItem, now = Date.now()): void {
    const map = this.read()
    map[name] = { catalogId: item.id, version: MCP_CATALOG_VERSION, installedAt: now, url: item.url }
    this.write(map)
  }

  forget(name: string): void {
    const map = this.read()
    if (!(name in map)) return
    delete map[name]
    this.write(map)
  }

  rename(from: string, to: string): void {
    const map = this.read()
    if (!(from in map) || from === to) return
    map[to] = map[from]
    delete map[from]
    this.write(map)
  }
}

/** ¿La entrada actual sigue siendo la que instaló la ficha? (los valores secretos no se comparan). */
export function entryDrifted(item: McpCatalogItem | undefined, prov: McpCatalogProvenance, entry: McpEntry | undefined): boolean {
  if (!item || !entry || entry.type !== 'remote') return true
  if (entry.url !== prov.url || entry.url !== item.url) return true
  const names = Object.keys(entry.headers ?? {}).sort()
  const expected = headerNames(item)
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) return true
  if (item.auth === 'oauth' ? entry.oauth !== undefined : entry.oauth !== false) return true
  return false
}

export function computeInstalled(prov: ProvenanceMap, cfg: AppMcpConfig): McpCatalogState['installed'] {
  const out: McpCatalogState['installed'] = {}
  for (const [name, p] of Object.entries(prov)) {
    const entry = cfg.servers[name]
    if (!entry) continue // el servidor ya no está en el archivo: la procedencia quedó huérfana
    out[name] = { catalogId: p.catalogId, drift: entryDrifted(findCatalogItem(p.catalogId), p, entry) }
  }
  return out
}

export function catalogState(prov: ProvenanceMap, cfg: AppMcpConfig): McpCatalogState {
  return { items: [...MCP_CATALOG], installed: computeInstalled(prov, cfg) }
}

export interface InstallCatalogRequest {
  id: string
  name: string
  inputs: Record<string, string>
  enable: boolean
  askEachUse: boolean
}

/**
 * Valida, escribe el servidor (un nombre repetido es error: nunca se pisa) y anota la procedencia.
 * Si la procedencia no se puede guardar, se deshace la escritura para no dejar un servidor «sin origen».
 * No recarga el servidor de OpenCode: eso lo hace el handler (`afterMcpChange`).
 */
export function installFromCatalog(store: CatalogProvenanceStore, req: InstallCatalogRequest): AppMcpConfig {
  const item = findCatalogItem(req.id)
  if (!item) throw new Error(t('merr.mcp.notInCatalog'))
  const name = validateCatalogName(req.name)
  const entry = buildCatalogEntry(item, req.inputs, req.enable)
  const cfg = saveMcpServer(name, entry, undefined, { askEachUse: req.askEachUse })
  try {
    store.record(name, item)
  } catch (err) {
    removeMcpServer(name)
    throw err
  }
  return cfg
}
