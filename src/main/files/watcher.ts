/**
 * Vigilante de los archivos del proyecto (sin polling): eventos del sistema de archivos con `fs.watch`.
 *
 *  - macOS/Windows: un vigilante RECURSIVO por proyecto. Linux no lo soporta de forma fiable: se degrada a vigilar
 *    solo las carpetas abiertas en el panel (`setDirs`); si tampoco se puede, queda el botón de refresco manual.
 *  - Coalescencia: los eventos se agrupan (≈200 ms tras el último, como mucho 1 s de espera) en un solo aviso con
 *    la lista de carpetas afectadas (`null` = demasiadas, refrescar todo).
 *  - Se ignora todo lo que cuelga de `.git`, `node_modules` y directorios de build habituales.
 *  - Topes de vigilantes y errores (EMFILE/ENOSPC/carpeta borrada o desconectada) sin tumbar la app: se libera
 *    el vigilante y se avisa con `status: 'lost'`.
 * Sin Electron: el `watch` y el envío de eventos llegan inyectados para poder probarlo.
 */
import { lstatSync, realpathSync, statSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { isAbsolute, join, sep } from 'node:path'
import type { FilesChangedEvent, FilesWatchMode } from '@shared/ipc-code'

/** Carpetas cuyo CONTENIDO no se vigila (su propia aparición/desaparición sí cuenta como cambio de la carpeta padre). */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.cache',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.gradle',
  'coverage'
])

export const isIgnoredName = (name: string): boolean => IGNORED_DIRS.has(name)

/** Ruta relativa (`/` o `\`) → partes sin vacíos ni `.`. */
function parts(rel: string): string[] {
  return rel.split(/[\\/]/).filter((p) => p !== '' && p !== '.')
}

/**
 * Carpeta (relativa, `.` = raíz) cuyo listado cambia por un evento sobre `rel`; `null` si el evento cae dentro de
 * una carpeta ignorada o es inválido. El último componente puede ser ignorado (p. ej. aparece `dist`): cuenta.
 */
export function changedDirFor(rel: string | null | undefined): string | null {
  if (typeof rel !== 'string' || rel === '') return null
  const p = parts(rel)
  if (p.length === 0 || p.includes('..')) return null
  const dirPart = p.slice(0, -1)
  if (dirPart.some(isIgnoredName)) return null
  return dirPart.length === 0 ? '.' : dirPart.join('/')
}

/** Carpeta relativa válida y no ignorada para vigilar (modo `dirs`); `null` si no. */
export function normalizeWatchDir(rel: unknown): string | null {
  if (typeof rel !== 'string' || rel.length > 4096 || rel.includes('\0')) return null
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null
  const p = parts(rel)
  if (p.includes('..') || p.some(isIgnoredName)) return null
  return p.length === 0 ? '.' : p.join('/')
}

export interface CoalescerOptions {
  delayMs?: number
  maxWaitMs?: number
  maxDirs?: number
}

/** Agrupa carpetas cambiadas: un `flush` tras `delayMs` sin novedades (y como mucho `maxWaitMs` desde la primera). */
export function createCoalescer(flush: (dirs: string[] | null) => void, opts: CoalescerOptions = {}) {
  const delay = opts.delayMs ?? 200
  const maxWait = opts.maxWaitMs ?? 1000
  const maxDirs = opts.maxDirs ?? 200
  let dirs = new Set<string>()
  let overflow = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let first = 0
  const fire = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    const out = overflow ? null : [...dirs]
    dirs = new Set()
    overflow = false
    flush(out)
  }
  return {
    add(dir: string | null): void {
      if (dir === null) overflow = true
      else if (!overflow) {
        dirs.add(dir)
        if (dirs.size > maxDirs) overflow = true
      }
      const now = Date.now()
      if (!timer) first = now
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, Math.max(0, Math.min(delay, first + maxWait - now)))
    },
    cancel(): void {
      if (timer) clearTimeout(timer)
      timer = null
      dirs = new Set()
      overflow = false
    },
    pending: (): boolean => timer !== null
  }
}

export interface WatchHubDeps {
  watch?: typeof fsWatch
  platform?: string
  maxRecursive?: number
  maxDirWatchers?: number
  delayMs?: number
  maxWaitMs?: number
  exists?: (p: string) => boolean
}

interface Sub {
  wcId: number
  dirs: Set<string>
}
interface Entry {
  root: string
  mode: FilesWatchMode
  subs: Map<string, Sub>
  watchers: Map<string, FSWatcher>
  coalescer: ReturnType<typeof createCoalescer>
}

/** `recursive` solo donde `fs.watch` lo soporta de forma nativa y eficiente. */
export function watchModeFor(platform: string): Exclude<FilesWatchMode, 'none'> {
  return platform === 'darwin' || platform === 'win32' ? 'recursive' : 'dirs'
}

export class FileWatchHub {
  private entries = new Map<string, Entry>()
  private bySub = new Map<string, string>() // `${wcId}:${subId}` -> clave de carpeta
  private readonly watchFn: typeof fsWatch
  private readonly platform: string
  private readonly maxRecursive: number
  private readonly maxDirWatchers: number
  private readonly exists: (p: string) => boolean

  constructor(
    private readonly emit: (wcId: number, ev: FilesChangedEvent) => void,
    private readonly deps: WatchHubDeps = {}
  ) {
    this.watchFn = deps.watch ?? fsWatch
    this.platform = deps.platform ?? process.platform
    this.maxRecursive = deps.maxRecursive ?? 8
    this.maxDirWatchers = deps.maxDirWatchers ?? 120
    this.exists =
      deps.exists ??
      ((p) => {
        try {
          return statSync(p).isDirectory()
        } catch {
          return false
        }
      })
  }

  private key(wcId: number, subId: string): string {
    return `${wcId}:${subId}`
  }

  /** Total de vigilantes abiertos (para pruebas y topes). */
  watcherCount(): number {
    let n = 0
    for (const e of this.entries.values()) n += e.watchers.size
    return n
  }

  private count(mode: 'recursive' | 'dirs'): number {
    let n = 0
    for (const e of this.entries.values()) if (e.mode === mode) n += e.watchers.size
    return n
  }

  /** ¿Esta ventana tiene `folder` como proyecto activo? (lo usan el gestor de archivos y «Abrir en…»). */
  isActive(wcId: number, folder: string): boolean {
    let real = folder
    try {
      real = realpathSync(folder)
    } catch {
      // carpeta inexistente: se compara tal cual
    }
    const e = this.entries.get(real)
    if (!e) return false
    for (const s of e.subs.values()) if (s.wcId === wcId) return true
    return false
  }

  subscribe(wcId: number, folder: string, subId: string): { mode: FilesWatchMode } {
    this.unsubscribe(wcId, subId)
    let real: string
    try {
      real = realpathSync(folder)
      if (!statSync(real).isDirectory()) throw new Error('no es carpeta')
    } catch {
      // Carpeta no accesible: se registra igualmente (sin vigilante) y se avisa como perdida.
      const e = this.entry(folder)
      e.subs.set(subId, { wcId, dirs: new Set() })
      this.bySub.set(this.key(wcId, subId), folder)
      e.mode = 'none'
      queueMicrotask(() => this.emit(wcId, { subId, dirs: null, status: 'lost' }))
      return { mode: 'none' }
    }
    const e = this.entry(real)
    e.subs.set(subId, { wcId, dirs: new Set() })
    this.bySub.set(this.key(wcId, subId), real)
    const want = watchModeFor(this.platform)
    if (want === 'recursive') {
      if (e.watchers.size === 0 && e.mode !== 'none') {
        if (this.count('recursive') >= this.maxRecursive) e.mode = 'none'
        else this.openRecursive(e)
      } else if (e.watchers.size === 0) {
        // Entrada que se perdió antes: reintentar con la nueva suscripción.
        if (this.count('recursive') < this.maxRecursive) this.openRecursive(e)
      }
      return { mode: e.mode }
    }
    e.mode = 'dirs'
    this.syncDirs(e)
    return { mode: 'dirs' }
  }

  private entry(key: string): Entry {
    let e = this.entries.get(key)
    if (!e) {
      const created: Entry = {
        root: key,
        mode: watchModeFor(this.platform),
        subs: new Map(),
        watchers: new Map(),
        coalescer: createCoalescer((dirs) => this.flush(created, dirs), {
          delayMs: this.deps.delayMs,
          maxWaitMs: this.deps.maxWaitMs
        })
      }
      this.entries.set(key, created)
      e = created
    }
    return e
  }

  private openRecursive(e: Entry): void {
    try {
      const w = this.watchFn(e.root, { recursive: true, persistent: false }, (_evt, filename) => {
        const name = typeof filename === 'string' ? filename : filename ? String(filename) : null
        const dir = changedDirFor(name)
        if (dir !== null) e.coalescer.add(dir)
      })
      w.on('error', (err) => this.lose(e, err))
      e.watchers.set('.', w)
      e.mode = 'recursive'
    } catch (err) {
      this.lose(e, err)
    }
  }

  /** Modo `dirs`: abre/cierra vigilantes (no recursivos) para la unión de carpetas pedidas por las suscripciones. */
  private syncDirs(e: Entry): void {
    if (e.mode !== 'dirs') return
    const wanted = new Set<string>(['.'])
    for (const s of e.subs.values()) for (const d of s.dirs) wanted.add(d)
    for (const [d, w] of e.watchers) {
      if (!wanted.has(d)) {
        w.close()
        e.watchers.delete(d)
      }
    }
    for (const d of wanted) {
      if (e.watchers.has(d)) continue
      if (this.count('dirs') >= this.maxDirWatchers) break
      const abs = d === '.' ? e.root : join(e.root, ...d.split('/'))
      try {
        if (d !== '.') {
          // Nada de enlaces simbólicos que saquen del proyecto.
          if (lstatSync(abs).isSymbolicLink()) continue
          const real = realpathSync(abs)
          if (real !== e.root && !real.startsWith(e.root + sep)) continue
        }
        const w = this.watchFn(abs, { persistent: false }, () => e.coalescer.add(d))
        w.on('error', (err) => {
          // Una carpeta abierta desapareció: se suelta solo ese vigilante y el padre avisará.
          w.close()
          e.watchers.delete(d)
          if (d === '.') this.lose(e, err)
          else e.coalescer.add(d)
        })
        e.watchers.set(d, w)
      } catch (err) {
        if (d === '.') return this.lose(e, err)
        // Una subcarpeta sin vigilar (límite del sistema o desaparecida) no tumba el resto.
      }
    }
  }

  setDirs(wcId: number, subId: string, dirs: unknown[]): void {
    const k = this.bySub.get(this.key(wcId, subId))
    const e = k ? this.entries.get(k) : undefined
    const sub = e?.subs.get(subId)
    if (!e || !sub || sub.wcId !== wcId) return
    const next = new Set<string>()
    for (const d of dirs.slice(0, 100)) {
      const n = normalizeWatchDir(d)
      if (n !== null) next.add(n)
    }
    sub.dirs = next
    this.syncDirs(e)
  }

  unsubscribe(wcId: number, subId: string): void {
    const k = this.bySub.get(this.key(wcId, subId))
    this.bySub.delete(this.key(wcId, subId))
    const e = k ? this.entries.get(k) : undefined
    if (!k || !e) return
    e.subs.delete(subId)
    if (e.subs.size === 0) {
      this.close(e)
      this.entries.delete(k)
    } else this.syncDirs(e)
  }

  /** Ventana cerrada/recargada: suelta todas sus suscripciones. */
  releaseSender(wcId: number): void {
    for (const k of [...this.bySub.keys()]) {
      if (k.startsWith(`${wcId}:`)) this.unsubscribe(wcId, k.slice(String(wcId).length + 1))
    }
  }

  closeAll(): void {
    for (const e of this.entries.values()) this.close(e)
    this.entries.clear()
    this.bySub.clear()
  }

  private close(e: Entry): void {
    e.coalescer.cancel()
    for (const w of e.watchers.values()) {
      try {
        w.close()
      } catch {
        // ya cerrado
      }
    }
    e.watchers.clear()
  }

  private flush(e: Entry, dirs: string[] | null): void {
    if (!this.exists(e.root)) return this.lose(e, new Error('ENOENT'))
    for (const [subId, s] of e.subs) this.emit(s.wcId, { subId, dirs, status: 'ok' })
  }

  private lose(e: Entry, err: unknown): void {
    if (e.mode === 'none' && e.watchers.size === 0) return
    console.warn(`[files] vigilancia perdida (${(err as NodeJS.ErrnoException)?.code ?? (err as Error)?.message ?? 'error'}): ${e.root}`)
    this.close(e)
    e.mode = 'none'
    for (const [subId, s] of e.subs) this.emit(s.wcId, { subId, dirs: null, status: 'lost' })
  }
}
