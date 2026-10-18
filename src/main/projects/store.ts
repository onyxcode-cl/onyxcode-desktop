/**
 * Almacén local de los proyectos del Chat (F8-B185). Módulo sin Electron: la carpeta raíz la entrega quien lo llama.
 *
 * Disposición en `userData/projects/`:
 *   projects.json                 metadatos (proyectos, archivos, conversación → proyecto)
 *   <proyecto>/files/<archivo>.<ext>   COPIA del archivo original (se copia para no depender de la ruta de origen ni leerla después)
 *   <proyecto>/index.json         pasajes de texto de los archivos (el índice local; BM25 se arma en memoria al buscar)
 *
 * Reglas (mismo patrón que el índice de la galería):
 *  - Los ids son 16 hex generados aquí y se revalidan al leer: ninguna ruta se arma con texto de la persona ni del modelo.
 *  - Lo leído del disco se trata como no confiable: cada campo se revisa y lo que no encaja se descarta.
 *  - Escritura atómica (temporal + renombrar) con permisos 0600; un fallo de disco nunca rompe la app.
 *  - Borrar un proyecto o un archivo borra sus copias y su índice.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectFileFailReason, ProjectFileInfo, ProjectInfo } from '@shared/ipc-extras'
import { Bm25Index, PROJECT_LIMITS, knowledgeExt, type KnowledgeChunk } from '@shared/project-knowledge'

const ID_RE = /^[a-f0-9]{16}$/
const MAX_META_BYTES = 4 * 1024 * 1024
const MAX_INDEX_BYTES = 8 * 1024 * 1024
const MAX_ERROR_ENTRIES = 10
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,200}$/
const REASONS = new Set<string>([
  'unsupported',
  'tooBig',
  'projectFull',
  'tooManyFiles',
  'reserved',
  'encrypted',
  'legacy',
  'corrupt',
  'empty',
  'noText',
  'unreadable'
])

interface FileRecord {
  id: string
  name: string
  ext: string
  bytes: number
  addedAt: number
  status: 'ready' | 'error'
  reason?: ProjectFileFailReason
  chunks?: number
  chars?: number
  truncated?: boolean
}

interface ProjectRecord {
  id: string
  name: string
  instructions: string
  createdAt: number
  updatedAt: number
  files: FileRecord[]
}

interface Meta {
  version: 1
  projects: ProjectRecord[]
  assignments: Record<string, string>
}

export class ProjectStoreError extends Error {
  constructor(readonly code: 'notFound' | 'tooMany' | 'invalid') {
    super(code)
  }
}

export function newId(): string {
  return randomBytes(8).toString('hex')
}

/** Nombre de proyecto o de archivo: una línea, sin caracteres de control. */
export function cleanName(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

function cleanFile(raw: unknown): FileRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null
  const name = cleanName(r.name, 200)
  const bytes = num(r.bytes)
  const addedAt = num(r.addedAt)
  if (!name || bytes === null || addedAt === null) return null
  if (r.status !== 'ready' && r.status !== 'error') return null
  const ext = typeof r.ext === 'string' && /^[a-z0-9]{1,8}$/.test(r.ext) ? r.ext : knowledgeExt(name)
  const f: FileRecord = { id: r.id, name, ext: /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin', bytes, addedAt, status: r.status }
  if (r.status === 'error')
    f.reason = typeof r.reason === 'string' && REASONS.has(r.reason) ? (r.reason as ProjectFileFailReason) : 'unreadable'
  else {
    f.chunks = num(r.chunks) ?? 0
    f.chars = num(r.chars) ?? 0
    if (r.truncated === true) f.truncated = true
  }
  return f
}

function cleanProject(raw: unknown): ProjectRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null
  const name = cleanName(r.name, PROJECT_LIMITS.maxNameChars)
  if (!name) return null
  const createdAt = num(r.createdAt)
  if (createdAt === null) return null
  const files: FileRecord[] = []
  const seen = new Set<string>()
  if (Array.isArray(r.files)) {
    for (const f of r.files.slice(0, PROJECT_LIMITS.maxFilesPerProject + MAX_ERROR_ENTRIES)) {
      const c = cleanFile(f)
      if (c && !seen.has(c.id)) {
        seen.add(c.id)
        files.push(c)
      }
    }
  }
  return {
    id: r.id,
    name,
    instructions: typeof r.instructions === 'string' ? r.instructions.slice(0, PROJECT_LIMITS.maxInstructionsChars) : '',
    createdAt,
    updatedAt: num(r.updatedAt) ?? createdAt,
    files
  }
}

function cleanChunks(raw: unknown, files: Map<string, FileRecord>): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = []
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { chunks?: unknown }).chunks)) return out
  for (const c of (raw as { chunks: unknown[] }).chunks) {
    if (!c || typeof c !== 'object') continue
    const { file, part, text } = c as Record<string, unknown>
    if (typeof file !== 'string' || typeof text !== 'string' || typeof part !== 'number' || !Number.isInteger(part) || part < 1) continue
    const rec = files.get(file)
    if (!rec || rec.status !== 'ready') continue
    out.push({ file, name: rec.name, part, text })
  }
  return out
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export class ProjectStore {
  private meta: Meta | null = null
  private readonly indexCache = new Map<string, Bm25Index>()

  constructor(private readonly root: string) {}

  /* ── rutas (solo a partir de ids validados) ── */
  private metaFile(): string {
    return join(this.root, 'projects.json')
  }
  private projectDir(id: string): string {
    if (!ID_RE.test(id)) throw new ProjectStoreError('invalid')
    return join(this.root, id)
  }
  private filesDir(id: string): string {
    return join(this.projectDir(id), 'files')
  }
  private indexFile(id: string): string {
    return join(this.projectDir(id), 'index.json')
  }
  private copyPath(projectId: string, f: Pick<FileRecord, 'id' | 'ext'>): string {
    return join(this.filesDir(projectId), `${f.id}.${f.ext}`)
  }

  /* ── metadatos ── */
  private load(): Meta {
    if (this.meta) return this.meta
    const meta: Meta = { version: 1, projects: [], assignments: {} }
    try {
      if (existsSync(this.metaFile()) && sizeOf(this.metaFile()) <= MAX_META_BYTES) {
        const data = JSON.parse(readFileSync(this.metaFile(), 'utf8')) as { projects?: unknown; assignments?: unknown }
        if (Array.isArray(data.projects)) {
          const seen = new Set<string>()
          for (const raw of data.projects.slice(0, PROJECT_LIMITS.maxProjects)) {
            const p = cleanProject(raw)
            if (p && !seen.has(p.id)) {
              seen.add(p.id)
              meta.projects.push(p)
            }
          }
        }
        if (data.assignments && typeof data.assignments === 'object' && !Array.isArray(data.assignments)) {
          const ids = new Set(meta.projects.map((p) => p.id))
          for (const [sid, pid] of Object.entries(data.assignments as Record<string, unknown>).slice(0, PROJECT_LIMITS.maxAssignments)) {
            if (SESSION_ID_RE.test(sid) && typeof pid === 'string' && ids.has(pid)) meta.assignments[sid] = pid
          }
        }
      }
    } catch {
      // archivo ilegible: se parte de cero (los archivos copiados quedan, pero sin metadatos no se muestran)
    }
    this.meta = meta
    return meta
  }

  private save(): void {
    if (!this.meta) return
    try {
      mkdirSync(this.root, { recursive: true })
      const tmp = `${this.metaFile()}.tmp`
      writeFileSync(tmp, JSON.stringify(this.meta), { mode: 0o600 })
      renameSync(tmp, this.metaFile())
    } catch {
      // sin disco o sin permiso: queda en memoria
    }
  }

  private writeAtomic(path: string, data: string): void {
    const tmp = `${path}.tmp`
    writeFileSync(tmp, data, { mode: 0o600 })
    renameSync(tmp, path)
  }

  private get(id: string): ProjectRecord {
    const p = this.load().projects.find((x) => x.id === id)
    if (!p) throw new ProjectStoreError('notFound')
    return p
  }

  /* ── proyectos ── */
  private info(p: ProjectRecord): ProjectInfo {
    let used = sizeOf(this.indexFile(p.id))
    for (const f of p.files) if (f.status === 'ready') used += sizeOf(this.copyPath(p.id, f))
    const files: ProjectFileInfo[] = p.files.map((f) => {
      const o: ProjectFileInfo = { id: f.id, name: f.name, bytes: f.bytes, addedAt: f.addedAt, status: f.status }
      if (f.status === 'error') o.reason = f.reason
      else {
        o.chunks = f.chunks
        if (f.truncated) o.truncated = true
      }
      return o
    })
    return { id: p.id, name: p.name, instructions: p.instructions, createdAt: p.createdAt, updatedAt: p.updatedAt, files, usedBytes: used }
  }

  list(): ProjectInfo[] {
    return this.load()
      .projects.map((p) => this.info(p))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  assignments(): Record<string, string> {
    return { ...this.load().assignments }
  }

  create(name: string, instructions: string, now = Date.now()): ProjectInfo {
    const meta = this.load()
    if (meta.projects.length >= PROJECT_LIMITS.maxProjects) throw new ProjectStoreError('tooMany')
    const clean = cleanName(name, PROJECT_LIMITS.maxNameChars)
    if (!clean) throw new ProjectStoreError('invalid')
    const p: ProjectRecord = {
      id: newId(),
      name: clean,
      instructions: instructions.slice(0, PROJECT_LIMITS.maxInstructionsChars),
      createdAt: now,
      updatedAt: now,
      files: []
    }
    meta.projects.push(p)
    this.save()
    return this.info(p)
  }

  update(id: string, patch: { name?: string; instructions?: string }, now = Date.now()): ProjectInfo {
    const p = this.get(id)
    if (patch.name !== undefined) {
      const clean = cleanName(patch.name, PROJECT_LIMITS.maxNameChars)
      if (!clean) throw new ProjectStoreError('invalid')
      p.name = clean
      // El nombre va en cada pasaje para citarlo: el índice en memoria se rearma con el nombre nuevo del archivo, no del proyecto.
    }
    if (patch.instructions !== undefined) p.instructions = patch.instructions.slice(0, PROJECT_LIMITS.maxInstructionsChars)
    p.updatedAt = now
    this.save()
    return this.info(p)
  }

  /** Borra el proyecto: sus copias, su índice y las conversaciones asignadas dejan de pertenecerle. */
  delete(id: string): void {
    const meta = this.load()
    this.get(id)
    meta.projects = meta.projects.filter((p) => p.id !== id)
    for (const [sid, pid] of Object.entries(meta.assignments)) if (pid === id) delete meta.assignments[sid]
    this.indexCache.delete(id)
    try {
      rmSync(this.projectDir(id), { recursive: true, force: true })
    } catch {
      // si no se puede borrar ahora, queda huérfano fuera de la lista (no se lee nunca)
    }
    this.save()
  }

  /* ── archivos ── */
  usedFileBytes(id: string): number {
    return this.get(id)
      .files.filter((f) => f.status === 'ready')
      .reduce((n, f) => n + f.bytes, 0)
  }

  readyFiles(id: string): FileRecord[] {
    return this.get(id).files.filter((f) => f.status === 'ready')
  }

  usedChars(id: string, exceptFileId?: string): number {
    return this.get(id)
      .files.filter((f) => f.status === 'ready' && f.id !== exceptFileId)
      .reduce((n, f) => n + (f.chars ?? 0), 0)
  }

  fileByName(id: string, name: string): FileRecord | undefined {
    const key = name.toLowerCase()
    return this.get(id).files.find((f) => f.name.toLowerCase() === key)
  }

  private readIndex(id: string): KnowledgeChunk[] {
    const p = this.get(id)
    try {
      const file = this.indexFile(id)
      if (!existsSync(file) || sizeOf(file) > MAX_INDEX_BYTES) return []
      return cleanChunks(JSON.parse(readFileSync(file, 'utf8')), new Map(p.files.map((f) => [f.id, f])))
    } catch {
      return []
    }
  }

  private writeIndex(id: string, chunks: KnowledgeChunk[]): void {
    mkdirSync(this.projectDir(id), { recursive: true })
    this.writeAtomic(
      this.indexFile(id),
      JSON.stringify({ version: 1, chunks: chunks.map((c) => ({ file: c.file, part: c.part, text: c.text })) })
    )
    this.indexCache.delete(id)
  }

  /** Registra un archivo leído: guarda su copia y sus pasajes. Si ya había uno con el mismo nombre, lo reemplaza. */
  addReady(
    projectId: string,
    args: { name: string; bytes: Buffer; chunks: KnowledgeChunk[]; chars: number; truncated: boolean },
    now = Date.now()
  ): ProjectFileInfo {
    const p = this.get(projectId)
    const name = cleanName(args.name, 200)
    const ext = knowledgeExt(name)
    const old = this.fileByName(projectId, name)
    const rec: FileRecord = {
      id: newId(),
      name,
      ext: /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin',
      bytes: args.bytes.length,
      addedAt: now,
      status: 'ready',
      chunks: args.chunks.length,
      chars: args.chars
    }
    if (args.truncated) rec.truncated = true
    mkdirSync(this.filesDir(projectId), { recursive: true })
    writeFileSync(this.copyPath(projectId, rec), args.bytes, { mode: 0o600 })
    const kept = this.readIndex(projectId).filter((c) => c.file !== old?.id)
    const all = [...kept, ...args.chunks.map((c) => ({ ...c, file: rec.id, name }))]
    try {
      this.writeIndex(projectId, all)
    } catch (e) {
      rmSync(this.copyPath(projectId, rec), { force: true })
      throw e
    }
    if (old) {
      rmSync(this.copyPath(projectId, old), { force: true })
      p.files = p.files.filter((f) => f.id !== old.id)
    }
    p.files.push(rec)
    p.updatedAt = now
    this.save()
    return this.info(p).files.find((f) => f.id === rec.id)!
  }

  /** Anota un archivo que no se pudo leer (sin copia ni pasajes) para mostrar el motivo. */
  addFailed(projectId: string, args: { name: string; bytes: number; reason: ProjectFileFailReason }, now = Date.now()): ProjectFileInfo {
    const p = this.get(projectId)
    const name = cleanName(args.name, 200) || '?'
    const ext = knowledgeExt(name)
    const rec: FileRecord = {
      id: newId(),
      name,
      ext: /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin',
      bytes: Math.max(0, Math.floor(args.bytes)),
      addedAt: now,
      status: 'error',
      reason: args.reason
    }
    // Un intento fallido anterior con el mismo nombre se reemplaza (no se acumulan avisos repetidos).
    p.files = p.files.filter((f) => !(f.status === 'error' && f.name.toLowerCase() === name.toLowerCase()))
    p.files.push(rec)
    const errors = p.files.filter((f) => f.status === 'error')
    if (errors.length > MAX_ERROR_ENTRIES) {
      const drop = new Set(errors.slice(0, errors.length - MAX_ERROR_ENTRIES).map((f) => f.id))
      p.files = p.files.filter((f) => !drop.has(f.id))
    }
    p.updatedAt = now
    this.save()
    return this.info(p).files.find((f) => f.id === rec.id)!
  }

  removeFile(projectId: string, fileId: string, now = Date.now()): void {
    const p = this.get(projectId)
    const f = p.files.find((x) => x.id === fileId)
    if (!f) throw new ProjectStoreError('notFound')
    p.files = p.files.filter((x) => x.id !== fileId)
    if (f.status === 'ready') {
      rmSync(this.copyPath(projectId, f), { force: true })
      try {
        this.writeIndex(
          projectId,
          this.readIndex(projectId).filter((c) => c.file !== fileId)
        )
      } catch {
        // el índice se purga al volver a leerlo (cleanChunks descarta pasajes de archivos que ya no existen)
        this.indexCache.delete(projectId)
      }
    }
    p.updatedAt = now
    this.save()
  }

  /* ── conversaciones ── */
  assign(sessionId: string, projectId: string | null): void {
    const meta = this.load()
    if (!SESSION_ID_RE.test(sessionId)) throw new ProjectStoreError('invalid')
    if (projectId === null) {
      if (!(sessionId in meta.assignments)) return
      delete meta.assignments[sessionId]
    } else {
      this.get(projectId)
      delete meta.assignments[sessionId] // reinserta al final: la más reciente se conserva al recortar
      meta.assignments[sessionId] = projectId
      const ids = Object.keys(meta.assignments)
      for (const id of ids.slice(0, Math.max(0, ids.length - PROJECT_LIMITS.maxAssignments))) delete meta.assignments[id]
    }
    this.save()
  }

  projectOf(sessionId: string): ProjectRecord | null {
    const pid = this.load().assignments[sessionId]
    return pid ? (this.load().projects.find((p) => p.id === pid) ?? null) : null
  }

  /* ── búsqueda ── */
  searchIndex(projectId: string): Bm25Index {
    this.get(projectId)
    let idx = this.indexCache.get(projectId)
    if (!idx) {
      idx = new Bm25Index(this.readIndex(projectId))
      this.indexCache.set(projectId, idx)
      // Solo se guardan unos pocos índices en memoria.
      if (this.indexCache.size > 4) {
        const first = this.indexCache.keys().next().value
        if (first !== undefined && first !== projectId) this.indexCache.delete(first)
      }
    }
    return idx
  }

  /** Espacio total que ocupan todos los proyectos. */
  totalUsedBytes(): number {
    return this.list().reduce((n, p) => n + p.usedBytes, 0)
  }
}
