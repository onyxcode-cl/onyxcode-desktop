/**
 * Rutinas por archivo en WINDOWS (rutas de Windows inyectadas, sin Windows real): la carpeta vigilada se valida con la política
 * de carpetas de Windows del gestor de Tareas SIN haberla aprobado antes en Tareas, y la validación sigue viva en cada tick
 * (la política de Windows caduca a los 2 min si nadie relee las unidades).
 *
 * Causa raíz que cubre (F8-B178): `folderForbidden` es síncrono y `WinHost.context()` devuelve `undefined` (→ «No se pudo comprobar
 * la política de carpetas de Windows…») si las unidades no se leyeron en los últimos 120 s. Solo `tasks:approveFolder` las releía.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' },
  Notification: class {
    static isSupported = (): boolean => false
  },
  powerMonitor: { on: () => undefined, removeListener: () => undefined }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null, revokeToken: () => undefined }
}))
vi.mock('../tasks/policy', () => ({ loadManagedPolicy: () => null }))
vi.mock('../tasks/mcp-proxy', () => ({
  McpProxy: class {
    port = 1
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  }
}))
vi.mock('../migrations/migrate-folder-scratch', () => ({ migrateFolderScratch: () => undefined }))

import type { RoutineFileSchedule, RoutineInput } from '@shared/ipc-tasks'
import { DEFAULT_SETTINGS } from '@shared/types'
import { TasksManager } from '../tasks/manager'
import { createWinHost, type WinHost } from '../tasks/win-context'
import type { FsLike, WatchHandle } from './file-watch-manager'
import { SchedulerService } from './service'

const HOME = 'C:\\Users\\Ben'
const USER_DATA = 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox'
const ENV = {
  USERPROFILE: HOME,
  SystemRoot: 'C:\\Windows',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\Ben\\AppData\\Local'
}
const key = (p: string): string =>
  p
    .replace(/[\\/]+/g, '\\')
    .toLowerCase()
    .replace(/\\+$/, '')

/** Disco de Windows doble: carpetas, enlaces, equivalencias de `realpath` y un reloj que controla la caducidad de las unidades. */
function fakeDisk() {
  const dirs = new Set<string>()
  const links = new Set<string>()
  const real = new Map<string, string>()
  const clock = { now: 1_000_000 }
  const reads = { drives: 0 }
  const listeners: Array<(n: string | null) => void> = []
  const opened: string[] = []
  const host: WinHost = createWinHost({
    env: ENV,
    userData: USER_DATA,
    execPath: 'C:\\Users\\Ben\\AppData\\Local\\Programs\\Lazunox\\Lazunox.exe',
    now: () => clock.now,
    readDrives: async () => {
      reads.drives++
      return [
        { letter: 'C', kind: 'fixed' },
        { letter: 'D', kind: 'fixed' },
        { letter: 'E', kind: 'removable' },
        { letter: 'Z', kind: 'network' }
      ]
    },
    fs: {
      lstat: (p) => {
        if (!dirs.has(key(p)) && !links.has(key(p))) throw Object.assign(new Error('x'), { code: 'ENOENT' })
        return { isSymbolicLink: () => links.has(key(p)) }
      },
      readdir: () => [],
      realpath: (p) => real.get(key(p)) ?? p,
      isDirectory: (p) => dirs.has(key(p))
    }
  })
  const fs: FsLike = {
    watch(dir, onEvent): WatchHandle {
      opened.push(dir)
      listeners.push(onEvent)
      return { close: () => undefined }
    },
    realpath: (p) => real.get(key(p)) ?? p,
    lstat: () => ({ size: 5, mtimeMs: 10, isFile: true, isSymlink: false }),
    list: () => [],
    canOpen: () => true,
    isDirectory: (p) => dirs.has(key(p))
  }
  return {
    host,
    dirs,
    links,
    real,
    clock,
    reads,
    fs,
    opened,
    emit: (n: string) => listeners.forEach((l) => l(n)),
    add: (p: string) => dirs.add(key(p))
  }
}

let root: string
let disk: ReturnType<typeof fakeDisk>
let mgr: TasksManager

function make(acknowledged = true): SchedulerService {
  return new SchedulerService({
    getMainConnection: () => Promise.reject(new Error('sin servidor')),
    chatDirectory: root,
    tasks: mgr as never,
    getSettings: () => ({ ...DEFAULT_SETTINGS, routinesTermsAcknowledged: acknowledged }),
    watchFs: disk.fs,
    userDataDir: USER_DATA,
    homeDir: HOME,
    platform: 'win32'
  })
}

const sched = (folder: string): RoutineFileSchedule => ({ kind: 'file', folder, patterns: [], on: 'create', settleSec: 2, maxPerHour: 6 })
const input = (folder: string, over: Partial<RoutineInput> = {}): RoutineInput => ({
  name: 'Archivos',
  prompt: 'Resume {{archivo}}',
  mode: 'chat',
  folder: null,
  model: { providerID: 'p', modelID: 'm' },
  schedule: sched(folder),
  enabled: true,
  ...over
})
/** Lo que hace el canal `routines:save`: relee las unidades y valida. Devuelve el mensaje de rechazo o null. */
async function save(svc: SchedulerService, folder: string, over: Partial<RoutineInput> = {}): Promise<string | null> {
  await svc.refreshFolderPolicy()
  try {
    svc.saveRoutine(input(folder, over))
    return null
  } catch (e) {
    return (e as Error).message
  }
}
const tick = (svc: SchedulerService): Promise<void> => (svc as unknown as { tick: () => Promise<void> }).tick()

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-sched-win-'))
  state.userData = join(root, 'userData')
  disk = fakeDisk()
  mgr = new TasksManager({ platform: 'win32', win: disk.host })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('causa raíz: la política de Windows caduca y solo Tareas la releía', () => {
  it('sin releer las unidades la validación falla cerrado (el síntoma) y releyéndolas funciona sin aprobar nada en Tareas', async () => {
    const folder = 'C:\\Users\\Ben\\lazunox-watch-prueba'
    disk.add(folder)
    const svc = make()
    expect(() => svc.saveRoutine(input(folder))).toThrow(/No se pudo comprobar la política de carpetas de Windows/)
    expect(await save(svc, folder)).toBeNull()
    expect(mgr.listFolders()).toHaveLength(0) // y no hizo falta aprobar nada
  })

  it('un tick pasados 2 minutos relee las unidades: el vigilante NO queda «perdido» (Carpeta no disponible)', async () => {
    const folder = 'C:\\Users\\Ben\\watch'
    disk.add(folder)
    const svc = make()
    await svc.refreshFolderPolicy()
    const r = svc.saveRoutine(input(folder))
    svc.start()
    await vi.waitFor(() => expect(svc.watcherCount()).toBe(1))
    disk.clock.now += 5 * 60_000 // caducó la lectura de unidades
    expect(mgr.folderForbidden(folder)).toMatch(/No se pudo comprobar/)
    const before = disk.reads.drives
    await tick(svc)
    expect(disk.reads.drives).toBeGreaterThan(before)
    expect(svc.watcherCount()).toBe(1)
    expect(svc.list().find((x) => x.id === r.id)?.fileWatch?.state).toBe('watching')
    svc.stop()
  })

  it('al arrancar la app, sin ninguna lectura previa de unidades, las rutinas guardadas se vigilan', async () => {
    const folder = 'C:\\Users\\Ben\\watch'
    disk.add(folder)
    const first = make()
    await first.refreshFolderPolicy()
    first.saveRoutine(input(folder))
    first.stop()
    // «Reinicio»: otro gestor y otro planificador, con la lectura de unidades vacía.
    mgr = new TasksManager({ platform: 'win32', win: disk.host })
    const svc2 = make()
    disk.clock.now += 10 * 60_000
    svc2.start()
    await vi.waitFor(() => expect(svc2.watcherCount()).toBe(1))
    svc2.stop()
  })

  it('sin rutinas por archivo no se leen unidades (coste cero)', async () => {
    const svc = make()
    svc.start()
    await tick(svc)
    expect(disk.reads.drives).toBe(0)
    svc.stop()
  })
})

describe('tabla de carpetas vigiladas en Windows (modo Chat, sin aprobar en Tareas)', () => {
  const ok = [
    'C:\\Users\\Ben\\lazunox-watch-prueba',
    'c:\\users\\ben\\Lazunox-Watch', // otras mayúsculas
    'C:/Users/Ben/watch', // barras normales
    'C:\\Users\\Ben\\watch\\', // barra final
    'D:\\Datos\\entrada', // otra unidad fija
    'C:\\Users\\Ben\\OneDrive\\Documentos\\entrada', // Documentos redirigido a OneDrive
    'C:\\Users\\Ben\\Documents\\Facturas',
    'C:\\Users\\Ben\\Desktop'
  ]
  const bad: Array<[string, RegExp]> = [
    ['C:\\', /unidad|raíz|completa|carpeta/i],
    ['c:/', /unidad|raíz|completa|carpeta/i],
    ['D:\\', /unidad|raíz|completa|carpeta/i],
    ['C:\\Users\\Ben', /personal|completa|raíz|carpeta/i],
    ['C:\\Users\\Ben\\', /personal|completa|raíz|carpeta/i],
    ['c:\\USERS\\ben', /personal|completa|raíz|carpeta/i],
    ['C:\\Users', /personal|contiene|completa|raíz|carpeta/i],
    ['C:\\Users\\Otro\\x', /otros usuarios|usuario/i],
    ['C:\\Users\\Public', /otros usuarios|usuario/i],
    ['\\\\servidor\\recurso\\x', /red|dispositivo/i],
    ['//servidor/recurso/x', /red|dispositivo/i],
    ['\\\\?\\C:\\Users\\Ben\\watch', /red|dispositivo|ruta/i],
    ['\\\\.\\PhysicalDrive0', /red|dispositivo|ruta/i],
    ['C:\\Users\\Ben\\watch\\..\\..\\Otro', /\.\.|ruta|carpeta/i],
    ['C:\\Windows\\System32', /sistema|Windows/i],
    ['C:\\Program Files\\App', /sistema|Program Files/i],
    ['C:\\Users\\Ben\\AppData\\Roaming\\Lazunox', /datos|AppData|app/i],
    ['C:\\Users\\Ben\\AppData\\Local\\Temp\\x', /AppData/i],
    ['C:\\Users\\Ben\\.ssh', /credencial|claves|\.ssh|privad/i],
    ['Z:\\compartida', /red/i], // unidad de red
    ['E:\\usb', /unidad|extra/i], // extraíble
    ['F:\\nada', /unidad/i], // inexistente
    ['relativa\\carpeta', /absoluta|ruta|carpeta/i],
    ['C:carpeta', /absoluta|ruta|carpeta/i],
    ['C:\\Users\\Ben\\watch\\CON', /ruta|carpeta/i]
  ]
  beforeEach(() => {
    for (const p of [...ok, ...bad.map(([p]) => p)]) disk.add(p.replace(/\//g, '\\'))
  })

  it.each(ok)('acepta %s', async (folder) => {
    const svc = make()
    expect(await save(svc, folder)).toBeNull()
  })

  it.each(bad)('rechaza %s', async (folder, why) => {
    const svc = make()
    const msg = await save(svc, folder)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(why)
    expect(svc.list()).toHaveLength(0)
  })

  it('rechaza una carpeta que es un enlace/junction, y una cuya ruta real sale de lo permitido', async () => {
    disk.add('C:\\Users\\Ben\\enlace')
    disk.links.add(key('C:\\Users\\Ben\\enlace\\sub'))
    disk.add('C:\\Users\\Ben\\enlace\\sub')
    disk.add('C:\\Users\\Ben\\hacia-home')
    disk.real.set(key('C:\\Users\\Ben\\hacia-home'), HOME) // junction que apunta a la carpeta personal completa
    disk.add('C:\\Users\\Ben\\hacia-windows')
    disk.real.set(key('C:\\Users\\Ben\\hacia-windows'), 'C:\\Windows\\System32')
    const svc = make()
    expect(await save(svc, 'C:\\Users\\Ben\\enlace\\sub')).not.toBeNull()
    expect(await save(svc, 'C:\\Users\\Ben\\hacia-home')).not.toBeNull()
    expect(await save(svc, 'C:\\Users\\Ben\\hacia-windows')).not.toBeNull()
  })

  it('los enlaces DENTRO de la carpeta no la invalidan (el disparador ignora enlaces y no recorre la carpeta)', async () => {
    disk.add('C:\\Users\\Ben\\conenlaces')
    const svc = make()
    expect(await save(svc, 'C:\\Users\\Ben\\conenlaces')).toBeNull()
  })
})

describe('modos Tareas y Code: exigen la carpeta de la rutina', () => {
  beforeEach(() => {
    for (const p of ['C:\\Users\\Ben\\proyecto', 'C:\\Users\\Ben\\proyecto\\entrada', 'C:\\Users\\Ben\\otro', 'C:\\Users\\Ben\\proyectoX'])
      disk.add(p)
  })

  it('Code: la vigilada debe estar dentro de la de la rutina (sin distinguir mayúsculas ni barras)', async () => {
    const svc = make()
    const code = { mode: 'code' as const, folder: 'C:\\Users\\Ben\\proyecto' }
    expect(await save(svc, 'c:/users/ben/PROYECTO/entrada', code)).toBeNull()
    expect(await save(svc, 'C:\\Users\\Ben\\otro', code)).not.toBeNull()
    expect(await save(svc, 'C:\\Users\\Ben\\proyectoX', code)).not.toBeNull() // prefijo de texto no es «dentro»
  })

  it('Tareas: la carpeta de la rutina debe estar autorizada en Tareas; sin eso se rechaza', async () => {
    const svc = make()
    const folder = 'C:\\Users\\Ben\\proyecto'
    expect(await save(svc, folder, { mode: 'tasks', folder })).toMatch(/autoriz/i)
    await mgr.refreshPolicy()
    mgr.approveFolder(folder)
    expect(await save(svc, 'C:\\Users\\Ben\\proyecto\\entrada', { mode: 'tasks', folder })).toBeNull()
    expect(await save(svc, 'C:\\Users\\Ben\\otro', { mode: 'tasks', folder })).not.toBeNull()
  })
})

describe('guardar → vigilar → disparar (Windows, disco falso)', () => {
  it('un archivo nuevo dispara UNA ejecución; cinco juntos, una sola agrupada', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))
    try {
      const folder = 'C:\\Users\\Ben\\lazunox-watch-prueba'
      disk.add(folder)
      const svc = make()
      const exec = vi.fn(() => ({ id: 'x' }))
      ;(svc as unknown as { execute: unknown }).execute = exec
      expect(await save(svc, folder)).toBeNull()
      svc.start()
      await vi.advanceTimersByTimeAsync(100)
      expect(svc.watcherCount()).toBe(1)
      expect(disk.opened).toEqual([folder])
      disk.emit('uno.txt')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(exec).toHaveBeenCalledTimes(1)
      expect(exec).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Archivos' }), 'file', {
        files: ['uno.txt'],
        watchFolder: folder
      })
      for (const n of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) disk.emit(n)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(exec).toHaveBeenCalledTimes(2)
      expect(exec).toHaveBeenLastCalledWith(expect.anything(), 'file', {
        files: ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'],
        watchFolder: folder
      })
      // pasan 5 minutos (caduca la política) y llega un tick: sigue vigilando
      disk.clock.now += 5 * 60_000
      await tick(svc)
      expect(svc.watcherCount()).toBe(1)
      svc.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
