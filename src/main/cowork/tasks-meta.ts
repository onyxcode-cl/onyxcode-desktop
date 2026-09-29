/**
 * Metadatos de tareas de Cowork que main persiste (`userData/tasks-meta.json`): fijada, grupo y
 * título, para poder listar tareas de todas las carpetas (Fijadas / Activas) sin abrir sus
 * servidores. Solo se guardan las que tienen algo que recordar (fijada o con grupo). Sin
 * dependencias de Electron: la ruta del archivo la pone quien lo crea.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CoworkTaskMeta } from '@shared/ipc-cowork'

const MAX_TASKS = 5000
const MAX_GROUP = 80
const MAX_TITLE = 300

export interface TaskMetaSetRequest {
  sessionId: string
  folder: string
  fullAccess: boolean
  title?: string
  pinned?: boolean
  group?: string | null
}

function normGroup(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const g = v.trim().slice(0, MAX_GROUP)
  return g || null
}

/** Valida una entrada persistida; devuelve null si no sirve. */
function normalizeEntry(v: unknown): CoworkTaskMeta | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.sessionId !== 'string' || !o.sessionId || o.sessionId.length > 200) return null
  if (typeof o.folder !== 'string' || !o.folder || o.folder.length > 4096) return null
  const meta: CoworkTaskMeta = {
    sessionId: o.sessionId,
    folder: o.folder,
    fullAccess: o.fullAccess === true,
    title: typeof o.title === 'string' ? o.title.slice(0, MAX_TITLE) : '',
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : 0
  }
  if (o.pinned === true) meta.pinned = true
  const group = normGroup(o.group)
  if (group) meta.group = group
  return meta
}

export class CoworkTasksStore {
  private cache: Map<string, CoworkTaskMeta> | null = null

  constructor(private readonly file: string) {}

  private load(): Map<string, CoworkTaskMeta> {
    if (this.cache) return this.cache
    const map = new Map<string, CoworkTaskMeta>()
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { tasks?: unknown }
        const list = Array.isArray(raw?.tasks) ? raw.tasks : []
        for (const item of list) {
          const m = normalizeEntry(item)
          if (m && map.size < MAX_TASKS) map.set(m.sessionId, m)
        }
      }
    } catch (err) {
      console.error('[tasks] tasks-meta.json inválido, empezando vacío:', err)
    }
    this.cache = map
    return map
  }

  private save(): void {
    const tasks = [...this.load().values()]
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ tasks }, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  list(): CoworkTaskMeta[] {
    return [...this.load().values()].map((m) => ({ ...m }))
  }

  isPinned(sessionId: string): boolean {
    return this.load().get(sessionId)?.pinned === true
  }

  /**
   * Fusiona los campos recibidos con lo guardado. Si la tarea queda sin fijar y sin grupo se
   * deja de guardar (pero se devuelve el metadato resultante).
   */
  set(req: TaskMetaSetRequest): CoworkTaskMeta {
    const map = this.load()
    const prev = map.get(req.sessionId)
    const next: CoworkTaskMeta = {
      sessionId: req.sessionId,
      folder: req.folder,
      fullAccess: req.fullAccess,
      title: (req.title ?? prev?.title ?? '').slice(0, MAX_TITLE),
      updatedAt: Date.now()
    }
    const pinned = req.pinned !== undefined ? req.pinned : prev?.pinned === true
    if (pinned) next.pinned = true
    const group = req.group !== undefined ? normGroup(req.group) : (prev?.group ?? null)
    if (group) next.group = group
    if (!next.pinned && !next.group) {
      if (map.delete(req.sessionId)) this.save()
      return next
    }
    if (!prev && map.size >= MAX_TASKS) throw new Error('Demasiadas tareas con metadatos guardados')
    map.set(req.sessionId, next)
    this.save()
    return { ...next }
  }

  forget(sessionId: string): void {
    if (this.load().delete(sessionId)) this.save()
  }
}
