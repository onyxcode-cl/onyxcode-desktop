/**
 * "Proyecto" de Cowork por carpeta: nombre + instrucciones + enlaces + interruptor de memoria, persistidos en
 * `userData/cowork-projects.json`. La memoria (notas que el agente guarda entre tareas) vive
 * aparte, como archivo de texto dentro de la propia carpeta (`.onyxcode/memoria.md`), para que el
 * usuario pueda verla/editarla con cualquier editor y viaje con la carpeta.
 */
import { app } from 'electron'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isInside } from '../util/paths'
import type { CoworkAgentsMd, CoworkMemory, CoworkProject } from '@shared/ipc-cowork'
import { COWORK_INSTRUCTIONS_MAX } from '@shared/cowork-prompt'

interface Persisted {
  projects: CoworkProject[]
}

const MAX_INSTRUCTIONS = COWORK_INSTRUCTIONS_MAX
const MAX_NAME = 200
const MAX_LINKS = 50
const MAX_LINK_LENGTH = 2048
const AGENTS_MD_MAX_CHARS = 200_000
const MEMORY_MAX_BYTES = 2 * 1024 * 1024

export class CoworkProjectsStore {
  private data: Persisted | null = null

  private get file(): string {
    return join(app.getPath('userData'), 'cowork-projects.json')
  }

  private load(): Persisted {
    if (this.data) return this.data
    let data: Persisted = { projects: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        if (Array.isArray(raw.projects)) {
          data.projects = raw.projects.filter((p): p is CoworkProject => !!p && typeof p.folder === 'string' && typeof p.name === 'string')
        }
      }
    } catch (err) {
      console.error('[cowork] cowork-projects.json inválido:', err)
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
  get(folder: string): CoworkProject {
    const existing = this.load().projects.find((p) => p.folder === folder)
    if (existing) return existing
    const now = Date.now()
    return { folder, name: basename(folder), instructions: '', createdAt: now, updatedAt: now }
  }

  save(folder: string, patch: { name?: string; instructions?: string; links?: string[]; memoryEnabled?: boolean }): CoworkProject {
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
  return join(folder, '.onyxcode', 'memoria.md')
}

function readMemoryFileAt(file: string): CoworkMemory | null {
  try {
    const st = statSync(file)
    if (!st.isFile()) return null
    const raw = readFileSync(file, 'utf8')
    return { content: raw, exists: true, updatedAt: st.mtimeMs }
  } catch {
    return null
  }
}

/**
 * Lee la memoria de la carpeta. Si `.onyxcode/memoria.md` todavía no existe (carpeta usada con una
 * versión anterior de la app), cae de vuelta a `.lapis/memoria.md` para no perder notas ya escritas
 * antes de que el usuario vuelva a guardar (lo que migra la memoria a la carpeta nueva).
 */
function readMemoryFile(folder: string): CoworkMemory {
  const current = readMemoryFileAt(memoryPath(folder))
  if (current) return current
  for (const legacyDir of LEGACY_MEMORY_DIRS) {
    const legacy = readMemoryFileAt(join(folder, legacyDir, 'memoria.md'))
    if (legacy) return legacy
  }
  return { content: '', exists: false, updatedAt: null }
}

export function getMemory(folder: string): CoworkMemory {
  return readMemoryFile(folder)
}

export function saveMemory(folder: string, content: string): CoworkMemory {
  const trimmed = content.slice(0, MEMORY_MAX_BYTES)
  const file = memoryPath(folder)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, trimmed, 'utf8')
  return readMemoryFile(folder)
}

export function deleteMemory(folder: string): CoworkMemory {
  const files = [memoryPath(folder), ...LEGACY_MEMORY_DIRS.map((d) => join(folder, d, 'memoria.md'))]
  for (const file of files) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch (err) {
      console.error('[cowork] no se pudo borrar la memoria:', err)
    }
  }
  return readMemoryFile(folder)
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
      throw new Error('AGENTS.md es un enlace simbólico roto.')
    }
    if (!isInside(real, realpathSync(folder))) {
      throw new Error('AGENTS.md es un enlace simbólico que apunta fuera de la carpeta; edítalo desde el terminal.')
    }
    if (!statSync(real).isFile()) throw new Error('AGENTS.md no es un archivo.')
    return { path, real, exists: true }
  }
  if (!st.isFile()) throw new Error('AGENTS.md no es un archivo.')
  return { path, real: path, exists: true }
}

/** Lee `<folder>/AGENTS.md` (vacío y `exists:false` si no existe). */
export function getAgentsMd(folder: string): CoworkAgentsMd {
  const r = resolveAgentsMd(folder)
  if (!r.exists) return { path: r.path, content: '', exists: false }
  if (statSync(r.real).size > AGENTS_MD_MAX_CHARS * 4) throw new Error('AGENTS.md es demasiado grande para editarlo aquí.')
  return { path: r.path, content: readFileSync(r.real, 'utf8'), exists: true }
}

/** Guarda `<folder>/AGENTS.md` (escritura atómica). */
export function saveAgentsMd(folder: string, content: string): CoworkAgentsMd {
  if (content.length > AGENTS_MD_MAX_CHARS) {
    throw new Error(`AGENTS.md no puede superar ${AGENTS_MD_MAX_CHARS.toLocaleString('es-CL')} caracteres.`)
  }
  const r = resolveAgentsMd(folder)
  const tmp = `${r.real}.onyxcode-tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, r.real)
  return getAgentsMd(folder)
}
