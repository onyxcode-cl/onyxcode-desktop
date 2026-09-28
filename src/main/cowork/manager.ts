/**
 * Gestor de Cowork: carpetas autorizadas (userData/cowork.json) y un `opencode serve`
 * sandboxeado por carpeta (arranque perezoso, reutilizado, detenido al salir).
 */
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { CoworkConnection, CoworkDeliverable, CoworkFolder, CoworkServerInfo } from '@shared/ipc-cowork'
import { startCoworkServer, type CoworkServerHandle } from './sandbox'

interface Persisted {
  folders: CoworkFolder[]
}

interface Entry {
  info: CoworkServerInfo
  handle?: CoworkServerHandle
  starting?: Promise<CoworkServerHandle>
}

interface ManagerEvents {
  server: [CoworkServerInfo]
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.opencode', '.venv', '__pycache__', '.DS_Store'])
const MAX_SCAN_FILES = 5000

function normalizeFolder(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

/** Carpetas que nunca se autorizan (demasiado amplias o del sistema). */
export function forbiddenFolderReason(folder: string): string | null {
  const f = normalizeFolder(folder)
  const home = normalizeFolder(homedir())
  if (f === '/' || f === home) return 'No se puede autorizar la raíz ni tu carpeta personal completa.'
  if (home.startsWith(f + sep)) return 'La carpeta contiene tu carpeta personal; elige una más específica.'
  const system = ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/private/etc', '/opt', '/Volumes']
  if (system.some((s) => f === s || (f.startsWith(s + sep) && s !== '/Volumes'))) {
    return 'No se permiten carpetas del sistema.'
  }
  if (f === '/Volumes') return 'Elige una carpeta dentro del volumen.'
  const sensitive = ['.ssh', '.aws', '.gnupg', 'Library'].map((d) => join(home, d))
  if (sensitive.some((s) => f === s || f.startsWith(s + sep))) return 'Esa carpeta contiene datos sensibles.'
  return null
}

export class CoworkManager extends EventEmitter<ManagerEvents> {
  private servers = new Map<string, Entry>()
  private data: Persisted | null = null

  constructor(private readonly opts: { corsOrigins?: string[] } = {}) {
    super()
  }

  private get file(): string {
    return join(app.getPath('userData'), 'cowork.json')
  }

  private load(): Persisted {
    if (this.data) return this.data
    let data: Persisted = { folders: [] }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        if (Array.isArray(raw.folders)) {
          data.folders = raw.folders.filter(
            (f): f is CoworkFolder => !!f && typeof f.path === 'string' && typeof f.approvedAt === 'number'
          )
        }
      }
    } catch (err) {
      console.error('[cowork] cowork.json inválido:', err)
      data = { folders: [] }
    }
    this.data = data
    return data
  }

  private save(): void {
    const file = this.file
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(this.load(), null, 2), 'utf8')
    renameSync(`${file}.tmp`, file)
  }

  listFolders(): CoworkFolder[] {
    return [...this.load().folders].sort((a, b) => (b.lastUsedAt ?? b.approvedAt) - (a.lastUsedAt ?? a.approvedAt))
  }

  isApproved(folder: string): boolean {
    const f = normalizeFolder(folder)
    return this.load().folders.some((x) => x.path === f)
  }

  approveFolder(folder: string): CoworkFolder {
    const f = normalizeFolder(folder)
    if (!existsSync(f) || !statSync(f).isDirectory()) throw new Error(`No es una carpeta válida: ${f}`)
    const reason = forbiddenFolderReason(f)
    if (reason) throw new Error(reason)
    const data = this.load()
    let entry = data.folders.find((x) => x.path === f)
    if (!entry) {
      entry = { path: f, name: basename(f), approvedAt: Date.now() }
      data.folders.push(entry)
      this.save()
    }
    return entry
  }

  async removeFolder(folder: string): Promise<void> {
    const f = normalizeFolder(folder)
    await this.stop(f)
    const data = this.load()
    data.folders = data.folders.filter((x) => x.path !== f)
    this.save()
  }

  private touch(folder: string): void {
    const entry = this.load().folders.find((x) => x.path === folder)
    if (entry) {
      entry.lastUsedAt = Date.now()
      this.save()
    }
  }

  listServers(): CoworkServerInfo[] {
    return [...this.servers.values()].map((e) => e.info)
  }

  private setInfo(folder: string, patch: Partial<CoworkServerInfo>): void {
    const entry = this.servers.get(folder) ?? { info: { folder, state: 'stopped', sandboxed: false } }
    entry.info = { ...entry.info, ...patch, folder }
    this.servers.set(folder, entry)
    this.emit('server', entry.info)
  }

  /** Arranca o reutiliza el servidor de una carpeta ya autorizada. */
  async start(folder: string): Promise<CoworkConnection> {
    const f = normalizeFolder(folder)
    if (!this.isApproved(f)) throw new Error('La carpeta no está autorizada para Cowork.')
    const existing = this.servers.get(f)
    let handle = existing?.handle
    if (!handle || existing?.info.state !== 'ready') {
      handle = await (existing?.starting ?? this.spawn(f))
    }
    this.touch(f)
    return {
      folder: f,
      baseUrl: handle.baseUrl,
      authorization: handle.authorization,
      sandboxed: handle.sandboxed,
      version: handle.version
    }
  }

  private spawn(folder: string): Promise<CoworkServerHandle> {
    this.setInfo(folder, { state: 'starting', error: undefined })
    const starting = startCoworkServer(folder, {
      corsOrigins: this.opts.corsOrigins,
      onExit: (code) => {
        const e = this.servers.get(folder)
        if (!e) return
        e.handle = undefined
        if (e.info.state === 'ready') {
          this.setInfo(folder, { state: 'error', error: `El servidor de Cowork terminó (code=${code})` })
        }
      }
    })
    const entry = this.servers.get(folder)
    if (entry) entry.starting = starting
    return starting.then(
      (handle) => {
        const e = this.servers.get(folder)
        if (e) {
          e.handle = handle
          e.starting = undefined
        }
        this.setInfo(folder, { state: 'ready', sandboxed: handle.sandboxed, version: handle.version, error: undefined })
        console.log(`[cowork] servidor listo ${handle.baseUrl} sandbox=${handle.sandboxed} (${folder})`)
        return handle
      },
      (err: unknown) => {
        const e = this.servers.get(folder)
        if (e) e.starting = undefined
        const error = err instanceof Error ? err.message : String(err)
        this.setInfo(folder, { state: 'error', error })
        throw err
      }
    )
  }

  async stop(folder: string): Promise<void> {
    const f = normalizeFolder(folder)
    const e = this.servers.get(f)
    if (!e) return
    e.info = { ...e.info, state: 'stopped' }
    const handle = e.handle ?? (await e.starting?.catch(() => undefined))
    e.handle = undefined
    await handle?.stop()
    this.setInfo(f, { state: 'stopped' })
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((f) => this.stop(f).catch(() => undefined)))
  }

  /** Mata todo de forma síncrona (process.on('exit')). */
  killAllSync(): void {
    for (const e of this.servers.values()) {
      if (e.handle?.pid) {
        try {
          process.kill(e.handle.pid, 'SIGKILL')
        } catch {
          // ya terminó
        }
      }
    }
  }

  /** Archivos modificados en la carpeta desde `since`. */
  deliverables(folder: string, since: number): CoworkDeliverable[] {
    const root = normalizeFolder(folder)
    if (!this.isApproved(root)) throw new Error('La carpeta no está autorizada para Cowork.')
    const out: CoworkDeliverable[] = []
    let seen = 0
    const walk = (dir: string, depth: number): void => {
      if (depth > 6 || seen > MAX_SCAN_FILES) return
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const name of names) {
        if (SKIP_DIRS.has(name)) continue
        const full = join(dir, name)
        let st
        try {
          st = statSync(full)
        } catch {
          continue
        }
        seen++
        if (st.isDirectory()) walk(full, depth + 1)
        else if (st.isFile() && st.mtimeMs >= since) {
          out.push({ path: full, relPath: relative(root, full), size: st.size, mtime: st.mtimeMs })
        }
      }
    }
    walk(root, 0)
    return out.sort((a, b) => b.mtime - a.mtime).slice(0, 200)
  }

  /** Verifica que una ruta esté dentro de alguna carpeta autorizada. */
  assertInsideApproved(path: string): string {
    const p = normalizeFolder(path)
    const ok = this.load().folders.some((f) => p === f.path || p.startsWith(f.path + sep))
    if (!ok) throw new Error('La ruta no pertenece a una carpeta de Cowork autorizada.')
    return p
  }
}
