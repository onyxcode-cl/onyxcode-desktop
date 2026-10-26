import { dialog, type IpcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { t } from '@shared/i18n'
import {
  buildHelperFile,
  checkHelperName,
  claudeAgentLabel,
  HELPER_LIMITS,
  parseHelperList,
  readHelperFile,
  validateHelperDef,
  type ForeignAgentsResult,
  type HelperDef,
  type HelperOrigin,
  type HelperReadResult,
  type HelperView,
  type HelperSaveResult,
  type HelpersListResult
} from '@shared/helper-agents'
import type { OpencodeConnection } from '@shared/types'
import type { OpencodeServer } from '../opencode/server'
import { settingsStore } from '../store'
import { handle, IpcError } from './handle'
import { windowOfSender } from './sender-window'

/**
 * Pantalla «Ayudantes» (Ajustes): lista de `GET /agent` (fetch crudo, como `engine-jobs.ts`) y edición del `.md` de
 * `.opencode/agents/` de la carpeta elegida por la persona. Contrato: `LAZUNOX.md` «Subagentes definidos por el usuario (2A)».
 *
 * Seguridad (docs/SEGURIDAD.md): se escribe SOLO `<carpeta elegida>/.opencode/agents/<nombre>.md`; la carpeta debe ser una que la persona
 * eligió con el diálogo del sistema (o una carpeta reciente de Code); el nombre cumple `^[A-Za-z0-9][A-Za-z0-9._-]*$` y no es reservado;
 * ni `.opencode`, ni `agents`, ni el archivo pueden ser enlaces simbólicos; el archivo nuevo se crea con exclusividad (`wx`) y el editado
 * se reemplaza con un temporal + `rename`. Los permisos de un ayudante los acota el motor (nunca superan los de la sesión que lo lanza).
 */

type Conn = Pick<OpencodeConnection, 'baseUrl' | 'authorization'>
type FetchLike = typeof fetch

const TIMEOUT_MS = 4000
const MAX_CLAUDE_DEPTH = 3

export interface HelperDeps {
  conn: () => Conn | null
  recentFolders: () => string[]
  fetchImpl?: FetchLike
}

/** Carpetas elegidas con el diálogo en esta ejecución (rutas reales). */
const picked = new Set<string>()

/** Ruta real de una carpeta que la persona eligió (diálogo o reciente de Code); `null` si no lo es o no existe. */
export async function resolveHelperFolder(dir: string, recent: readonly string[]): Promise<string | null> {
  if (typeof dir !== 'string' || !isAbsolute(dir)) return null
  let real: string
  try {
    real = await realpath(dir)
    if (!(await lstat(real)).isDirectory()) return null
  } catch {
    return null
  }
  if (picked.has(real)) return real
  for (const r of recent) {
    try {
      if ((await realpath(r)) === real) return real
    } catch {
      // carpeta reciente que ya no existe
    }
  }
  return null
}

/** Marca una carpeta como elegida (la usa el diálogo; también las pruebas). */
export async function rememberPickedFolder(dir: string): Promise<string | null> {
  try {
    const real = await realpath(dir)
    if (!(await lstat(real)).isDirectory()) return null
    picked.add(real)
    return real
  } catch {
    return null
  }
}

export function forgetPickedFoldersForTests(): void {
  picked.clear()
}

type DirState = 'ok' | 'missing' | 'link'

async function dirState(path: string): Promise<DirState> {
  try {
    const st = await lstat(path)
    if (st.isSymbolicLink() || !st.isDirectory()) return 'link'
    return 'ok'
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'link'
  }
}

/** `<raíz>/.opencode/agents` sin enlaces; con `create` crea lo que falte (nivel a nivel). */
async function agentsDir(root: string, create: boolean): Promise<{ ok: true; dir: string } | { ok: false; reason: 'missing' | 'link' }> {
  let cur = root
  for (const seg of ['.opencode', 'agents']) {
    cur = join(cur, seg)
    const st = await dirState(cur)
    if (st === 'link') return { ok: false, reason: 'link' }
    if (st === 'missing') {
      if (!create) return { ok: false, reason: 'missing' }
      try {
        await mkdir(cur)
      } catch {
        return { ok: false, reason: 'link' }
      }
      if ((await dirState(cur)) !== 'ok') return { ok: false, reason: 'link' }
    }
  }
  return { ok: true, dir: cur }
}

/** Nombres (sin `.md`) de los `.md` regulares de una carpeta, sin entrar en enlaces. */
async function mdNames(dir: string, depth: number, out: Set<string>): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.size >= HELPER_LIMITS.claudeScan) return
    if (e.isSymbolicLink()) continue
    if (e.isFile()) {
      const label = claudeAgentLabel(e.name)
      if (label) out.add(label)
    } else if (e.isDirectory() && depth < MAX_CLAUDE_DEPTH) {
      await mdNames(join(dir, e.name), depth + 1, out)
    }
  }
}

/** Nombres de los ayudantes en `<raíz>/.claude/agents` (lectura; la carpeta no se modifica nunca). */
export async function claudeAgentNames(root: string): Promise<string[]> {
  const base = join(root, '.claude')
  if ((await dirState(base)) !== 'ok') return []
  const dir = join(base, 'agents')
  if ((await dirState(dir)) !== 'ok') return []
  const out = new Set<string>()
  await mdNames(dir, 0, out)
  return [...out]
}

async function opencodeNames(root: string): Promise<Set<string>> {
  const a = await agentsDir(root, false)
  const out = new Set<string>()
  if (!a.ok) return out
  let entries
  try {
    entries = await readdir(a.dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries)
    if (e.isFile() && !e.isSymbolicLink()) {
      const label = claudeAgentLabel(e.name)
      if (label) out.add(label)
    }
  return out
}

/**
 * Ayudantes de `.opencode/agents/` que el motor aún no cargó (guarda en memoria lo que leyó de la carpeta): se leen del disco con las
 * mismas protecciones que la escritura (nombre válido, sin enlaces, tope de tamaño). Solo texto plano para la pantalla.
 */
async function pendingHelpers(root: string, known: ReadonlySet<string>): Promise<HelperView[]> {
  const a = await agentsDir(root, false)
  if (!a.ok) return []
  let entries
  try {
    entries = await readdir(a.dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: HelperView[] = []
  for (const e of entries.sort((x, y) => (x.name < y.name ? -1 : 1))) {
    if (out.length >= HELPER_LIMITS.claudeScan) break
    if (!e.isFile() || e.isSymbolicLink()) continue
    const name = claudeAgentLabel(e.name)
    if (!name || known.has(name) || !checkHelperName(name).ok) continue
    const file = join(a.dir, e.name)
    try {
      const st = await lstat(file)
      if (st.isSymbolicLink() || !st.isFile() || st.size > HELPER_LIMITS.fileBytes) continue
      const r = readHelperFile(name, await readFile(file, 'utf8'))
      const def = r.ok ? r.def : null
      out.push({
        name,
        description: def?.description ?? '',
        model: def?.model ?? 'inherit',
        maxTurns: def?.maxTurns ?? null,
        background: def?.background ?? false,
        skills: def?.skills ?? null,
        allowedTools: def?.allowedTools ?? [],
        blockedTools: def?.disallowedTools ?? [],
        whitelist: (def?.allowedTools.length ?? 0) > 0,
        native: false,
        origin: 'opencode',
        editable: true,
        pending: true
      })
    } catch {
      // ilegible: se ignora
    }
  }
  return out
}

export async function listHelpers(deps: HelperDeps, req: { directory: string }): Promise<HelpersListResult> {
  const root = await resolveHelperFolder(req.directory, deps.recentFolders())
  if (!root) throw new IpcError('FORBIDDEN', 'Carpeta no permitida')
  const conn = deps.conn()
  if (!conn) throw new IpcError('NOT_READY', 'El motor aún no está listo')
  const doFetch = deps.fetchImpl ?? fetch
  const res = await doFetch(`${conn.baseUrl}/agent?directory=${encodeURIComponent(root)}`, {
    headers: { Authorization: conn.authorization },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status === 404 || res.status === 405) return { available: false }
  if (!res.ok) throw new Error(`El motor respondió ${res.status}`)
  const infos = parseHelperList(await res.json().catch(() => null))
  const [own, claude] = await Promise.all([opencodeNames(root), claudeAgentNames(root)])
  const claudeSet = new Set(claude)
  const helpers = infos.map((h) => {
    const origin: HelperOrigin = h.native ? 'native' : own.has(h.name) ? 'opencode' : claudeSet.has(h.name) ? 'claude' : 'other'
    return { ...h, origin, editable: origin === 'opencode' && checkHelperName(h.name).ok }
  })
  const known = new Set(helpers.map((h) => h.name))
  const pending = await pendingHelpers(root, known)
  return { available: true, helpers: [...helpers, ...pending], claudeNames: claude }
}

export async function readHelper(deps: HelperDeps, req: { directory: string; name: string }): Promise<HelperReadResult> {
  const root = await resolveHelperFolder(req.directory, deps.recentFolders())
  if (!root) return { ok: false, reason: 'folder' }
  if (!checkHelperName(req.name).ok) return { ok: false, reason: 'name' }
  const a = await agentsDir(root, false)
  if (!a.ok) return { ok: false, reason: 'missing' }
  const file = join(a.dir, `${req.name}.md`)
  try {
    const st = await lstat(file)
    if (st.isSymbolicLink() || !st.isFile()) return { ok: false, reason: 'missing' }
    if (st.size > HELPER_LIMITS.fileBytes) return { ok: false, reason: 'too_big' }
    const r = readHelperFile(req.name, await readFile(file, 'utf8'))
    if (r.ok) return { ok: true, def: r.def }
    return { ok: false, reason: r.reason === 'name' ? 'name' : r.reason, ...(r.complex ? { complex: r.complex } : {}) }
  } catch {
    return { ok: false, reason: 'missing' }
  }
}

export async function saveHelper(
  deps: HelperDeps,
  req: { directory: string; def: HelperDef; mode: 'create' | 'edit' }
): Promise<HelperSaveResult> {
  const root = await resolveHelperFolder(req.directory, deps.recentFolders())
  if (!root) return { ok: false, reason: 'folder' }
  const nameCheck = checkHelperName(req.def.name)
  if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason === 'reserved' ? 'reserved' : 'name' }
  const valid = validateHelperDef(req.def)
  if (!valid.ok) return { ok: false, reason: 'invalid', field: valid.field }

  const a = await agentsDir(root, req.mode === 'create')
  if (!a.ok) return { ok: false, reason: a.reason === 'link' ? 'link' : 'missing' }
  const file = join(a.dir, `${req.def.name}.md`)

  let existing: string | undefined
  try {
    const st = await lstat(file)
    if (st.isSymbolicLink() || !st.isFile()) return { ok: false, reason: 'link' }
    if (req.mode === 'create') return { ok: false, reason: 'exists' }
    if (st.size > HELPER_LIMITS.fileBytes) return { ok: false, reason: 'format' }
    existing = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, reason: 'io' }
    if (req.mode === 'edit') return { ok: false, reason: 'missing' }
  }

  if (existing !== undefined) {
    // Si el archivo tiene claves gestionadas en un formato que la pantalla no entiende, no se reescribe (se perdería algo).
    const r = readHelperFile(req.def.name, existing)
    if (!r.ok) return { ok: false, reason: r.reason === 'complex' ? 'complex' : 'format' }
  }
  const text = buildHelperFile(req.def, existing)
  if (text === null) return { ok: false, reason: 'format' }
  if (Buffer.byteLength(text, 'utf8') > HELPER_LIMITS.fileBytes) return { ok: false, reason: 'invalid', field: 'prompt' }

  try {
    if (existing === undefined) {
      // Creación exclusiva: falla si algo (incluido un enlace) ya ocupa el nombre.
      await writeFile(file, text, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
    } else {
      const tmp = join(a.dir, `.${req.def.name}.${randomBytes(6).toString('hex')}.tmp`)
      try {
        await writeFile(tmp, text, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
        await rename(tmp, file)
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => undefined)
        throw e
      }
    }
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'EEXIST' ? 'exists' : 'io' }
  }
  return { ok: true }
}

export async function inspectForeignAgents(dir: string): Promise<ForeignAgentsResult> {
  if (typeof dir !== 'string' || !isAbsolute(dir)) return { names: [] }
  try {
    const real = await realpath(dir)
    if (!(await lstat(real)).isDirectory()) return { names: [] }
    return { names: await claudeAgentNames(real) }
  } catch {
    return { names: [] }
  }
}

export function registerHelperAgentsHandlers(ipcMain: IpcMain, server: OpencodeServer): void {
  const deps: HelperDeps = {
    conn: () => server.getConnection() ?? null,
    recentFolders: () => settingsStore.get().recentFolders
  }
  handle(ipcMain, 'helpers:pickFolder', async (_req, event) => {
    const win = windowOfSender(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: t('merr.dialog.pickFolder'),
      buttonLabel: t('merr.dialog.pick'),
      properties: ['openDirectory']
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return null
    return rememberPickedFolder(res.filePaths[0])
  })
  handle(ipcMain, 'helpers:list', (req) => listHelpers(deps, req))
  handle(ipcMain, 'helpers:read', (req) => readHelper(deps, req))
  handle(ipcMain, 'helpers:save', (req) => saveHelper(deps, req))
  handle(ipcMain, 'helpers:inspectForeign', (req) => inspectForeignAgents(req.directory))
}
