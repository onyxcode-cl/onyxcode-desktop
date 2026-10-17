/**
 * Importar desde otras herramientas (Ajustes › Importar). Núcleo PURO de lectura y saneado: sin Electron, sin red y sin ejecutar nada.
 *
 * Reglas (docs/SEGURIDAD.md, «Importar»):
 * - Solo se lee lo que la persona eligió en el diálogo nativo (una carpeta de proyecto o un archivo de configuración MCP). Aquí no se
 *   escanea el disco: de la carpeta se miran nombres fijos (`AGENTS.md`, `CLAUDE.md`, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`).
 * - Archivos normales de hasta 256 KB; un enlace simbólico solo vale si su destino queda dentro de la carpeta elegida.
 * - Los secretos NUNCA se copian: las variables de entorno y las cabeceras de un servidor MCP se sustituyen por referencias por nombre
 *   (`{env:NOMBRE}`, que OpenCode resuelve al arrancar); un secreto en los argumentos, en la URL o en un texto de instrucciones
 *   descarta ese elemento. La vista previa no lleva ningún valor del archivo de origen.
 * - Lo que se importa como MCP queda DESACTIVADO (`enabled: false`) hasta que la persona lo active, y se valida con el mismo esquema
 *   estricto del alta manual (`mcpEntry` de `ipc/schemas.ts`) más las políticas de comandos de aquí.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import type { ImportItem, ImportReason, McpEntry } from '@shared/ipc-extras'
import { MCP_NAME_RE } from '@shared/mcp-catalog'
import { maskSecretPatterns } from '@shared/redact-patterns'
import { mcpEntry } from '../ipc/schemas'

/** Tamaño máximo de cualquier archivo que se lee para importar. */
export const IMPORT_MAX_BYTES = 256 * 1024
/** Igual que el tope de `AGENTS.md` en `tasks/projects.ts`. */
export const IMPORT_MAX_INSTRUCTION_CHARS = 200_000
const MAX_SERVERS = 100
const SUMMARY_MAX = 160

export class ImportError extends Error {
  constructor(
    readonly code: 'not-file' | 'too-big' | 'outside' | 'bad-json' | 'unsupported' | 'unreadable',
    message: string
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

/** Lo que main guarda de cada elemento hasta que la persona confirma (nunca viaja al renderer). */
export type ImportPayload =
  | { kind: 'mcp'; name: string; entry: McpEntry }
  | { kind: 'instructions'; folder: string; sourcePath: string; sha256: string; text: string; mode: 'create' | 'append'; label: string }

export interface ScannedItem {
  item: ImportItem
  payload: ImportPayload | null
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

export const hasSecret = (text: string): boolean => maskSecretPatterns(text) !== text

// ───────────────────────────── Lectura segura ─────────────────────────────

/**
 * Lee un archivo normal de texto. Con `within`, el destino real (tras `realpath`) debe quedar dentro de esa carpeta (un enlace
 * simbólico que sale de ella no se sigue). Sin `within` (archivo elegido por la persona), se lee el destino real del enlace.
 */
export function readImportFile(path: string, within?: string): { text: string; real: string } {
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    throw new ImportError('unreadable', 'unreadable')
  }
  if (within) {
    const rel = relative(within, real)
    if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..') || /^[A-Za-z]:/.test(rel) || rel.startsWith(sep)) {
      throw new ImportError('outside', 'outside')
    }
  }
  const st = statSync(real)
  if (!st.isFile()) throw new ImportError('not-file', 'not-file')
  if (st.size > IMPORT_MAX_BYTES) throw new ImportError('too-big', 'too-big')
  return { text: readFileSync(real, 'utf8').replace(/^﻿/, ''), real }
}

// ───────────────────────────── MCP ─────────────────────────────

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'csh', 'tcsh', 'ksh', 'ash', 'cmd', 'powershell', 'pwsh'])
const DANGEROUS = new Set([
  'sudo',
  'su',
  'doas',
  'rm',
  'rmdir',
  'del',
  'erase',
  'rd',
  'format',
  'mkfs',
  'dd',
  'shred',
  'chmod',
  'chown',
  'curl',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'socat',
  'telnet',
  'ssh',
  'scp',
  'sftp',
  'ftp',
  'osascript',
  'launchctl',
  'crontab',
  'eval',
  'source',
  'open',
  'reg',
  'regedit',
  'schtasks',
  'sc',
  'net',
  'netsh',
  'taskkill',
  'kill',
  'killall',
  'mount',
  'umount',
  'diskutil',
  'security',
  'defaults',
  'systemsetup',
  'bitsadmin',
  'certutil',
  'mshta',
  'rundll32',
  'wscript',
  'cscript',
  'msiexec',
  'at',
  'tmutil'
])
const LAUNCHERS = new Set([
  'npx',
  'npm',
  'pnpm',
  'pnpx',
  'yarn',
  'bunx',
  'bun',
  'node',
  'deno',
  'uvx',
  'uv',
  'python',
  'python3',
  'pipx',
  'docker',
  'podman',
  'java',
  'dotnet',
  'go',
  'cargo',
  'ruby',
  'php'
])
const SECRET_FLAG = /(key|token|secret|passw|credential|bearer|auth)/i
const SECRET_PARAM = /(key|token|secret|passw|auth|sig|credential)/i

const baseCommand = (cmd: string): string =>
  basename(cmd.replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1|sh)$/, '')

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Servidores definidos en un archivo de configuración conocido (`mcpServers`, `servers` de VS Code o `mcp` de OpenCode). */
export function parseMcpServers(text: string): Record<string, unknown> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ImportError('bad-json', 'bad-json')
  }
  if (!isRecord(json)) throw new ImportError('unsupported', 'unsupported')
  for (const key of ['mcpServers', 'servers', 'mcp']) {
    const v = json[key]
    if (isRecord(v)) return v
  }
  throw new ImportError('unsupported', 'unsupported')
}

const envNameFrom = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '') || 'VALOR'

/** Si el valor ya ES una referencia a una variable (no un secreto), devuelve su nombre. */
function referencedVar(value: string): string | null {
  const m =
    /^(?:\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)|\{env:([A-Za-z_][A-Za-z0-9_]*)\}|<([A-Za-z_][A-Za-z0-9_]*)>)$/.exec(
      value.trim()
    )
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? null) : null
}

/**
 * Pasa cada par clave/valor a una referencia por nombre. El valor original no se conserva en ninguna parte: solo la clave
 * (y, para una cabecera `Authorization`, el esquema `Bearer`/`Basic`).
 */
function referenceAll(bag: unknown, kind: 'env' | 'header', serverName: string, refs: Set<string>): Record<string, string> | undefined {
  if (!isRecord(bag)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(bag)) {
    const key = k.trim()
    if (!key || key.length > 200 || typeof v !== 'string') continue
    const existing = referencedVar(v)
    const name = existing ?? (kind === 'env' ? envNameFrom(key) : envNameFrom(`${serverName}_${key}`))
    refs.add(name)
    const scheme = kind === 'header' ? /^(Bearer|Basic)\s/i.exec(v)?.[1] : undefined
    out[key] = `${scheme ? `${scheme} ` : ''}{env:${name}}`
  }
  return Object.keys(out).length ? out : undefined
}

function shortSummary(parts: string[]): string {
  const s = parts.join(' ')
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s
}

function discarded(id: string, name: string, origin: string, summary: string, reasons: ImportReason[]): ScannedItem {
  return { item: { id, kind: 'mcp', name, origin, summary, status: 'discarded', reasons, envRefs: [] }, payload: null }
}

/** Convierte un servidor de otra herramienta en una entrada saneada y DESACTIVADA, o lo descarta con sus motivos. */
export function sanitizeMcpServer(id: string, rawName: string, raw: unknown, origin: string, taken: ReadonlySet<string>): ScannedItem {
  const reasons: ImportReason[] = []
  const name = rawName
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 64)
  if (!name || !MCP_NAME_RE.test(name)) return discarded(id, rawName.slice(0, 64) || '?', origin, '', [{ code: 'invalid-name' }])
  if (name !== rawName.trim()) reasons.push({ code: 'renamed', detail: name })
  if (taken.has(name)) return discarded(id, name, origin, '', [{ code: 'name-exists' }])
  if (!isRecord(raw)) return discarded(id, name, origin, '', [{ code: 'invalid-entry' }])

  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
  const url = typeof raw.url === 'string' ? raw.url : typeof raw.serverUrl === 'string' ? raw.serverUrl : null
  const wantsRemote =
    ['http', 'sse', 'streamable-http', 'streamable_http', 'remote'].includes(type) || (!type && url !== null && !raw.command)
  const wantsLocal = ['stdio', 'local'].includes(type) || (!type && raw.command !== undefined)
  const refs = new Set<string>()
  let entry: McpEntry

  if (wantsRemote) {
    if (url === null) return discarded(id, name, origin, '', [{ code: 'invalid-entry' }])
    let u: URL
    try {
      u = new URL(url.trim())
    } catch {
      return discarded(id, name, origin, '', [{ code: 'invalid-entry' }])
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return discarded(id, name, origin, '', [{ code: 'invalid-entry' }])
    const shown = `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`
    if (u.username || u.password) return discarded(id, name, origin, shortSummary([shown]), [{ code: 'url-credentials' }])
    const secretParam = [...u.searchParams.keys()].find((k) => SECRET_PARAM.test(k))
    if (secretParam || hasSecret(u.toString())) {
      return discarded(id, name, origin, shortSummary([shown]), [{ code: 'secret-in-url', detail: secretParam }])
    }
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) reasons.push({ code: 'insecure-http' })
    const headers = referenceAll(raw.headers, 'header', name, refs)
    entry = { type: 'remote', url: u.toString(), enabled: false }
    if (headers) entry.headers = headers
    if (typeof raw.timeout === 'number' && raw.timeout > 0 && raw.timeout <= 3_600_000) entry.timeout = raw.timeout
    if (raw.oauth === false) entry.oauth = false
    const summary = shortSummary([shown])
    return finish(id, name, origin, summary, entry, reasons, refs, raw.headers)
  }

  if (!wantsLocal) return discarded(id, name, origin, '', [{ code: 'unsupported-type', detail: type || undefined }])

  // Local: `command` + `args` (formato habitual) o `command` como lista (OpenCode).
  let command: string[]
  if (Array.isArray(raw.command)) command = raw.command.filter((c): c is string => typeof c === 'string')
  else if (typeof raw.command === 'string') {
    command = [raw.command, ...(Array.isArray(raw.args) ? raw.args.filter((c): c is string => typeof c === 'string') : [])]
  } else command = []
  if (command.length === 0 || !command[0].trim()) return discarded(id, name, origin, '', [{ code: 'invalid-entry' }])
  const rest = command.slice(1)
  const isLeak = (a: string, i: number): boolean =>
    hasSecret(a) ||
    (/^--?[\w-]+$/.test(rest[i - 1] ?? '') && SECRET_FLAG.test(rest[i - 1] ?? '') && !referencedVar(a) && !a.startsWith('-'))
  // El resumen que ve la persona (también el de lo descartado) jamás lleva un argumento que parezca un secreto.
  const summary = shortSummary([command[0], ...rest.map((a, i) => (isLeak(a, i) ? '…' : maskSecretPatterns(a)))])
  const bin = baseCommand(command[0])

  if (SHELLS.has(bin)) {
    // `cmd /c npx …` es la forma habitual de lanzar npx en Windows: se admite solo si lo que sigue es un lanzador conocido.
    const inner = bin === 'cmd' && /^\/[ck]$/i.test(command[1] ?? '') ? baseCommand(command[2] ?? '') : ''
    if (!LAUNCHERS.has(inner)) return discarded(id, name, origin, summary, [{ code: 'shell-wrapper', detail: bin }])
  } else if (DANGEROUS.has(bin)) {
    return discarded(id, name, origin, summary, [{ code: 'dangerous-command', detail: bin }])
  }
  if (rest.some((a) => /[|;`\n\r]|\$\(|&&|\|\|/.test(a))) return discarded(id, name, origin, summary, [{ code: 'shell-metachar' }])
  const leak = rest.findIndex(isLeak)
  if (leak >= 0) return discarded(id, name, origin, summary, [{ code: 'secret-in-args', detail: String(leak + 1) }])
  if (!LAUNCHERS.has(bin) && !SHELLS.has(bin)) reasons.push({ code: 'unknown-command', detail: bin })

  const environment = referenceAll(raw.env ?? raw.environment, 'env', name, refs)
  entry = { type: 'local', command, enabled: false }
  if (environment) entry.environment = environment
  if (typeof raw.timeout === 'number' && raw.timeout > 0 && raw.timeout <= 3_600_000) entry.timeout = raw.timeout
  if (typeof raw.cwd === 'string' && raw.cwd.trim()) reasons.push({ code: 'cwd-dropped' })
  return finish(id, name, origin, summary, entry, reasons, refs, raw.env ?? raw.environment)
}

function finish(
  id: string,
  name: string,
  origin: string,
  summary: string,
  entry: McpEntry,
  reasons: ImportReason[],
  refs: Set<string>,
  sourceBag: unknown
): ScannedItem {
  // Mismo esquema estricto del alta manual: si no pasa, se descarta.
  try {
    mcpEntry(entry)
  } catch {
    return discarded(id, name, origin, summary, [{ code: 'invalid-entry' }])
  }
  if (isRecord(sourceBag) && Object.keys(sourceBag).length > 0)
    reasons.push({ code: 'values-referenced', detail: [...refs].slice(0, 20).join(', ') })
  return {
    item: { id, kind: 'mcp', name, origin, summary, status: 'ok', reasons, envRefs: [...refs].slice(0, 50) },
    payload: { kind: 'mcp', name, entry }
  }
}

/** Todos los servidores de un archivo ya leído. `taken`: nombres que ya existen en Lazunox. */
export function scanMcpText(text: string, origin: string, taken: ReadonlySet<string>, idStart = 0): ScannedItem[] {
  const servers = parseMcpServers(text)
  const used = new Set(taken)
  const out: ScannedItem[] = []
  let n = idStart
  for (const [rawName, raw] of Object.entries(servers).slice(0, MAX_SERVERS)) {
    const scanned = sanitizeMcpServer(`m${n++}`, rawName, raw, origin, used)
    if (scanned.payload?.kind === 'mcp') used.add(scanned.payload.name)
    out.push(scanned)
  }
  return out
}

// ───────────────────────────── Instrucciones ─────────────────────────────

/** Números de línea (1-based) que parecen llevar una clave o un token. */
export function secretLines(text: string): number[] {
  const lines: number[] = []
  text.split(/\r?\n/).forEach((l, i) => {
    if (hasSecret(l)) lines.push(i + 1)
  })
  return lines
}

export interface FolderScan {
  items: ScannedItem[]
  /** Archivos conocidos que no se pudieron leer (enlace que sale, demasiado grande…), con el código. */
  unreadable: { file: string; code: ImportError['code'] }[]
}

/**
 * Mira, en la carpeta elegida, solo los nombres fijos. `folder` ya viene validado (existe, no es el home ni la raíz). `existingNames`:
 * servidores MCP que ya tiene Lazunox.
 */
export function scanProjectFolder(folder: string, existingNames: ReadonlySet<string>): FolderScan {
  const items: ScannedItem[] = []
  const unreadable: FolderScan['unreadable'] = []
  const read = (rel: string): { text: string; real: string } | null => {
    const p = join(folder, rel)
    if (!existsSync(p) && !isDanglingLink(p)) return null
    try {
      return readImportFile(p, folder)
    } catch (err) {
      unreadable.push({ file: rel, code: err instanceof ImportError ? err.code : 'unreadable' })
      return null
    }
  }

  // Instrucciones: Lazunox/OpenCode lee `AGENTS.md`; `CLAUDE.md` de otra herramienta se ofrece como `AGENTS.md`.
  const agents = read('AGENTS.md')
  const claude = read('CLAUDE.md')
  const agentsPath = join(folder, 'AGENTS.md')
  if (agents) {
    items.push({
      item: {
        id: 'i0',
        kind: 'instructions',
        name: 'AGENTS.md',
        origin: 'AGENTS.md',
        summary: '',
        status: 'discarded',
        reasons: [{ code: 'already-native' }],
        envRefs: []
      },
      payload: null
    })
  }
  if (claude) {
    const id = `i${items.length}`
    const base = { id, kind: 'instructions' as const, name: 'CLAUDE.md', origin: 'CLAUDE.md', envRefs: [] }
    const trimmed = claude.text.trim()
    const lines = secretLines(claude.text)
    if (!trimmed) items.push({ item: { ...base, summary: '', status: 'discarded', reasons: [{ code: 'empty' }] }, payload: null })
    else if (claude.text.length > IMPORT_MAX_INSTRUCTION_CHARS)
      items.push({ item: { ...base, summary: '', status: 'discarded', reasons: [{ code: 'too-big' }] }, payload: null })
    else if (lines.length > 0)
      items.push({
        item: { ...base, summary: '', status: 'discarded', reasons: [{ code: 'secret-in-text', detail: lines.slice(0, 8).join(', ') }] },
        payload: null
      })
    else if (/^@\.?\/?AGENTS\.md\s*$/m.test(trimmed) && trimmed.split(/\r?\n/).filter((l) => l.trim()).length === 1)
      items.push({ item: { ...base, summary: '', status: 'discarded', reasons: [{ code: 'refs-agents' }] }, payload: null })
    else if (agents && agents.text.trim() === trimmed)
      items.push({ item: { ...base, summary: '', status: 'discarded', reasons: [{ code: 'same-content' }] }, payload: null })
    else {
      const mode = agents ? ('append' as const) : ('create' as const)
      items.push({
        item: {
          ...base,
          summary: shortSummary([trimmed.replace(/\s+/g, ' ')]),
          status: 'ok',
          reasons: mode === 'append' ? [{ code: 'append' }] : []
        },
        payload: {
          kind: 'instructions',
          folder,
          sourcePath: claude.real,
          sha256: sha256(claude.text),
          text: claude.text,
          mode,
          label: agentsPath
        }
      })
    }
  }

  // MCP: archivos de configuración habituales dentro de la carpeta elegida.
  const taken = new Set(existingNames)
  let n = 0
  for (const rel of ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json']) {
    const f = read(rel)
    if (!f) continue
    try {
      for (const s of scanMcpText(f.text, rel, taken, n)) {
        n++
        if (s.payload?.kind === 'mcp') taken.add(s.payload.name)
        items.push(s)
      }
    } catch (err) {
      unreadable.push({ file: rel, code: err instanceof ImportError ? err.code : 'unreadable' })
    }
  }
  return { items, unreadable }
}

function isDanglingLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/** Texto final de `AGENTS.md` al importar. */
export function composeInstructions(mode: 'create' | 'append', existing: string, imported: string): string {
  if (mode === 'create') return imported
  return `${existing.replace(/\s+$/, '')}\n\n## Importado de CLAUDE.md\n\n${imported.replace(/^\s+/, '')}`
}
