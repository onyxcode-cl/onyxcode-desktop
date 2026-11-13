/** Precarga aislada de Windows con disco/servidor dobles y userData temporal; permisos, carreras y cierre. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '', cfgDir: '', policy: null as null | Record<string, unknown> }))
const started = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const routes = vi.hoisted(() => [] as string[])
const stops = vi.hoisted(() => [] as string[])
const starts = vi.hoisted(() => ({ before: null as null | ((folder: string) => Promise<void>) }))
const nextPaths = vi.hoisted(() => ({ value: null as null | { map: unknown; directory: string } }))

vi.mock('../project-profile', () => ({ projectProfiles: () => ({ accessOf: () => 'comandos' }) }))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null, revokeToken: () => undefined }
}))
vi.mock('./opencode-config', async (orig) => {
  const real = await orig<typeof import('./opencode-config')>()
  return { ...real, getOpencodeConfigDir: () => state.cfgDir || real.getOpencodeConfigDir() }
})
vi.mock('../documents', () => ({ documentsMcp: { configFor: async () => null, revokeToken: () => undefined } }))
vi.mock('../host-exec', () => ({ hostExecMcp: { configFor: async () => null, revokeToken: () => undefined } }))
vi.mock('./policy', () => ({ loadManagedPolicy: () => state.policy, isHostCommandsDisabled: () => false }))
vi.mock('./mcp-proxy', () => ({
  McpProxy: class {
    port = 1
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    addRoute(spec?: { name?: string }): never {
      routes.push(String(spec?.name))
      throw new Error('sin rutas')
    }
    // Canal del guardián de subagentes (F8-B208).
    setLocalHandler(prefix: string): { url: string; token: string } {
      return { url: `http://127.0.0.1:1${prefix}`, token: 'tok' }
    }
  },
  isHostCommandsDisabled: (p: { disableHostCommands?: boolean } | null | undefined) => p?.disableHostCommands === true
}))
vi.mock('./mcp-tasks', () => ({ tasksMcpContribution: () => ({ mcp: {}, permission: {}, hosts: [], blocked: [] }) }))
vi.mock('../migrations/migrate-folder-scratch', () => ({ migrateFolderScratch: () => undefined }))
vi.mock('./sandbox', () => ({
  sandboxKey: (f: string) => f.replace(/[^A-Za-z0-9]/g, '_'),
  startTasksServer: async (folder: string, opts: Record<string, unknown>) => {
    started.push({ folder, ...opts })
    await starts.before?.(folder)
    return {
      folder,
      baseUrl: 'http://127.0.0.1:1',
      authorization: 'x',
      sandboxed: true,
      version: '0',
      pid: undefined,
      stop: async () => {
        stops.push(folder)
      },
      paths: nextPaths.value ?? { map: { kind: 'identity' }, directory: folder }
    }
  }
}))

import { TasksManager } from './manager'
import { createWinHost, type WinHost } from './win-context'

const ENV = {
  USERPROFILE: 'C:\\Users\\Ben',
  SystemRoot: 'C:\\Windows',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\Ben\\AppData\\Local'
}

/** Disco doble: carpetas existentes, enlaces por ruta completa, equivalencias de `realpath` y contador de accesos. */
function fakeHost(drives = true) {
  const dirs = new Set<string>()
  const links = new Set<string>()
  const inside = new Map<string, Array<{ name: string; isSymbolicLink: boolean; isDirectory: boolean }>>()
  const real = new Map<string, string>()
  const touched: string[] = []
  const key = (p: string): string => p.toLowerCase().replace(/\\+$/, '')
  const host: WinHost = createWinHost({
    env: ENV,
    userData: 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox',
    execPath: 'C:\\Users\\Ben\\AppData\\Local\\Programs\\Lazunox\\Lazunox.exe',
    readDrives: async () =>
      drives
        ? [
            { letter: 'C', kind: 'fixed' },
            { letter: 'D', kind: 'fixed' },
            { letter: 'X', kind: 'fixed' }, // `subst X: …` aparece como disco local
            { letter: 'Z', kind: 'network' }
          ]
        : null,
    fs: {
      lstat: (p) => {
        touched.push(p)
        if (!dirs.has(key(p)) && !links.has(key(p))) {
          const e = new Error('x') as NodeJS.ErrnoException
          e.code = 'ENOENT'
          throw e
        }
        return { isSymbolicLink: () => links.has(key(p)) }
      },
      readdir: (p) => inside.get(key(p)) ?? [],
      realpath: (p) => {
        touched.push(p)
        return real.get(key(p)) ?? p
      },
      isDirectory: (p) => {
        touched.push(p)
        return dirs.has(key(p))
      }
    }
  })
  return { host, dirs, links, inside, real, touched, add: (p: string) => dirs.add(key(p)) }
}

let root: string
let f: ReturnType<typeof fakeHost>
const mk = (over: Partial<ConstructorParameters<typeof TasksManager>[0]> = {}): TasksManager =>
  new TasksManager({ platform: 'win32', win: f.host, ...over })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-mgr-win-'))
  state.userData = join(root, 'userData')
  state.policy = null
  state.cfgDir = ''
  started.length = 0
  starts.before = null
  stops.length = 0
  nextPaths.value = null
  f = fakeHost()
  for (const d of [
    'C:\\lzx',
    'C:\\lzx\\tareas',
    'C:\\lzx\\tareas\\a',
    'C:\\lzx\\tareas\\victima',
    'C:\\Windows',
    'D:\\',
    'C:\\Users\\Ben',
    'C:\\Users\\Ben\\Desktop\\p'
  ])
    f.add(d)
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

const A = 'C:\\lzx\\tareas\\a'
const B = 'C:\\lzx\\tareas\\victima'
const winBackend = { build: true, gate: async () => ({ ok: true }), create: () => null }
function seed(last = A, folders = [A, B]): void {
  mkdirSync(state.userData, { recursive: true })
  writeFileSync(
    join(state.userData, 'tasks-folders.json'),
    JSON.stringify({
      folders: folders.map((path) => ({ path, name: path, approvedAt: 1, lastUsedAt: 10 })),
      lastIsolatedFolder: last
    })
  )
}
async function advanceWarmup(): Promise<void> {
  await vi.advanceTimersByTimeAsync(2100)
  vi.useRealTimers()
}

describe('Windows: un solo motor aislado en espera', () => {
  it('restaura la última carpeta, conserva permisos y reutiliza el motor al abrirla', async () => {
    seed()
    const m = mk({ tasksWin: true, winBackend })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    m.startBackgroundWarmup()
    m.startBackgroundWarmup() // idempotente
    expect(started).toHaveLength(0)
    await advanceWarmup()
    await vi.waitFor(() => expect(m.liveServers()).toHaveLength(1))
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ folder: A, noSandbox: false, platform: 'win32', tasksWin: true, winBackend })
    const c = await m.start(A)
    expect(c.folder).toBe(A)
    expect(started).toHaveLength(1)
    expect(m.keepWarm(A, false)).toBe(true)
    expect(m.keepWarm(A, true)).toBe(false)
    await m.start(B)
    expect(m.keepWarm(A, false)).toBe(false)
    expect(m.keepWarm(B, false)).toBe(true)
    expect(JSON.parse(readFileSync(join(state.userData, 'tasks-folders.json'), 'utf8')).lastIsolatedFolder).toBe(B)
    await m.stopAll()
    expect(m.liveServers()).toHaveLength(0)
  })

  it('no precarga una ruta recordada sin autorización ni una junction plantada después', async () => {
    for (const unapproved of [true, false]) {
      seed(A, unapproved ? [B] : [A])
      if (!unapproved) f.inside.set(A.toLowerCase(), [{ name: 'j', isSymbolicLink: true, isDirectory: true }])
      const m = mk({ tasksWin: true, winBackend })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      m.startBackgroundWarmup()
      await advanceWarmup()
      await m.stopAll()
      expect(started).toHaveLength(0)
    }
  })

  it('una apertura de la persona cancela la precarga pendiente de otra carpeta', async () => {
    seed()
    const m = mk({ tasksWin: true, winBackend })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    m.startBackgroundWarmup()
    await m.start(B)
    await advanceWarmup()
    expect(started.map((s) => s.folder)).toEqual([B])
    await m.stopAll()
  })

  it('dos aperturas completadas al revés retienen la última solicitada', async () => {
    seed()
    const m = mk({ tasksWin: true, winBackend })
    let release!: () => void
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    starts.before = async (folder) => {
      if (folder === A) await slow
    }
    const a = m.start(A)
    await vi.waitFor(() => expect(started.some((s) => s.folder === A)).toBe(true))
    await m.start(B)
    release()
    await a
    expect(m.keepWarm(A, false)).toBe(false)
    expect(m.keepWarm(B, false)).toBe(true)
    expect(JSON.parse(readFileSync(join(state.userData, 'tasks-folders.json'), 'utf8')).lastIsolatedFolder).toBe(B)
    await m.stopAll()
  })

  it('cerrar antes del temporizador no deja un arranque tardío', async () => {
    seed()
    const m = mk({ tasksWin: true, winBackend })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    m.startBackgroundWarmup()
    await m.stopAll()
    await advanceWarmup()
    expect(started).toHaveLength(0)
  })

  it('cerrar mientras relee la política cancela antes de crear el servidor', async () => {
    seed()
    let release!: () => void
    const refresh = new Promise<void>((resolve) => {
      release = resolve
    })
    const m = mk({ tasksWin: true, winBackend, win: { ...f.host, refresh: () => refresh } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    m.startBackgroundWarmup()
    await advanceWarmup()
    const stopping = m.stopAll()
    release()
    await stopping
    expect(started).toHaveLength(0)
    expect(m.liveServers()).toHaveLength(0)
  })

  it('cerrar con el motor aún arrancando espera y detiene su handle', async () => {
    seed()
    let release!: () => void
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    starts.before = async () => slow
    const m = mk({ tasksWin: true, winBackend })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    m.startBackgroundWarmup()
    await advanceWarmup()
    await vi.waitFor(() => expect(started).toHaveLength(1))
    let closed = false
    const closing = m.stopAll().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    release()
    await closing
    expect(stops).toEqual([A])
    expect(m.liveServers()).toHaveLength(0)
  })

  it('macOS y Windows sin bandera o proveedor no precargan', async () => {
    seed()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    for (const m of [mk(), mk({ tasksWin: true }), new TasksManager({ platform: 'darwin', tasksWin: true, winBackend })]) {
      m.startBackgroundWarmup()
      expect(m.keepWarm(A, false)).toBe(false)
    }
    await advanceWarmup()
    expect(started).toHaveLength(0)
  })
})
