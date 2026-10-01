/**
 * Puntos de restauración de Tareas: instantánea PROPIA de la app (no usa git), válida para
 * cualquier carpeta. Se guarda en `userData/restore-points/<sha256(carpeta):16>/`:
 *
 *   objects/<sha256>          contenido por hash (copyFile con clon COW en APFS)
 *   points/<id>.json          manifiesto {v:1, entries:{ruta:{size,mtimeMs,mode,hash}}, dirs, symlinks}
 *   points/<id>.meta.json     metadatos pequeños para listar sin leer el manifiesto
 *
 * Todo lo hace el proceso principal (fuera del sandbox del agente); no deja nada dentro de la
 * carpeta del usuario. Sin dependencias de Electron: la Papelera, la hora y la raíz se inyectan.
 *
 * Robustez (F8-B21): un archivo que existía y no se pudo copiar (ilegible, iCloud «solo en la nube», sin espacio) se
 * registra con `hash:null` y `skip`, NUNCA se omite: omitirlo lo haría pasar por «nuevo» y deshacer lo mandaría a la
 * Papelera. Directorios ilegibles (`unreadableDirs`) y stubs de iCloud (`cloudStubs`) tampoco generan «nuevos».
 * Copia y hash son asíncronos (no bloquean main) y crear tiene un presupuesto de tiempo y de espacio libre.
 *
 * Garantías y límites (ver docs/SEGURIDAD.md): recorrido sin seguir symlinks (se registran y
 * nunca se restauran); se excluyen `.git/`, `node_modules/` y `.onyxcode/`; 20 000 archivos,
 * 50 MB por archivo y 2 GB en total; restaurar crea antes un punto «Antes de deshacer»; lo creado
 * después va a la Papelera (nunca se borra); cada ruta se valida contra symlinks intermedios.
 */
import { t } from '@shared/i18n'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  constants as fsc,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
  type Stats
} from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import type { TasksRestoreChange, TasksRestorePoint } from '@shared/ipc-tasks'

export interface RestoreLimits {
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  maxPointsPerSession: number
  maxAgeMs: number
  /** Texto: tamaño máximo para calcular diff. */
  maxDiffFileBytes: number
  /** Tope total de texto de diffs por consulta. */
  maxPatchBytes: number
  /** Tope de cambios devueltos. */
  maxChanges: number
  /** Presupuesto para crear un punto: pasado este tiempo el punto queda omitido. */
  maxCreateMs: number
}

export const DEFAULT_LIMITS: RestoreLimits = {
  maxFiles: 20_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxPointsPerSession: 20,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxDiffFileBytes: 1024 * 1024,
  maxPatchBytes: 2 * 1024 * 1024,
  maxChanges: 5000,
  maxCreateMs: 30_000
}

/** Margen de espacio libre que debe quedar tras copiar. */
const FREE_MARGIN_BYTES = 512 * 1024 * 1024
/** Precisión de fecha de los sistemas de archivos (FAT/exFAT 2 s, HFS+ 1 s): una fecha tan cercana al punto no basta. */
const MTIME_SLACK_MS = 2000

export interface RestoreDeps {
  /** `userData/restore-points`. */
  root: string
  /** Envía un archivo a la Papelera (nunca se borra). */
  trash: (path: string) => Promise<void>
  now?: () => number
  limits?: Partial<RestoreLimits>
  /** Bytes libres del volumen que contiene `path` (por defecto `statfsSync`). */
  freeBytes?: (path: string) => number
  /** ¿Es un archivo de iCloud «solo en la nube» (no descargado)? Leerlo dispararía la descarga. */
  isCloudPlaceholder?: (st: Stats) => boolean
}

/** Por qué un archivo no se guardó. */
export type SkipReason = 'unreadable' | 'cloud' | 'nospace'

/** iCloud «solo en la nube»: tiene tamaño pero ningún bloque en disco. Un archivo normal en APFS tiene blocks > 0. */
export const defaultIsCloudPlaceholder = (st: Stats): boolean => st.size > 0 && st.blocks === 0

function defaultFreeBytes(path: string): number {
  try {
    const f = statfsSync(path)
    return Number(f.bavail) * Number(f.bsize)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export interface RestoreEntry {
  size: number
  mtimeMs: number
  mode: number
  /** `null` si el archivo no se copió (más de 50 MB, solo en la nube o ilegible: ver `skip`). */
  hash: string | null
  /** Motivo por el que no se copió (sin motivo y `hash:null` = más de 50 MB). */
  skip?: SkipReason
}

interface Manifest {
  v: 1
  entries: Record<string, RestoreEntry>
  /** Directorios (relativos) que existían, incluidos los vacíos. */
  dirs: string[]
  /** Symlinks registrados (jamás se restauran ni se tocan). */
  symlinks: string[]
  /** Momento de creación: una fecha de archivo cercana a él no se fía (FAT/exFAT/HFS+). */
  createdAt?: number
  /** Directorios que no se pudieron leer: lo que hay debajo es desconocido (nunca «nuevo»). */
  unreadableDirs?: string[]
  /** Archivos de iCloud representados por un `.<nombre>.icloud` (ruta del archivo real). */
  cloudStubs?: string[]
}

interface Diff {
  rel: string
  status: 'added' | 'modified' | 'deleted'
  entry?: RestoreEntry
  cur?: Stats
}

export const EXCLUDED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules', '.onyxcode'])
const OBJECT_RE = /^[a-f0-9]{64}$/
const ID_RE = /^[a-f0-9]{1,64}$/
const UNDO_LABEL = 'Antes de deshacer'

interface Walked {
  files: Array<{ rel: string; abs: string; st: Stats }>
  dirs: string[]
  symlinks: string[]
  unreadableDirs: string[]
  cloudStubs: string[]
  overLimit: boolean
  timedOut: boolean
}

/** Cede el hilo para no congelar el proceso principal en carpetas grandes. */
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

/** Metadatos del sistema que no son del usuario (Finder, volúmenes no HFS): fuera del recorrido y del diff. */
export const isIgnorableName = (name: string): boolean => name === '.DS_Store' || name.startsWith('._')
const STUB_RE = /^\.(.+)\.icloud$/

const isUnder = (rel: string, dirs: readonly string[]): boolean => dirs.some((d) => rel.startsWith(`${d}/`))

/** Recorre sin seguir symlinks y sin entrar en directorios excluidos. */
async function walk(root: string, maxFiles: number, expired?: () => boolean): Promise<Walked> {
  const out: Walked = { files: [], dirs: [], symlinks: [], unreadableDirs: [], cloudStubs: [], overLimit: false, timedOut: false }
  const stack: string[] = ['']
  let n = 0
  while (stack.length) {
    const relDir = stack.pop() as string
    let names: string[]
    try {
      names = readdirSync(join(root, relDir))
    } catch (err) {
      if (!relDir) throw err
      out.unreadableDirs.push(relDir)
      continue
    }
    for (const name of names) {
      const rel = relDir ? `${relDir}/${name}` : name
      const abs = join(root, rel)
      let st: Stats
      try {
        st = lstatSync(abs)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) {
        out.symlinks.push(rel)
      } else if (st.isDirectory()) {
        if (EXCLUDED_DIRS.has(name)) continue
        out.dirs.push(rel)
        stack.push(rel)
      } else if (st.isFile()) {
        if (isIgnorableName(name)) continue
        const stub = STUB_RE.exec(name)
        if (stub) {
          out.cloudStubs.push(relDir ? `${relDir}/${stub[1]}` : stub[1])
          continue
        }
        out.files.push({ rel, abs, st })
        if (out.files.length > maxFiles) {
          out.overLimit = true
          return out
        }
      }
      if (++n % 400 === 0) {
        await yieldLoop()
        if (expired?.()) {
          out.timedOut = true
          return out
        }
      }
    }
  }
  return out
}

/** Hash por flujo: un archivo grande no bloquea el proceso principal. */
async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** ¿Por qué no se pudo guardar esta entrada? («large» = más de 50 MB). */
const reasonOf = (e: RestoreEntry): 'large' | 'cloud' | 'unreadable' => (e.skip === 'cloud' ? 'cloud' : e.skip ? 'unreadable' : 'large')
const noCopyText = (e: RestoreEntry): string =>
  e.skip === 'cloud'
    ? 'solo estaba en la nube (iCloud) y no se guardó'
    : e.skip
      ? 'no se pudo leer al guardar el punto'
      : 'no se guardó (más de 50 MB)'

function looksText(buf: Buffer): boolean {
  return !buf.subarray(0, 8192).includes(0)
}

function countPatch(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const l of patch.split('\n')) {
    if (l.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (l.startsWith('+')) additions++
    else if (l.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

export class RestorePoints {
  private readonly limits: RestoreLimits
  private readonly now: () => number
  private readonly freeBytes: (path: string) => number
  private readonly isCloud: (st: Stats) => boolean
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: RestoreDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits }
    this.now = deps.now ?? Date.now
    this.freeBytes = deps.freeBytes ?? defaultFreeBytes
    this.isCloud = deps.isCloudPlaceholder ?? defaultIsCloudPlaceholder
  }

  // ───────────────────────────── almacén ─────────────────────────────

  private realFolder(folder: string): string {
    try {
      return realpathSync(resolve(folder))
    } catch {
      throw new Error(t('merr.restore.unavailable'))
    }
  }

  private folderDir(real: string): string {
    return join(this.deps.root, createHash('sha256').update(real).digest('hex').slice(0, 16))
  }

  private ensureDirs(dir: string): void {
    mkdirSync(join(dir, 'objects'), { recursive: true, mode: 0o700 })
    mkdirSync(join(dir, 'points'), { recursive: true, mode: 0o700 })
    try {
      chmodSync(this.deps.root, 0o700)
      chmodSync(dir, 0o700)
    } catch {
      // mejor esfuerzo
    }
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => undefined)
    this.locks.set(key, tail)
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key)
    })
    return next
  }

  /** Espera a que terminen las operaciones en curso (crear/restaurar) antes de borrar el almacén. */
  private async idle(): Promise<void> {
    while (this.locks.size) await Promise.all([...this.locks.values()])
  }

  private readMeta(dir: string, id: string): TasksRestorePoint | null {
    try {
      return JSON.parse(readFileSync(join(dir, 'points', `${id}.meta.json`), 'utf8')) as TasksRestorePoint
    } catch {
      return null
    }
  }

  private readManifest(dir: string, id: string): Manifest | null {
    if (!ID_RE.test(id)) return null
    try {
      const m = JSON.parse(readFileSync(join(dir, 'points', `${id}.json`), 'utf8')) as Manifest
      return m && m.v === 1 && m.entries ? m : null
    } catch {
      return null
    }
  }

  private allMetas(dir: string): TasksRestorePoint[] {
    let names: string[] = []
    try {
      names = readdirSync(join(dir, 'points'))
    } catch {
      return []
    }
    const out: TasksRestorePoint[] = []
    for (const n of names) {
      if (!n.endsWith('.meta.json')) continue
      const m = this.readMeta(dir, n.slice(0, -'.meta.json'.length))
      if (m) out.push(m)
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  }

  private removePoint(dir: string, id: string): void {
    rmSync(join(dir, 'points', `${id}.json`), { force: true })
    rmSync(join(dir, 'points', `${id}.meta.json`), { force: true })
  }

  /** Borra los objetos que ningún manifiesto referencia (y temporales huérfanos). */
  gcFolder(dir: string): number {
    const live = new Set<string>()
    for (const m of this.allMetas(dir)) {
      const man = this.readManifest(dir, m.id)
      if (!man) continue
      for (const e of Object.values(man.entries)) if (e.hash) live.add(e.hash)
    }
    let removed = 0
    let names: string[] = []
    try {
      names = readdirSync(join(dir, 'objects'))
    } catch {
      return 0
    }
    for (const n of names) {
      if ((OBJECT_RE.test(n) && !live.has(n)) || n.startsWith('.tmp-')) {
        rmSync(join(dir, 'objects', n), { force: true })
        removed++
      }
    }
    return removed
  }

  /** Recolección de huérfanos en todas las carpetas del almacén. */
  gc(): number {
    let removed = 0
    let dirs: string[] = []
    try {
      dirs = readdirSync(this.deps.root)
    } catch {
      return 0
    }
    for (const d of dirs) {
      const dir = join(this.deps.root, d)
      this.prune(dir)
      removed += this.gcFolder(dir)
    }
    return removed
  }

  /** Aplica la retención (20 por tarea, 30 días). Devuelve cuántos puntos quitó. */
  private prune(dir: string, keep: string[] = []): number {
    const metas = this.allMetas(dir)
    const cutoff = this.now() - this.limits.maxAgeMs
    const drop = new Set<string>()
    for (const m of metas) if (m.createdAt < cutoff && !keep.includes(m.id)) drop.add(m.id)
    const bySession = new Map<string, TasksRestorePoint[]>()
    for (const m of metas) {
      if (drop.has(m.id)) continue
      const l = bySession.get(m.sessionId) ?? []
      l.push(m)
      bySession.set(m.sessionId, l)
    }
    for (const l of bySession.values()) {
      let excess = l.length - this.limits.maxPointsPerSession
      for (const m of l) {
        if (excess <= 0) break
        if (keep.includes(m.id)) continue
        drop.add(m.id)
        excess--
      }
    }
    for (const id of drop) this.removePoint(dir, id)
    return drop.size
  }

  // ───────────────────────────── crear ─────────────────────────────

  async create(folder: string, sessionId: string, label: string): Promise<TasksRestorePoint> {
    const real = this.realFolder(folder)
    return this.serial(real, () => this.createLocked(real, sessionId, label))
  }

  private async createLocked(real: string, sessionId: string, label: string, keepId?: string): Promise<TasksRestorePoint> {
    const dir = this.folderDir(real)
    this.ensureDirs(dir)
    const id = randomBytes(16).toString('hex')
    const startedAt = this.now()
    const base = { id, sessionId, folder: real, createdAt: startedAt, label: label.slice(0, 200) }
    const finish = (p: Omit<TasksRestorePoint, keyof typeof base>, man: Manifest): TasksRestorePoint => {
      const meta: TasksRestorePoint = { ...base, ...p }
      writeFileSync(join(dir, 'points', `${id}.json`), JSON.stringify(man), { mode: 0o600 })
      writeFileSync(join(dir, 'points', `${id}.meta.json`), JSON.stringify(meta), { mode: 0o600 })
      const pruned = this.prune(dir, [id, ...(keepId ? [keepId] : [])])
      if (pruned > 0) this.gcFolder(dir)
      return meta
    }
    const empty: Manifest = { v: 1, entries: {}, dirs: [], symlinks: [], createdAt: startedAt }
    const skipped = (reason: string): TasksRestorePoint => finish({ files: 0, bytes: 0, status: 'skipped', reason }, empty)
    const expired = (): boolean => this.now() - startedAt > this.limits.maxCreateMs
    const SLOW = 'tardaba demasiado'
    const w = await walk(real, this.limits.maxFiles, expired)
    if (w.timedOut) return skipped(SLOW)
    if (w.overLimit) return skipped(`la carpeta tiene más de ${this.limits.maxFiles.toLocaleString('es')} archivos`)
    let total = 0
    for (const f of w.files) if (f.st.size <= this.limits.maxFileBytes) total += f.st.size
    if (total > this.limits.maxTotalBytes) return skipped('la carpeta ocupa más de 2 GB')

    // Punto anterior de la carpeta (el más reciente con manifiesto): reutiliza hashes si coincide tamaño y fecha.
    const metas = this.allMetas(dir)
    const prev = metas.length ? this.readManifest(dir, metas[metas.length - 1].id) : null
    const entries: Record<string, RestoreEntry> = Object.create(null)
    const modeOf = (st: Stats): number => st.mode & 0o7777
    let bytes = 0
    let notCopied = 0
    let n = 0
    // Clasificación: qué se registra sin copiar, qué se reutiliza y qué hay que copiar.
    const todo: Array<{ rel: string; abs: string; st: Stats }> = []
    let need = 0
    for (const f of w.files) {
      const { rel, st } = f
      if (++n % 200 === 0) await yieldLoop()
      if (st.size > this.limits.maxFileBytes) {
        entries[rel] = { size: st.size, mtimeMs: st.mtimeMs, mode: modeOf(st), hash: null }
        continue
      }
      if (this.isCloud(st)) {
        // «Solo en la nube»: leerlo dispararía la descarga. Se registra, no se copia, y nunca se trata como nuevo.
        entries[rel] = { size: st.size, mtimeMs: st.mtimeMs, mode: modeOf(st), hash: null, skip: 'cloud' }
        notCopied++
        continue
      }
      const old = prev && Object.hasOwn(prev.entries, rel) ? prev.entries[rel] : undefined
      // Una fecha cercana al punto anterior no basta (FAT/exFAT 2 s, HFS+ 1 s): se vuelve a calcular el hash.
      const recent = prev?.createdAt !== undefined && st.mtimeMs >= prev.createdAt - MTIME_SLACK_MS
      if (old && old.hash && !recent && old.size === st.size && old.mtimeMs === st.mtimeMs && existsSync(join(dir, 'objects', old.hash))) {
        entries[rel] = { ...old, mode: modeOf(st) }
        bytes += st.size
        continue
      }
      todo.push(f)
      need += st.size
    }
    if (expired()) return skipped(SLOW)
    const NOSPACE = 'no queda espacio en el disco'
    if (this.freeBytes(dir) < need + FREE_MARGIN_BYTES) return skipped(NOSPACE)

    const tmps = new Set<string>()
    const cleanTmps = (): void => {
      for (const t of tmps) rmSync(t, { force: true })
      tmps.clear()
    }
    n = 0
    for (const f of todo) {
      const { rel, abs, st } = f
      if (++n % 25 === 0) await yieldLoop()
      if (expired()) {
        cleanTmps()
        return skipped(SLOW)
      }
      const tmp = join(dir, 'objects', `.tmp-${randomBytes(8).toString('hex')}`)
      tmps.add(tmp)
      try {
        await copyFile(abs, tmp, fsc.COPYFILE_FICLONE)
        const hash = await sha256File(tmp)
        const obj = join(dir, 'objects', hash)
        if (existsSync(obj)) rmSync(tmp, { force: true })
        else renameSync(tmp, obj)
        tmps.delete(tmp)
        entries[rel] = { size: st.size, mtimeMs: st.mtimeMs, mode: modeOf(st), hash }
        bytes += st.size
      } catch (err) {
        rmSync(tmp, { force: true })
        tmps.delete(tmp)
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'ENOSPC') {
          cleanTmps()
          return skipped(NOSPACE)
        }
        // Desapareció mientras se copiaba: se omite. Cualquier otro fallo (permisos, E/S…): el archivo EXISTÍA,
        // así que se registra sin copia; omitirlo lo haría pasar por «nuevo» y deshacer lo mandaría a la Papelera.
        if (code === 'ENOENT') continue
        entries[rel] = { size: st.size, mtimeMs: st.mtimeMs, mode: modeOf(st), hash: null, skip: 'unreadable' }
        notCopied++
      }
    }
    const man: Manifest = {
      v: 1,
      entries,
      dirs: w.dirs,
      symlinks: w.symlinks,
      createdAt: startedAt,
      ...(w.unreadableDirs.length ? { unreadableDirs: w.unreadableDirs } : {}),
      ...(w.cloudStubs.length ? { cloudStubs: w.cloudStubs } : {})
    }
    return finish({ files: Object.keys(entries).length, bytes, status: 'ok', ...(notCopied ? { notCopied } : {}) }, man)
  }

  // ───────────────────────────── listar ─────────────────────────────

  list(folder: string, sessionId: string): TasksRestorePoint[] {
    const real = this.realFolder(folder)
    return this.allMetas(this.folderDir(real)).filter((m) => m.sessionId === sessionId)
  }

  // ───────────────────────────── comparar ─────────────────────────────

  private async diffState(real: string, man: Manifest): Promise<Diff[]> {
    const w = await walk(real, Number.MAX_SAFE_INTEGER)
    const out: Diff[] = []
    const seen = new Set<string>()
    const symlinks = new Set(w.symlinks)
    const stubsNow = new Set(w.cloudStubs)
    const stubsThen = new Set(man.cloudStubs ?? [])
    // Debajo de un directorio ilegible (al crear o ahora) no se sabe qué había: ni «nuevo» ni «eliminado».
    const blind = [...(man.unreadableDirs ?? []), ...w.unreadableDirs]
    let n = 0
    for (const f of w.files) {
      seen.add(f.rel)
      if (++n % 100 === 0) await yieldLoop()
      const e = Object.hasOwn(man.entries, f.rel) ? man.entries[f.rel] : undefined
      if (!e) {
        if (isUnder(f.rel, blind) || stubsThen.has(f.rel)) continue
        out.push({ rel: f.rel, status: 'added', cur: f.st })
        continue
      }
      const sameStat = e.size === f.st.size && e.mtimeMs === f.st.mtimeMs
      // Una fecha cercana al punto no basta (FAT/exFAT/HFS+): se confirma por contenido.
      const recent = man.createdAt !== undefined && f.st.mtimeMs >= man.createdAt - MTIME_SLACK_MS
      if (sameStat && !(recent && e.hash)) continue
      // Hoy está «solo en la nube»: no se lee (descargaría); se deja como estaba.
      if (this.isCloud(f.st)) continue
      if (e.hash && f.st.size <= this.limits.maxFileBytes && f.st.size === e.size) {
        try {
          if ((await sha256File(f.abs)) === e.hash) continue
        } catch {
          // ilegible: se trata como modificado
        }
      }
      out.push({ rel: f.rel, status: 'modified', entry: e, cur: f.st })
    }
    for (const [rel, e] of Object.entries(man.entries)) {
      if (seen.has(rel)) continue
      // Un symlink que ocupa el sitio del archivo: no se toca. Un archivo que ahora es un stub de iCloud sigue existiendo.
      if (symlinks.has(rel) || stubsNow.has(rel) || isUnder(rel, blind)) continue
      out.push({ rel, status: 'deleted', entry: e })
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel))
  }

  async changes(folder: string, pointId: string): Promise<{ changes: TasksRestoreChange[]; truncated: boolean }> {
    const real = this.realFolder(folder)
    const dir = this.folderDir(real)
    const man = this.readManifest(dir, pointId)
    if (!man) throw new Error(t('merr.restore.noPoint'))
    const diffs = await this.diffState(real, man)
    const changes: TasksRestoreChange[] = []
    let truncated = false
    let patchBytes = 0
    for (const d of diffs) {
      if (changes.length >= this.limits.maxChanges) {
        truncated = true
        break
      }
      const restorable = d.status === 'added' ? true : !!d.entry?.hash
      const ch: TasksRestoreChange = {
        path: d.rel,
        status: d.status,
        additions: 0,
        deletions: 0,
        binary: true,
        restorable,
        ...(!restorable && d.entry ? { reason: reasonOf(d.entry) } : {})
      }
      let before: Buffer | null = null
      let after: Buffer | null = null
      const oldOk = d.status === 'added' || (d.entry?.hash && d.entry.size <= this.limits.maxDiffFileBytes)
      const newOk = d.status === 'deleted' || (d.cur && d.cur.size <= this.limits.maxDiffFileBytes && !this.isCloud(d.cur))
      if (oldOk && newOk) {
        try {
          before = d.status === 'added' ? Buffer.alloc(0) : readFileSync(join(dir, 'objects', d.entry?.hash as string))
          after = d.status === 'deleted' ? Buffer.alloc(0) : readFileSync(join(real, d.rel))
        } catch {
          before = null
        }
      }
      if (before && after && looksText(before) && looksText(after)) {
        const patch = createTwoFilesPatch(d.rel, d.rel, before.toString('utf8'), after.toString('utf8'), undefined, undefined, {
          context: 3
        })
        const c = countPatch(patch)
        ch.additions = c.additions
        ch.deletions = c.deletions
        ch.binary = false
        if (patchBytes + patch.length <= this.limits.maxPatchBytes) {
          ch.patch = patch
          patchBytes += patch.length
        } else {
          truncated = true
        }
      }
      changes.push(ch)
    }
    return { changes, truncated }
  }

  // ───────────────────────────── restaurar ─────────────────────────────

  /**
   * Comprueba que `rel` queda dentro de `real` sin symlinks intermedios. Con `create`, crea los
   * directorios que falten. Devuelve la ruta absoluta o lanza.
   */
  private safeAbs(real: string, rel: string, create: boolean): string {
    if (!rel || rel.startsWith('/') || rel.includes('\0')) throw new Error('ruta no válida')
    const parts = rel.split('/')
    if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error('ruta no válida')
    let cur = real
    for (let i = 0; i < parts.length - 1; i++) {
      cur = join(cur, parts[i])
      let st: Stats | null = null
      try {
        st = lstatSync(cur)
      } catch {
        st = null
      }
      if (!st) {
        if (!create) throw new Error('falta una carpeta intermedia')
        mkdirSync(cur)
        continue
      }
      if (st.isSymbolicLink()) throw new Error('una carpeta intermedia es un enlace simbólico')
      if (!st.isDirectory()) throw new Error('una carpeta intermedia es un archivo')
    }
    const abs = join(cur, parts[parts.length - 1])
    const back = realpathSync(dirname(abs))
    if (back !== real && !back.startsWith(real + sep)) throw new Error('la ruta sale de la carpeta')
    return abs
  }

  async apply(
    folder: string,
    pointId: string,
    paths?: string[]
  ): Promise<{ restored: number; trashed: number; undoPointId: string; failed: Array<{ path: string; reason: string }> }> {
    const real = this.realFolder(folder)
    return this.serial(real, async () => {
      const dir = this.folderDir(real)
      const man = this.readManifest(dir, pointId)
      if (!man) throw new Error(t('merr.restore.noPoint'))
      const point = this.readMeta(dir, pointId)
      // (1) Antes de tocar nada: punto «Antes de deshacer» (así deshacer también se puede deshacer).
      const undo = await this.createLocked(real, point?.sessionId ?? 'restore', UNDO_LABEL, pointId)
      if (undo.status !== 'ok')
        throw new Error(`No se pudo guardar un punto previo (${undo.reason ?? 'motivo desconocido'}); no se deshizo nada.`)
      let diffs = await this.diffState(real, man)
      const failedUnknown: Array<{ path: string; reason: string }> = []
      if (paths) {
        const want = new Set(paths)
        diffs = diffs.filter((d) => want.has(d.rel))
        const known = new Set(diffs.map((d) => d.rel))
        for (const p of paths) if (!known.has(p)) failedUnknown.push({ path: p, reason: 'no tiene cambios que deshacer' })
      }
      const res = await this.applyDiffs(real, dir, man, diffs, !paths)
      res.failed.push(...failedUnknown)
      return { ...res, undoPointId: undo.id }
    })
  }

  private async applyDiffs(
    real: string,
    dir: string,
    man: Manifest,
    diffs: Diff[],
    sweepDirs: boolean
  ): Promise<{ restored: number; trashed: number; failed: Array<{ path: string; reason: string }> }> {
    let restored = 0
    let trashed = 0
    const failed: Array<{ path: string; reason: string }> = []
    // Primero la Papelera de todo lo nuevo y luego lo que se restaura: en volúmenes que no distinguen
    // mayúsculas un «A.txt» nuevo y un «a.txt» antiguo son el mismo sitio.
    for (const d of diffs) {
      if (d.status !== 'added') continue
      try {
        const abs = this.safeAbs(real, d.rel, false)
        if (lstatSync(abs).isSymbolicLink()) throw new Error('es un enlace simbólico')
        await this.deps.trash(abs)
        trashed++
      } catch (err) {
        failed.push({ path: d.rel, reason: err instanceof Error ? err.message : String(err) })
      }
    }
    for (const d of diffs) {
      if (d.status === 'added') continue
      try {
        const e = d.entry as RestoreEntry
        if (!e.hash) throw new Error(noCopyText(e))
        const obj = join(dir, 'objects', e.hash)
        if (!existsSync(obj)) throw new Error('falta la copia guardada')
        const abs = this.safeAbs(real, d.rel, true)
        let st: Stats | null = null
        try {
          st = lstatSync(abs)
        } catch {
          st = null
        }
        if (st && (st.isSymbolicLink() || st.isDirectory())) throw new Error('el sitio lo ocupa un enlace o una carpeta')
        const tmp = join(dirname(abs), `.onyxcode-restore-${randomBytes(6).toString('hex')}`)
        try {
          await copyFile(obj, tmp, fsc.COPYFILE_FICLONE)
          try {
            chmodSync(tmp, e.mode & 0o7777)
          } catch {
            // mejor esfuerzo (algunos volúmenes no admiten permisos)
          }
          renameSync(tmp, abs)
        } catch (err) {
          rmSync(tmp, { force: true })
          throw err
        }
        restored++
      } catch (err) {
        failed.push({ path: d.rel, reason: err instanceof Error ? err.message : String(err) })
      }
    }
    if (sweepDirs) trashed += await this.sweepNewDirs(real, man)
    return { restored, trashed, failed }
  }

  /** Carpetas creadas después del punto que quedaron vacías: a la Papelera, de la más profunda a la más alta. */
  private async sweepNewDirs(real: string, man: Manifest): Promise<number> {
    const known = new Set(man.dirs)
    const w = await walk(real, Number.MAX_SAFE_INTEGER)
    const blind = man.unreadableDirs ?? []
    const fresh = w.dirs.filter((d) => !known.has(d) && !isUnder(d, blind)).sort((a, b) => b.split('/').length - a.split('/').length)
    let n = 0
    for (const rel of fresh) {
      try {
        const abs = this.safeAbs(real, rel, false)
        if (readdirSync(abs).some((name) => !isIgnorableName(name))) continue
        await this.deps.trash(abs)
        n++
      } catch {
        // se deja
      }
    }
    return n
  }

  // ───────────────────────────── olvidar / uso ─────────────────────────────

  /** Borra los puntos de una tarea en todas las carpetas del almacén y recoge los huérfanos. */
  async forget(sessionId: string): Promise<void> {
    await this.idle()
    let dirs: string[] = []
    try {
      dirs = readdirSync(this.deps.root)
    } catch {
      return
    }
    for (const d of dirs) {
      const dir = join(this.deps.root, d)
      let any = false
      for (const m of this.allMetas(dir)) {
        if (m.sessionId !== sessionId) continue
        this.removePoint(dir, m.id)
        any = true
      }
      if (any) this.gcFolder(dir)
    }
  }

  /** Borra todo el almacén. */
  async clearAll(): Promise<void> {
    await this.idle()
    rmSync(this.deps.root, { recursive: true, force: true })
  }
}
