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
 * Garantías y límites (ver docs/SEGURIDAD.md): recorrido sin seguir symlinks (se registran y
 * nunca se restauran); se excluyen `.git/`, `node_modules/` y `.onyxcode/`; 20 000 archivos,
 * 50 MB por archivo y 2 GB en total; restaurar crea antes un punto «Antes de deshacer»; lo creado
 * después va a la Papelera (nunca se borra); cada ruta se valida contra symlinks intermedios.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  constants as fsc,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Stats
} from 'node:fs'
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
}

export const DEFAULT_LIMITS: RestoreLimits = {
  maxFiles: 20_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxPointsPerSession: 20,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxDiffFileBytes: 1024 * 1024,
  maxPatchBytes: 2 * 1024 * 1024,
  maxChanges: 5000
}

export interface RestoreDeps {
  /** `userData/restore-points`. */
  root: string
  /** Envía un archivo a la Papelera (nunca se borra). */
  trash: (path: string) => Promise<void>
  now?: () => number
  limits?: Partial<RestoreLimits>
}

export interface RestoreEntry {
  size: number
  mtimeMs: number
  mode: number
  /** `null` si el archivo no se copió (más de 50 MB). */
  hash: string | null
}

interface Manifest {
  v: 1
  entries: Record<string, RestoreEntry>
  /** Directorios (relativos) que existían, incluidos los vacíos. */
  dirs: string[]
  /** Symlinks registrados (jamás se restauran ni se tocan). */
  symlinks: string[]
}

export const EXCLUDED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules', '.onyxcode'])
const OBJECT_RE = /^[a-f0-9]{64}$/
const ID_RE = /^[a-f0-9]{1,64}$/
const UNDO_LABEL = 'Antes de deshacer'

interface Walked {
  files: Array<{ rel: string; abs: string; st: Stats }>
  dirs: string[]
  symlinks: string[]
  overLimit: boolean
}

/** Cede el hilo para no congelar el proceso principal en carpetas grandes. */
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

/** Recorre sin seguir symlinks y sin entrar en directorios excluidos. */
async function walk(root: string, maxFiles: number): Promise<Walked> {
  const out: Walked = { files: [], dirs: [], symlinks: [], overLimit: false }
  const stack: string[] = ['']
  let n = 0
  while (stack.length) {
    const relDir = stack.pop() as string
    let names: string[]
    try {
      names = readdirSync(join(root, relDir))
    } catch {
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
        out.files.push({ rel, abs, st })
        if (out.files.length > maxFiles) {
          out.overLimit = true
          return out
        }
      }
      if (++n % 400 === 0) await yieldLoop()
    }
  }
  return out
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

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
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: RestoreDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits }
    this.now = deps.now ?? Date.now
  }

  // ───────────────────────────── almacén ─────────────────────────────

  private realFolder(folder: string): string {
    return realpathSync(resolve(folder))
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

  create(folder: string, sessionId: string, label: string): Promise<TasksRestorePoint> {
    const real = this.realFolder(folder)
    return this.serial(real, () => this.createLocked(real, sessionId, label))
  }

  private async createLocked(real: string, sessionId: string, label: string, keepId?: string): Promise<TasksRestorePoint> {
    const dir = this.folderDir(real)
    this.ensureDirs(dir)
    const id = randomBytes(16).toString('hex')
    const base = { id, sessionId, folder: real, createdAt: this.now(), label: label.slice(0, 200) }
    const finish = (p: Omit<TasksRestorePoint, keyof typeof base>, man: Manifest): TasksRestorePoint => {
      const meta: TasksRestorePoint = { ...base, ...p }
      writeFileSync(join(dir, 'points', `${id}.json`), JSON.stringify(man), { mode: 0o600 })
      writeFileSync(join(dir, 'points', `${id}.meta.json`), JSON.stringify(meta), { mode: 0o600 })
      const pruned = this.prune(dir, [id, ...(keepId ? [keepId] : [])])
      if (pruned > 0) this.gcFolder(dir)
      return meta
    }
    const empty: Manifest = { v: 1, entries: {}, dirs: [], symlinks: [] }
    const w = await walk(real, this.limits.maxFiles)
    if (w.overLimit) {
      return finish(
        { files: 0, bytes: 0, status: 'skipped', reason: `la carpeta tiene más de ${this.limits.maxFiles.toLocaleString('es')} archivos` },
        empty
      )
    }
    let total = 0
    for (const f of w.files) if (f.st.size <= this.limits.maxFileBytes) total += f.st.size
    if (total > this.limits.maxTotalBytes) {
      return finish({ files: 0, bytes: 0, status: 'skipped', reason: 'la carpeta ocupa más de 2 GB' }, empty)
    }

    // Punto anterior de la carpeta (el más reciente con manifiesto): reutiliza hashes si coincide tamaño y fecha.
    const metas = this.allMetas(dir)
    const prev = metas.length ? this.readManifest(dir, metas[metas.length - 1].id) : null
    const entries: Record<string, RestoreEntry> = Object.create(null)
    let bytes = 0
    let n = 0
    for (const f of w.files) {
      const { rel, abs, st } = f
      if (++n % 100 === 0) await yieldLoop()
      if (st.size > this.limits.maxFileBytes) {
        entries[rel] = { size: st.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o7777, hash: null }
        continue
      }
      const old = prev && Object.hasOwn(prev.entries, rel) ? prev.entries[rel] : undefined
      if (old && old.hash && old.size === st.size && old.mtimeMs === st.mtimeMs && existsSync(join(dir, 'objects', old.hash))) {
        entries[rel] = { ...old, mode: st.mode & 0o7777 }
        bytes += st.size
        continue
      }
      const tmp = join(dir, 'objects', `.tmp-${randomBytes(8).toString('hex')}`)
      try {
        copyFileSync(abs, tmp, fsc.COPYFILE_FICLONE)
        const hash = sha256File(tmp)
        const obj = join(dir, 'objects', hash)
        if (existsSync(obj)) rmSync(tmp, { force: true })
        else renameSync(tmp, obj)
        entries[rel] = { size: st.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o7777, hash }
        bytes += st.size
      } catch {
        // el archivo desapareció o no se pudo leer mientras se copiaba: se omite
        rmSync(tmp, { force: true })
      }
    }
    return finish({ files: Object.keys(entries).length, bytes, status: 'ok' }, { v: 1, entries, dirs: w.dirs, symlinks: w.symlinks })
  }

  // ───────────────────────────── listar ─────────────────────────────

  list(folder: string, sessionId: string): TasksRestorePoint[] {
    const real = this.realFolder(folder)
    return this.allMetas(this.folderDir(real)).filter((m) => m.sessionId === sessionId)
  }

  // ───────────────────────────── comparar ─────────────────────────────

  private async diffState(
    real: string,
    man: Manifest
  ): Promise<Array<{ rel: string; status: 'added' | 'modified' | 'deleted'; entry?: RestoreEntry; cur?: Stats }>> {
    const w = await walk(real, Number.MAX_SAFE_INTEGER)
    const out: Array<{ rel: string; status: 'added' | 'modified' | 'deleted'; entry?: RestoreEntry; cur?: Stats }> = []
    const seen = new Set<string>()
    const symlinks = new Set(w.symlinks)
    let n = 0
    for (const f of w.files) {
      seen.add(f.rel)
      if (++n % 100 === 0) await yieldLoop()
      const e = Object.hasOwn(man.entries, f.rel) ? man.entries[f.rel] : undefined
      if (!e) {
        out.push({ rel: f.rel, status: 'added', cur: f.st })
        continue
      }
      if (e.size === f.st.size && e.mtimeMs === f.st.mtimeMs) continue
      if (e.hash && f.st.size <= this.limits.maxFileBytes && f.st.size === e.size) {
        try {
          if (sha256File(f.abs) === e.hash) continue
        } catch {
          // ilegible: se trata como modificado
        }
      }
      out.push({ rel: f.rel, status: 'modified', entry: e, cur: f.st })
    }
    for (const [rel, e] of Object.entries(man.entries)) {
      if (seen.has(rel)) continue
      // Un symlink que ocupa el sitio del archivo: no se toca.
      if (symlinks.has(rel)) continue
      out.push({ rel, status: 'deleted', entry: e })
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel))
  }

  async changes(folder: string, pointId: string): Promise<{ changes: TasksRestoreChange[]; truncated: boolean }> {
    const real = this.realFolder(folder)
    const dir = this.folderDir(real)
    const man = this.readManifest(dir, pointId)
    if (!man) throw new Error('No existe ese punto de restauración.')
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
      const ch: TasksRestoreChange = { path: d.rel, status: d.status, additions: 0, deletions: 0, binary: true, restorable }
      let before: Buffer | null = null
      let after: Buffer | null = null
      const oldOk = d.status === 'added' || (d.entry?.hash && d.entry.size <= this.limits.maxDiffFileBytes)
      const newOk = d.status === 'deleted' || (d.cur && d.cur.size <= this.limits.maxDiffFileBytes)
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
      if (!man) throw new Error('No existe ese punto de restauración.')
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
    diffs: Array<{ rel: string; status: 'added' | 'modified' | 'deleted'; entry?: RestoreEntry }>,
    sweepDirs: boolean
  ): Promise<{ restored: number; trashed: number; failed: Array<{ path: string; reason: string }> }> {
    let restored = 0
    let trashed = 0
    const failed: Array<{ path: string; reason: string }> = []
    for (const d of diffs) {
      try {
        if (d.status === 'added') {
          const abs = this.safeAbs(real, d.rel, false)
          if (lstatSync(abs).isSymbolicLink()) throw new Error('es un enlace simbólico')
          await this.deps.trash(abs)
          trashed++
          continue
        }
        const e = d.entry as RestoreEntry
        if (!e.hash) throw new Error('no se guardó (más de 50 MB)')
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
          copyFileSync(obj, tmp, fsc.COPYFILE_FICLONE)
          chmodSync(tmp, e.mode & 0o7777)
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
    const fresh = w.dirs.filter((d) => !known.has(d)).sort((a, b) => b.split('/').length - a.split('/').length)
    let n = 0
    for (const rel of fresh) {
      try {
        const abs = this.safeAbs(real, rel, false)
        if (readdirSync(abs).length > 0) continue
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
  forget(sessionId: string): void {
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
  clearAll(): void {
    rmSync(this.deps.root, { recursive: true, force: true })
  }
}
