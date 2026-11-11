/**
 * "Proyecto" de Tareas por carpeta: nombre + instrucciones + enlaces + interruptor de memoria, persistidos en
 * `userData/tasks-projects.json`. La memoria (notas que el agente guarda entre tareas) vive
 * aparte, como archivo de texto dentro de la propia carpeta (`.lazunox/memoria.md`), para que el
 * usuario pueda verla/editarla con cualquier editor y viaje con la carpeta.
 */
import { getLang, t } from '@shared/i18n'
import { app } from 'electron'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isInside } from '../util/paths'
import { ensureRealDir, LinkRefusedError, readFileNoFollow, writeFileNoFollow } from './no-follow'
import type { TasksAgentsMd, TasksMemory, TasksProject } from '@shared/ipc-tasks'
import { TASKS_INSTRUCTIONS_MAX } from '@shared/tasks-prompt'

interface Persisted {
  projects: TasksProject[]
}

const MAX_INSTRUCTIONS = TASKS_INSTRUCTIONS_MAX
const MAX_NAME = 200
const MAX_LINKS = 50
const MAX_LINK_LENGTH = 2048
const AGENTS_MD_MAX_CHARS = 200_000
const MEMORY_MAX_BYTES = 2 * 1024 * 1024

export class TasksProjectsStore {
  private data: Persisted | null = null

  private get file(): string {
    return join(app.getPath('userData'), 'tasks-projects.json')
  }

  private load(): Persisted {
    if (this.data) return this.data
    let data: Persisted = { projects: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        if (Array.isArray(raw.projects)) {
          data.projects = raw.projects.filter((p): p is TasksProject => !!p && typeof p.folder === 'string' && typeof p.name === 'string')
        }
      }
    } catch (err) {
      console.error('[tasks] tasks-projects.json inválido:', err)
      data = { projects: [] }
    }
    this.data = data
    return data
  }

  private persist(): void {
    const file = this.file
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(this.load(), null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  /** Devuelve el proyecto de la carpeta (con valores por defecto si aún no se guardó nada). */
  get(folder: string): TasksProject {
    const existing = this.load().projects.find((p) => p.folder === folder)
    if (existing) return existing
    const now = Date.now()
    return { folder, name: basename(folder), instructions: '', createdAt: now, updatedAt: now }
  }

  save(folder: string, patch: { name?: string; instructions?: string; links?: string[]; memoryEnabled?: boolean }): TasksProject {
    const data = this.load()
    const now = Date.now()
    let entry = data.projects.find((p) => p.folder === folder)
    if (!entry) {
      entry = { folder, name: basename(folder), instructions: '', createdAt: now, updatedAt: now }
      data.projects.push(entry)
    }
    if (typeof patch.name === 'string') {
      const trimmed = patch.name.trim().slice(0, MAX_NAME)
      entry.name = trimmed || basename(folder)
    }
    if (typeof patch.instructions === 'string') entry.instructions = patch.instructions.slice(0, MAX_INSTRUCTIONS)
    if (Array.isArray(patch.links)) entry.links = sanitizeLinks(patch.links)
    if (typeof patch.memoryEnabled === 'boolean') entry.memoryEnabled = patch.memoryEnabled
    entry.updatedAt = now
    this.persist()
    return entry
  }

  remove(folder: string): void {
    const data = this.load()
    const before = data.projects.length
    data.projects = data.projects.filter((p) => p.folder !== folder)
    if (data.projects.length !== before) this.persist()
  }
}

/** Enlaces de referencia: solo http(s) válidos, sin duplicados, máx. 50. Descarta el resto. */
export function sanitizeLinks(input: readonly unknown[]): string[] {
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const link = raw.trim()
    if (!link || link.length > MAX_LINK_LENGTH) continue
    let url: URL
    try {
      url = new URL(link)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    if (!out.includes(link)) out.push(link)
    if (out.length >= MAX_LINKS) break
  }
  return out
}

/** Nombres de carpeta de memoria de versiones anteriores de la app, más reciente primero. */
const LEGACY_MEMORY_DIRS = ['.lapis'] as const

/** Ruta del archivo de memoria dentro de la carpeta de la tarea. */
export function memoryPath(folder: string): string {
  return join(folder, '.lazunox', 'memoria.md')
}

/**
 * 1.8.18: la memoria vive en la carpeta de la tarea, que la tarea controla desde dentro del encierro. Si `.lazunox` (o `.lapis`) o
 * `memoria.md` es un enlace (por ejemplo a `~/.ssh/id_rsa`), el proceso principal leía el destino y lo ponía en el prompt (al modelo) y
 * `saveMemory` escribía a través del enlace. Ahora la carpeta tiene que ser real (sin enlaces) y el archivo se lee y escribe con
 * `O_NOFOLLOW`: un enlace se trata como «sin memoria» al leer y da un error claro al guardar.
 */
function memoryDirOk(folder: string, dirName: string): boolean {
  try {
    ensureRealDir(folder, join(folder, dirName))
    return true
  } catch {
    return false
  }
}

function readMemoryFileAt(folder: string, dirName: string): TasksMemory | null {
  if (!memoryDirOk(folder, dirName)) return null
  const r = readFileNoFollow(join(folder, dirName, 'memoria.md'))
  if (!r) return null
  return { content: r.content.toString('utf8'), exists: true, updatedAt: r.mtimeMs }
}

/**
 * Lee la memoria de la carpeta. Si `.lazunox/memoria.md` todavía no existe (carpeta usada con una
 * versión anterior de la app), cae de vuelta a `.lapis/memoria.md` para no perder notas ya escritas
 * antes de que el usuario vuelva a guardar (lo que migra la memoria a la carpeta nueva).
 */
function readMemoryFile(folder: string): TasksMemory {
  const current = readMemoryFileAt(folder, '.lazunox')
  if (current) return current
  for (const legacyDir of LEGACY_MEMORY_DIRS) {
    const legacy = readMemoryFileAt(folder, legacyDir)
    if (legacy) return legacy
  }
  return { content: '', exists: false, updatedAt: null }
}

export function getMemory(folder: string): TasksMemory {
  return readMemoryFile(folder)
}

export function saveMemory(folder: string, content: string): TasksMemory {
  const trimmed = content.slice(0, MEMORY_MAX_BYTES)
  try {
    ensureRealDir(folder, join(folder, '.lazunox'), { create: true })
    writeFileNoFollow(memoryPath(folder), trimmed)
  } catch (e) {
    if (e instanceof LinkRefusedError) throw new Error(t('merr.projects.memoryLink'))
    throw e
  }
  return readMemoryFile(folder)
}

export function deleteMemory(folder: string): TasksMemory {
  // `unlink` de `memoria.md` nunca sigue un enlace; pero si la CARPETA es un enlace se borraría el `memoria.md` de su destino: se salta.
  const dirs = ['.lazunox', ...LEGACY_MEMORY_DIRS].filter((d) => memoryDirOk(folder, d))
  for (const file of dirs.map((d) => join(folder, d, 'memoria.md'))) {
    try {
      if (lexists(file)) unlinkSync(file)
    } catch (err) {
      console.error('[tasks] no se pudo borrar la memoria:', err)
    }
  }
  return readMemoryFile(folder)
}

function lexists(p: string): boolean {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

// ── AGENTS.md de la carpeta ────────────────────────────────────────────────────────────

/**
 * Resuelve `<folder>/AGENTS.md`. Si es un enlace simbólico solo se admite cuando su destino real
 * queda dentro de la carpeta (evita leer/escribir fuera de la carpeta aprobada).
 */
function resolveAgentsMd(folder: string): { path: string; real: string; exists: boolean } {
  const path = join(folder, 'AGENTS.md')
  let st
  try {
    st = lstatSync(path)
  } catch {
    return { path, real: path, exists: false }
  }
  if (st.isSymbolicLink()) {
    let real: string
    try {
      real = realpathSync(path)
    } catch {
      throw new Error(t('merr.projects.brokenLink'))
    }
    if (!isInside(real, realpathSync(folder))) {
      throw new Error(t('merr.projects.linkOutside'))
    }
    if (!statSync(real).isFile()) throw new Error(t('merr.projects.notFile'))
    return { path, real, exists: true }
  }
  if (!st.isFile()) throw new Error(t('merr.projects.notFile'))
  return { path, real: path, exists: true }
}

/** Lee `<folder>/AGENTS.md` (vacío y `exists:false` si no existe). */
export function getAgentsMd(folder: string): TasksAgentsMd {
  const r = resolveAgentsMd(folder)
  if (!r.exists) return { path: r.path, content: '', exists: false }
  if (statSync(r.real).size > AGENTS_MD_MAX_CHARS * 4) throw new Error(t('merr.projects.tooBig'))
  return { path: r.path, content: readFileSync(r.real, 'utf8'), exists: true }
}

/** Guarda `<folder>/AGENTS.md` (escritura atómica). */
export function saveAgentsMd(folder: string, content: string): TasksAgentsMd {
  if (content.length > AGENTS_MD_MAX_CHARS) {
    throw new Error(t('merr.projects.overLimit', { max: AGENTS_MD_MAX_CHARS.toLocaleString(getLang() === 'en' ? 'en-US' : 'es-CL') }))
  }
  const r = resolveAgentsMd(folder)
  const tmp = `${r.real}.lazunox-tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, r.real)
  return getAgentsMd(folder)
}
