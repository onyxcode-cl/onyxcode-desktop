/**
 * "Proyecto" de Cowork por carpeta: nombre + instrucciones, persistidos en
 * `userData/cowork-projects.json`. La memoria (notas que el agente guarda entre tareas) vive
 * aparte, como archivo de texto dentro de la propia carpeta (`.lapis/memoria.md`), para que el
 * usuario pueda verla/editarla con cualquier editor y viaje con la carpeta.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import type { CoworkMemory, CoworkProject } from '@shared/ipc-cowork'

interface Persisted {
  projects: CoworkProject[]
}

const MAX_INSTRUCTIONS = 20_000
const MAX_NAME = 200
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
          data.projects = raw.projects.filter(
            (p): p is CoworkProject => !!p && typeof p.folder === 'string' && typeof p.name === 'string'
          )
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

  save(folder: string, patch: { name?: string; instructions?: string }): CoworkProject {
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

/** Ruta del archivo de memoria dentro de la carpeta de la tarea. */
export function memoryPath(folder: string): string {
  return join(folder, '.lapis', 'memoria.md')
}

function readMemoryFile(folder: string): CoworkMemory {
  const file = memoryPath(folder)
  try {
    const st = statSync(file)
    if (!st.isFile()) return { content: '', exists: false, updatedAt: null }
    const raw = readFileSync(file, 'utf8')
    return { content: raw, exists: true, updatedAt: st.mtimeMs }
  } catch {
    return { content: '', exists: false, updatedAt: null }
  }
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
  const file = memoryPath(folder)
  try {
    if (existsSync(file)) unlinkSync(file)
  } catch (err) {
    console.error('[cowork] no se pudo borrar la memoria:', err)
  }
  return readMemoryFile(folder)
}

/** Evita rutas fuera de la carpeta (defensa en profundidad; el llamador ya valida con assertInsideApproved). */
export function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep)
}
