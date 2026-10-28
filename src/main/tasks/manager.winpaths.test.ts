/**
 * `TasksManager` con la plataforma inyectada en win32 (macOS, sin Windows): política de carpetas con contexto REAL del
 * anfitrión (doble), `/win/c/…` traducido pero nunca autorizado, rutas hostiles rechazadas sin tocar disco, Control total
 * inexistente (A18) y reescaneo de enlaces al arrancar. Los casos con unidades de red y `subst` reales exigen el PC (A19).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '', cfgDir: '', policy: null as null | Record<string, unknown> }))
const started = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const routes = vi.hoisted(() => [] as string[])
const nextPaths = vi.hoisted(() => ({ value: null as null | { map: unknown; directory: string } }))

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
vi.mock('./policy', () => ({ loadManagedPolicy: () => state.policy }))
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
  }
}))
vi.mock('./mcp-tasks', () => ({ tasksMcpContribution: () => ({ mcp: {}, permission: {}, hosts: [], blocked: [] }) }))
vi.mock('../migrations/migrate-folder-scratch', () => ({ migrateFolderScratch: () => undefined }))
vi.mock('./sandbox', () => ({
  sandboxKey: (f: string) => f.replace(/[^A-Za-z0-9]/g, '_'),
  startTasksServer: async (folder: string, opts: Record<string, unknown>) => {
    started.push({ folder, ...opts })
    return {
      folder,
      baseUrl: 'http://127.0.0.1:1',
      authorization: 'x',
      sandboxed: true,
      version: '0',
      pid: undefined,
      stop: async () => undefined,
      paths: nextPaths.value ?? { map: { kind: 'identity' }, directory: folder }
    }
  }
}))

import { t } from '@shared/i18n'
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
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('TasksManager en win32: política de carpetas con contexto real', () => {
  it('sin leer las unidades NO se aprueba nada (cierra)', () => {
    const m = mk()
    expect(() => m.approveFolder('C:\\lzx\\tareas\\a')).toThrow(t('merr.folder.winContext'))
    expect(m.checkFolder('C:\\lzx\\tareas\\a')).toMatchObject({ ok: false, reason: t('merr.folder.winContext') })
  })
  it('con las unidades leídas aprueba una carpeta normal y rechaza raíz, sistema, perfil, red y rutas hostiles', async () => {
    const m = mk()
    await m.refreshPolicy()
    expect(m.checkFolder('C:\\lzx\\tareas\\a').ok).toBe(true)
    expect(m.approveFolder('C:\\lzx\\tareas\\a').path).toBe('C:\\lzx\\tareas\\a')
    for (const bad of [
      'C:\\',
      'D:\\',
      'C:\\Windows',
      'C:\\Users\\Ben',
      'Z:\\x',
      '\\\\192.168.1.101\\x',
      'C:\\PROGRA~1',
      'C:\\lzx\\tareas\\a\\f.txt:ads',
      'C:\\lzx\\..\\Windows'
    ]) {
      expect(m.checkFolder(bad).ok, bad).toBe(false)
      expect(() => m.approveFolder(bad), bad).toThrow()
    }
  })
  it('una ruta de red o de dispositivo se rechaza SIN tocar el disco (ni SMB ni dispositivos)', async () => {
    const m = mk()
    await m.refreshPolicy()
    f.touched.length = 0
    for (const bad of ['\\\\srv\\share\\x', '\\\\?\\UNC\\srv\\x', '\\\\.\\pipe\\x', '//srv/x']) {
      expect(m.checkFolder(bad).ok, bad).toBe(false)
      expect(() => m.approveFolder(bad), bad).toThrow()
    }
    // Lo que importa: NINGUNA ruta de red o de dispositivo (\\srv, \\?\, \\.\, //srv) llega al disco. La política sí revisa sus propias carpetas
    // vetadas (userData, ProgramData…), que en un Windows real aparecen aquí y no son las rutas del ataque.
    expect(
      f.touched.filter((p) => p.startsWith('\\\\') || p.startsWith('//')),
      JSON.stringify(f.touched)
    ).toEqual([])
  })
  it('la ruta de la distro `/win/c/…` se traduce, pero pasa por la misma política', async () => {
    const m = mk()
    await m.refreshPolicy()
    expect(m.checkFolder('/win/c/lzx/tareas/a')).toMatchObject({ ok: true, normalized: 'C:\\lzx\\tareas\\a' })
    expect(m.checkFolder('/win/c/Windows').ok).toBe(false)
    expect(m.checkFolder('/win/c/Users/Ben').ok).toBe(false)
  })
  it('`realpath` expande alias (subst, 8.3): se juzga la ruta REAL', async () => {
    f.real.set('x:\\p', 'C:\\Windows')
    f.add('X:\\p')
    const m = mk()
    await m.refreshPolicy()
    expect(m.checkFolder('X:\\p').ok).toBe(false)
  })
  it('una junction dentro de la carpeta la rechaza', async () => {
    f.inside.set('c:\\lzx\\tareas\\a', [{ name: 'j', isSymbolicLink: true, isDirectory: true }])
    const m = mk()
    await m.refreshPolicy()
    expect(m.checkFolder('C:\\lzx\\tareas\\a').ok).toBe(false)
  })
  it('las raíces de la política gestionada restringen y se normalizan', async () => {
    state.policy = { allowedFolderRoots: ['D:\\Proyectos'] }
    f.add('D:\\Proyectos\\app')
    const m = mk()
    await m.refreshPolicy()
    expect(m.checkFolder('C:\\lzx\\tareas\\a').ok).toBe(false)
    expect(m.checkFolder('D:\\Proyectos\\app').ok).toBe(true)
  })
})

describe('TasksManager en win32: assertInsideApproved (traducir no autoriza)', () => {
  async function approved(): Promise<TasksManager> {
    const m = mk()
    await m.refreshPolicy()
    m.approveFolder('C:\\lzx\\tareas\\a')
    return m
  }
  it('acepta lo de dentro (con barras, mayúsculas y la forma `/win/c/…`) y devuelve la ruta de Windows', async () => {
    const m = await approved()
    expect(m.assertInsideApproved('C:\\lzx\\tareas\\a\\x.txt')).toBe('C:\\lzx\\tareas\\a\\x.txt')
    expect(m.assertInsideApproved('c:/LZX/Tareas/A/x.txt')).toBe('C:\\LZX\\Tareas\\A\\x.txt')
    expect(m.assertInsideApproved('/win/c/lzx/tareas/a/sub/y.txt')).toBe('C:\\lzx\\tareas\\a\\sub\\y.txt')
  })
  it('rechaza la víctima, `..`, ADS, UNC, dispositivos, 8.3, reservados y la forma `/win/…` fuera de lo aprobado', async () => {
    const m = await approved()
    for (const bad of [
      'C:\\lzx\\tareas\\victima\\x.txt',
      '/win/c/lzx/tareas/victima/x.txt',
      'C:\\lzx\\tareas\\a\\..\\victima\\x.txt',
      '/win/c/lzx/tareas/a/../victima/x.txt',
      'C:\\lzx\\tareas\\a\\x.txt:oculto',
      '\\\\srv\\share\\a',
      '\\\\?\\C:\\lzx\\tareas\\a\\x',
      '\\\\.\\pipe\\x',
      '//srv/x',
      'C:\\lzx\\tareas\\a\\CON',
      'C:\\lzx\\tareas\\a\\nul.txt',
      'C:\\lzx\\tareas\\PROGRA~1',
      'C:\\lzx\\tareas\\a\\fin.',
      'relativa\\x',
      '',
      '/etc/passwd',
      '/win/c/Windows/System32'
    ]) {
      expect(() => m.assertInsideApproved(bad), JSON.stringify(bad)).toThrow(t('merr.task.pathNotAuthorized'))
    }
  })
  it('vinculadas y de confianza también se resuelven por la misma puerta', async () => {
    f.add('D:\\Datos\\b')
    const m = await approved()
    await m.linkFolder('C:\\lzx\\tareas\\a', '/win/d/Datos/b', 'ro', { restart: false })
    expect(m.assertInsideApproved('D:\\Datos\\b\\z.txt')).toBe('D:\\Datos\\b\\z.txt')
    expect(() => m.assertInsideApproved('D:\\Datos\\otra\\z.txt')).toThrow()
  })
})

describe('TasksManager en win32: Control total solo con Tareas y Control del PC activos', () => {
  const winBackend = { build: true, gate: async () => ({ ok: true }), create: () => null }
  it('sin `computerWin` (o sin `tasksWin`) sigue sin existir', () => {
    for (const over of [{ tasksWin: true, winBackend }, { computerWin: true }]) {
      const m = mk(over)
      expect(m.fullAccessState().disabled).toBe(true)
      expect(() => m.grantFullAccessConsent()).toThrow(t('merr.task.fullAccessUnavailable'))
      expect(m.fullAccessBlock('C:\\lzx\\tareas\\a')).toBe('notGranted')
    }
  })
  it('con ambas banderas se puede dar el consentimiento y, sin él, no arranca', () => {
    const m = mk({ tasksWin: true, computerWin: true, winBackend })
    expect(m.fullAccessState()).toMatchObject({ consentAt: null, disabled: false })
    expect(m.fullAccessBlock('C:\\lzx\\tareas\\a')).toBe('notGranted')
    expect(m.grantFullAccessConsent()).toBeGreaterThan(0)
    expect(m.fullAccessConsentAt()).not.toBeNull()
    // Con consentimiento, una carpeta inexistente sigue rechazada.
    expect(m.fullAccessBlock('C:\\no\\existe\\jamas')).toBe('notDir')
  })
})

describe('TasksManager en win32: Control total no existe y el arranque falla cerrado (A18)', () => {
  it('start(fullAccess) lanza fullAccessUnavailable sin llegar al servidor; concederlo también', async () => {
    const m = mk()
    await expect(m.start('C:\\lzx\\tareas\\a', true)).rejects.toThrow(t('merr.task.fullAccessUnavailable'))
    expect(() => m.grantFullAccessConsent()).toThrow(t('merr.task.fullAccessUnavailable'))
    expect(() => m.grantFullAccess('C:\\lzx\\tareas\\a')).toThrow(t('merr.task.fullAccessUnavailable'))
    expect(m.fullAccessState()).toMatchObject({ consentAt: null, disabled: true })
    expect(m.fullAccessBlock('C:\\lzx\\tareas\\a')).toBe('notGranted')
    expect(m.canStartFullAccess('C:\\lzx\\tareas\\a')).toBe(false)
    expect(started).toHaveLength(0)
  })
  it('un consentimiento/concesión que quedó en disco (p. ej. copiado de otro equipo) no vale en Windows', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(state.userData, { recursive: true })
    writeFileSync(
      join(state.userData, 'tasks-folders.json'),
      JSON.stringify({
        folders: [{ path: 'C:\\lzx\\tareas\\a', name: 'a', approvedAt: 1 }],
        fullAccess: [{ path: 'C:\\lzx\\tareas\\a', grantedAt: 1 }],
        fullAccessConsentAt: 5
      })
    )
    const m = mk()
    expect(m.fullAccessConsentAt()).toBeNull()
    expect(m.hasFullAccessGrant('C:\\lzx\\tareas\\a')).toBe(false)
    await expect(m.start('C:\\lzx\\tareas\\a', true)).rejects.toThrow()
    expect(started).toHaveLength(0)
  })
  it('start() entrega a startTasksServer la plataforma, la bandera y el proveedor, y NUNCA noSandbox', async () => {
    const winBackend = { build: true, gate: async () => ({ ok: true }), create: () => null }
    const m = mk({ tasksWin: true, winBackend })
    await m.refreshPolicy()
    m.approveFolder('C:\\lzx\\tareas\\a')
    await m.start('C:\\lzx\\tareas\\a')
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ folder: 'C:\\lzx\\tareas\\a', platform: 'win32', tasksWin: true, noSandbox: false })
    expect(started[0]!.winBackend).toBe(winBackend)
    await m.stopAll()
  })
  it('puente de apps del modo unificado: con LAZUNOX_UNIFIED_APPS_WIN=0, win32 NO registra la ruta `computer` ni da instrucciones ni variable', async () => {
    const prev = process.env.LAZUNOX_UNIFIED_APPS
    const prevWin = process.env.LAZUNOX_UNIFIED_APPS_WIN
    process.env.LAZUNOX_UNIFIED_APPS = '1'
    process.env.LAZUNOX_UNIFIED_APPS_WIN = '0'
    try {
      const winBackend = { build: true, gate: async () => ({ ok: true }), create: () => null }
      const computer = {
        mcpConfig: async () => ({ type: 'remote', url: 'http://127.0.0.1:45999/mcp', headers: { Authorization: 'Bearer REAL' } }),
        info: async () => ({ available: true }) as never,
        planGateUrl: async () => null
      }
      const m = mk({ tasksWin: true, winBackend, computer } as never)
      await m.refreshPolicy()
      m.approveFolder('C:\\lzx\\tareas\\a')
      routes.length = 0
      await m.start('C:\\lzx\\tareas\\a')
      expect(routes).not.toContain('computer')
      const env = (started[0]!.extraEnv ?? {}) as Record<string, string>
      expect(env.LAZUNOX_UNIFIED_BRIDGE).toBeUndefined()
      expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!).instructions).toBeUndefined()
      await m.stopAll()
    } finally {
      if (prev === undefined) delete process.env.LAZUNOX_UNIFIED_APPS
      else process.env.LAZUNOX_UNIFIED_APPS = prev
      if (prevWin === undefined) delete process.env.LAZUNOX_UNIFIED_APPS_WIN
      else process.env.LAZUNOX_UNIFIED_APPS_WIN = prevWin
    }
  })
  it('start() autoriza SOLO la carpeta de skills de la app (lectura), con la ruta de la distro, sin tarjeta ni AppData entera', async () => {
    const winBackend = { build: true, gate: async () => ({ ok: true }), create: () => null }
    const m = mk({ tasksWin: true, winBackend })
    await m.refreshPolicy()
    m.approveFolder('C:\\lzx\\tareas\\a')
    state.cfgDir = 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox\\opencode-config'
    await m.start('C:\\lzx\\tareas\\a')
    const env = (started[0]!.extraEnv ?? {}) as Record<string, string>
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT!) as {
      agent: Record<string, { permission?: { external_directory?: Record<string, string> } }>
    }
    const ext = Object.values(cfg.agent).find((a) => a.permission?.external_directory)!.permission!.external_directory!
    const skills = '/win/c/Users/Ben/AppData/Roaming/Lazunox/opencode-config/skills'
    expect(ext).toEqual({ '*': 'ask', [skills]: 'allow', [`${skills}/*`]: 'allow' })
    // Ninguna entrada concede AppData ni el home: solo skills.
    expect(Object.keys(ext).filter((k) => k !== '*' && !k.startsWith(skills))).toEqual([])
    await m.stopAll()
  })
  it('start() entrega a la interfaz `directory` y `pathMap` de la distro y liveServers() el `directory` para el monitor', async () => {
    const mounts = [{ win: 'C:\\lzx\\tareas\\a', linux: '/win/c/lzx/tareas/a' }]
    nextPaths.value = { map: { kind: 'wsl', mounts }, directory: '/win/c/lzx/tareas/a' }
    const m = mk()
    await m.refreshPolicy()
    m.approveFolder('C:\\lzx\\tareas\\a')
    const conn = await m.start('C:\\lzx\\tareas\\a')
    expect(conn).toMatchObject({ folder: 'C:\\lzx\\tareas\\a', directory: '/win/c/lzx/tareas/a', pathMap: { kind: 'wsl', mounts } })
    expect(m.liveServers()[0]).toMatchObject({ folder: 'C:\\lzx\\tareas\\a', directory: '/win/c/lzx/tareas/a' })
    await m.stopAll()
  })
  it('start() sin bandera ni proveedor los pasa tal cual (sandbox.ts es quien lanza)', async () => {
    const m = mk()
    await m.refreshPolicy()
    m.approveFolder('C:\\lzx\\tareas\\a')
    await m.start('C:\\lzx\\tareas\\a')
    expect(started[0]).toMatchObject({ platform: 'win32', noSandbox: false })
    expect(started[0]!.tasksWin).toBeUndefined()
    expect(started[0]!.winBackend).toBeUndefined()
    // Servidor con sandbox: recibe el canal de solo lectura del guardián (F8-B208) en el puerto del proxy MCP.
    const env = (started[0]!.extraEnv ?? {}) as Record<string, string>
    expect(env.LAZUNOX_GUARD_URL).toBe('http://127.0.0.1:1/__lazunox-guard')
    expect(env.LAZUNOX_GUARD_TOKEN).toBe('tok')
    expect(started[0]!.extraOutboundPorts).toEqual([1])
    await m.stopAll()
  })
  it('reescaneo al arrancar: una junction creada DESPUÉS de aprobar impide el arranque', async () => {
    const m = mk()
    await m.refreshPolicy()
    m.approveFolder('C:\\lzx\\tareas\\a')
    f.inside.set('c:\\lzx\\tareas\\a', [{ name: 'j', isSymbolicLink: true, isDirectory: true }])
    await expect(m.start('C:\\lzx\\tareas\\a')).rejects.toThrow()
    expect(started).toHaveLength(0)
  })
  it('si las unidades dejan de poder leerse, no arranca (la política releída cierra)', async () => {
    const bad = fakeHost(false)
    for (const d of ['C:\\lzx\\tareas\\a']) bad.add(d)
    // Aprobada antes por otro camino (archivo persistido): el arranque la reevalúa y cierra.
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(state.userData, { recursive: true })
    writeFileSync(
      join(state.userData, 'tasks-folders.json'),
      JSON.stringify({ folders: [{ path: 'C:\\lzx\\tareas\\a', name: 'a', approvedAt: 1 }] })
    )
    const m2 = new TasksManager({ platform: 'win32', win: bad.host })
    await expect(m2.start('C:\\lzx\\tareas\\a')).rejects.toThrow(t('merr.folder.winContext'))
    expect(started).toHaveLength(0)
  })
})
