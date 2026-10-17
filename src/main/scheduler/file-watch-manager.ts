/**
 * Dueño de los vigilantes de carpeta de las Rutinas: uno por rutina con disparador por archivo, creado y destruido
 * SIEMPRE desde `sync()` (se llama cuando cambia la lista de rutinas, en cada tick y al cerrar). Nada de vigilantes
 * sin dueño: al borrar, pausar o cambiar la carpeta/filtros de la rutina, o al llamar `stopAll()`, se cierra el
 * `fs.watch` y se cancelan los temporizadores.
 *
 * El acceso al disco entra inyectado (`FsLike`) para probar el ciclo de vida sin tocar el sistema de archivos.
 */
import { closeSync, lstatSync, openSync, readdirSync, realpathSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { RoutineFileSchedule, ScheduledRoutine } from '@shared/ipc-tasks'
import { FileTriggerEngine, type FileStat, type FileTriggerSnapshot } from './file-trigger'

export interface WatchHandle {
  close(): void
}

export interface FsLike {
  /** Vigila `dir` (sin recursión). El callback recibe el nombre afectado. `onError` si el vigilante muere. */
  watch(dir: string, onEvent: (name: string | null) => void, onError: (err: Error) => void): WatchHandle
  realpath(p: string): string
  lstat(p: string): FileStat | null
  list(dir: string): string[]
  canOpen(p: string): boolean
}

export const nodeFs: FsLike = {
  watch(dir, onEvent, onError) {
    const w: FSWatcher = fsWatch(dir, { persistent: false }, (_ev, name) => onEvent(name ? String(name) : null))
    w.on('error', onError)
    return { close: () => w.close() }
  },
  realpath: (p) => realpathSync.native(p),
  lstat(p) {
    try {
      const st = lstatSync(p)
      return { size: st.size, mtimeMs: st.mtimeMs, isFile: st.isFile(), isSymlink: st.isSymbolicLink() }
    } catch {
      return null
    }
  },
  list(dir) {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  },
  canOpen(p) {
    try {
      closeSync(openSync(p, 'r'))
      return true
    } catch {
      return false
    }
  }
}

export interface WatchManagerDeps {
  fs?: FsLike
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** Validación de la carpeta de la rutina en este momento (autorización/política); devuelve el motivo o null. */
  folderProblem(routine: ScheduledRoutine, schedule: RoutineFileSchedule): string | null
  /** ¿Puede dispararse algo ahora? (aviso de términos, política de la organización). */
  allowed(): boolean
  isRunning(routineId: string): boolean
  onFire(routine: ScheduledRoutine, names: string[], folder: string): void
  onCapped?(routine: ScheduledRoutine, names: string[]): void
  onLost?(routineId: string): void
}

interface Entry {
  key: string
  routineId: string
  folder: string
  engine: FileTriggerEngine
  handle: WatchHandle
}

const keyOf = (r: ScheduledRoutine, s: RoutineFileSchedule): string =>
  JSON.stringify([s.folder, s.patterns, s.on, s.settleSec, s.maxPerHour, r.mode, r.folder ?? null])

export class FileWatchManager {
  private readonly entries = new Map<string, Entry>()
  private readonly lost = new Set<string>()
  private readonly fs: FsLike
  private readonly now: () => number
  private readonly setT: (fn: () => void, ms: number) => unknown
  private readonly clearT: (h: unknown) => void

  constructor(private readonly deps: WatchManagerDeps) {
    this.fs = deps.fs ?? nodeFs
    this.now = deps.now ?? Date.now
    this.setT = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearT = deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout))
  }

  /** Deja vigilando exactamente las rutinas activas con disparador por archivo. */
  sync(routines: ScheduledRoutine[]): void {
    const wanted = new Map<string, { r: ScheduledRoutine; s: RoutineFileSchedule }>()
    if (this.deps.allowed()) {
      for (const r of routines) {
        if (r.enabled && r.schedule.kind === 'file') wanted.set(r.id, { r, s: r.schedule })
      }
    }
    for (const [id, e] of [...this.entries]) {
      const w = wanted.get(id)
      if (!w || keyOf(w.r, w.s) !== e.key || this.deps.folderProblem(w.r, w.s) !== null) this.drop(id)
    }
    for (const id of [...this.lost]) if (!wanted.has(id)) this.lost.delete(id)
    for (const [id, { r, s }] of wanted) if (!this.entries.has(id)) this.start(id, r, s)
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.drop(id)
    this.lost.clear()
  }

  /** Avisa al motor de que la rutina terminó (lo que se escriba ahora es suyo). */
  runFinished(routineId: string): void {
    this.entries.get(routineId)?.engine.runFinished()
  }

  state(routineId: string): { state: 'watching' | 'lost' | 'off'; snapshot?: FileTriggerSnapshot } {
    const e = this.entries.get(routineId)
    if (e) return { state: 'watching', snapshot: e.engine.snapshot() }
    return { state: this.lost.has(routineId) ? 'lost' : 'off' }
  }

  /** Para pruebas y diagnóstico: cuántos vigilantes hay vivos. */
  get size(): number {
    return this.entries.size
  }

  private drop(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    this.entries.delete(id)
    e.engine.dispose()
    try {
      e.handle.close()
    } catch {
      // ya estaba cerrado
    }
  }

  private start(id: string, r: ScheduledRoutine, s: RoutineFileSchedule): void {
    if (this.deps.folderProblem(r, s) !== null) {
      this.lost.add(id)
      return
    }
    let folder: string
    try {
      folder = this.fs.realpath(s.folder) // se vigila la ruta real: un enlace cambiado después no redirige el vigilante
    } catch {
      this.lost.add(id)
      return
    }
    const engine = new FileTriggerEngine(s, {
      now: this.now,
      setTimer: this.setT,
      clearTimer: this.clearT,
      stat: (name) => this.fs.lstat(join(folder, name)),
      canOpen: (name) => this.fs.canOpen(join(folder, name)),
      isBusy: () => this.deps.isRunning(id),
      fire: (names) => {
        const live = r
        this.deps.onFire(live, names, folder)
      },
      capped: (names) => this.deps.onCapped?.(r, names)
    })
    engine.seed(
      this.fs
        .list(folder)
        .map((name) => ({ name, stat: this.fs.lstat(join(folder, name)) }))
        .filter((e): e is { name: string; stat: FileStat } => e.stat !== null)
    )
    let handle: WatchHandle
    try {
      handle = this.fs.watch(
        folder,
        (name) => engine.event(name),
        () => {
          // EMFILE/ENOSPC/carpeta borrada o desmontada: se libera y el siguiente sync lo reintenta.
          this.drop(id)
          this.lost.add(id)
          this.deps.onLost?.(id)
        }
      )
    } catch {
      engine.dispose()
      this.lost.add(id)
      return
    }
    this.lost.delete(id)
    this.entries.set(id, { key: keyOf(r, s), routineId: id, folder, engine, handle })
  }
}
