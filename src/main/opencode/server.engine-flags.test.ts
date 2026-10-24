import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENGINE_EXPERIMENTS_DEFAULTS } from '@shared/engine-experiments'
import type { EngineLimits } from '@shared/engine-limits'
import type { EngineExperiments } from '@shared/types'

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  spawnEnv: null as Record<string, string> | null,
  appServers: {} as Record<string, unknown>,
  appPermission: {} as Record<string, unknown>,
  global: { servers: [] as string[], permission: {} as Record<string, unknown> },
  userData: '/tmp/lazunox-test',
  node: null as string | null,
  script: null as string | null,
  wakes: [] as Array<{ eventsFile: string; started: number; stopped: number }>
}))

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => state.userData } }))
vi.mock('../runtimes/service', () => ({ runtimesService: () => ({ bins: () => ({ node: state.node, uv: null, npmCli: null }) }) }))
vi.mock('./shell-bg-bundled', () => ({ bundledShellBgPath: () => state.script }))
vi.mock('../tasks/mcp-tasks', () => ({ MCP_ENV_WRAPPER: ['/usr/bin/env', '-u', 'OPENCODE_SERVER_PASSWORD'] }))
vi.mock('./shell-bg-wake', () => ({
  createSdkWakeEngine: () => ({}),
  ShellBgWake: class {
    rec: { eventsFile: string; started: number; stopped: number }
    constructor(o: { eventsFile: string }) {
      this.rec = { eventsFile: o.eventsFile, started: 0, stopped: 0 }
      state.wakes.push(this.rec)
    }
    start(): void {
      this.rec.started++
    }
    stop(): void {
      this.rec.stopped++
    }
  }
}))
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>()
  return {
    ...real,
    spawn: (_cmd: string, _args: string[], opts: { env: Record<string, string> }) => {
      state.spawnEnv = opts.env
      const child = new EventEmitter() as EventEmitter & {
        pid: number
        exitCode: null
        signalCode: null
        stdout: EventEmitter
        stderr: EventEmitter
      }
      Object.assign(child, { pid: 4242, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() })
      return child
    }
  }
})
vi.mock('../store', () => ({ settingsStore: { get: () => state.settings } }))
vi.mock('../extras/mcp-config', () => ({
  appOpencodeConfigEnv: () => ({}),
  readAppMcpConfig: () => ({ path: '/x', servers: state.appServers }),
  readAppPermission: () => state.appPermission
}))
// La config global REAL del usuario no entra en las pruebas.
vi.mock('./code-mcp-permission', async (orig) => ({
  ...(await orig<typeof import('./code-mcp-permission')>()),
  readGlobalOpencodeConfig: () => state.global
}))
vi.mock('../tasks/opencode-config', () => ({ getOpencodeEnv: () => ({}) }))
vi.mock('../embedded-browser/mcp-server', () => ({ embeddedBrowserMcp: { setApi: () => {}, configFor: async () => null } }))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../diagnostics/problem-log', () => ({ recordProblem: () => {} }))
vi.mock('../util/net', () => ({ getFreePort: async () => 4999, waitForHealth: async () => '1.19.0' }))
vi.mock('./pids', () => ({ killTree: () => [], killPids: () => {}, trackPid: () => {}, untrackPid: () => {} }))
vi.mock('./catalog-wait', () => ({ catalogFile: () => '/x', waitForCatalog: async () => 'present' }))
vi.mock('../process/disclaim', () => ({ withDisclaim: (command: string, args: string[]) => ({ command, args, disclaimed: false }) }))

import { OpencodeServer } from './server'

const exp = (over: Partial<EngineExperiments>): EngineExperiments => ({ ...ENGINE_EXPERIMENTS_DEFAULTS, ...over })

async function envFor(engineExperiments: EngineExperiments, engineLimits?: EngineLimits): Promise<Record<string, string>> {
  state.settings = { engineExperiments, engineLimits, language: 'es' }
  state.spawnEnv = null
  const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
  await server.start()
  return state.spawnEnv as unknown as Record<string, string>
}

describe('sidecar principal: variables de las funciones experimentales', () => {
  const prevBin = process.env.OPENCODE_BIN
  beforeEach(() => {
    // Cualquier ejecutable que exista en todas las plataformas hace de motor falso (`spawn` está simulado); `/bin/sh` no existe en Windows.
    process.env.OPENCODE_BIN = process.execPath
  })
  afterEach(() => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
  })

  it('por defecto solo lleva la de subagentes en segundo plano (nunca la general)', async () => {
    const env = await envFor(ENGINE_EXPERIMENTS_DEFAULTS)
    expect(env.OPENCODE_EXPERIMENTAL_CODE_MODE).toBeUndefined()
    expect(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBe('true')
    expect(env.OPENCODE_EXPERIMENTAL).toBeUndefined()
  })

  it('Code encendido: lleva solo la variable de esa función', async () => {
    const env = await envFor(exp({ codeMode: { chat: false, code: true, tasks: false } }))
    expect(env.OPENCODE_EXPERIMENTAL_CODE_MODE).toBe('true')
    expect(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBe('true')
    expect(env.OPENCODE_EXPERIMENTAL).toBeUndefined()
  })

  it('Chat encendido también la lleva (comparte sidecar con Code)', async () => {
    const env = await envFor(exp({ backgroundSubagents: { chat: true, code: false, tasks: false } }))
    expect(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBe('true')
  })

  it('solo Tareas encendido: el sidecar principal NO las lleva', async () => {
    const env = await envFor(
      exp({ codeMode: { chat: false, code: false, tasks: true }, backgroundSubagents: { chat: false, code: false, tasks: true } })
    )
    expect(env.OPENCODE_EXPERIMENTAL_CODE_MODE).toBeUndefined()
    expect(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBeUndefined()
  })
})

describe('sidecar principal: límites de Modo código y shell', () => {
  const prevBin = process.env.OPENCODE_BIN
  beforeEach(() => {
    process.env.OPENCODE_BIN = process.execPath
  })
  afterEach(() => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
  })

  it('sin cambios no lleva ninguna variable de límites (el motor usa sus defectos)', async () => {
    for (const lim of [undefined, {}, { codeTimeoutMin: 10 }]) {
      const env = await envFor(ENGINE_EXPERIMENTS_DEFAULTS, lim)
      expect(Object.keys(env).filter((k) => k.startsWith('LAZUNOX_CODE_MODE_') || k.startsWith('LAZUNOX_SHELL_BG_'))).toEqual([])
    }
  })

  it('lleva solo las que la persona cambió, en unidades del motor', async () => {
    const env = await envFor(ENGINE_EXPERIMENTS_DEFAULTS, { codeTimeoutMin: 45, shellOutputMb: 20 })
    expect(env.LAZUNOX_CODE_MODE_TIMEOUT_MS).toBe('2700000')
    expect(env.LAZUNOX_SHELL_BG_MAX_OUTPUT).toBe('20971520')
    expect(env.LAZUNOX_CODE_MODE_MAX_CELLS).toBeUndefined()
    expect(env.LAZUNOX_SHELL_BG_MAX_MS).toBeUndefined()
  })
})

describe('sidecar principal: permisos de los conectores en Code (F8-B203)', () => {
  const prevBin = process.env.OPENCODE_BIN
  beforeEach(() => {
    // Cualquier ejecutable que exista en todas las plataformas hace de motor falso (`spawn` está simulado); `/bin/sh` no existe en Windows.
    process.env.OPENCODE_BIN = process.execPath
  })
  afterEach(() => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    state.appServers = {}
    state.appPermission = {}
    state.global = { servers: [], permission: {} }
  })

  async function inline(settings: Record<string, unknown>): Promise<{ cfg: Record<string, unknown>; server: OpencodeServer }> {
    state.settings = { engineExperiments: ENGINE_EXPERIMENTS_DEFAULTS, language: 'es', ...settings }
    state.spawnEnv = null
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await server.start()
    return { cfg: JSON.parse(state.spawnEnv!.OPENCODE_CONFIG_CONTENT) as Record<string, unknown>, server }
  }

  it('conector de la app y externo (config global) sin confianza → ask; de confianza → allow; navegador → allow', async () => {
    state.appServers = { gmail: {}, crm: {} }
    state.global = { servers: ['ext'], permission: {} }
    const { cfg, server } = await inline({ codeTrustedMcp: ['gmail'] })
    expect(cfg.permission).toMatchObject({ 'crm_*': 'ask', 'ext_*': 'ask', 'gmail_*': 'allow', 'browser_*': 'allow' })
    expect(server.appliedInlineKey()).toBe(server.wantedInlineKey())
    expect(server.inlineStale()).toBe(false)
  })

  it('herramienta bloqueada del archivo de la app: alias exacto al final', async () => {
    state.appServers = { gmail: {} }
    state.appPermission = { gmail_send: 'deny' }
    const { cfg } = await inline({ codeTrustedMcp: ['gmail'] })
    const keys = Object.keys(cfg.permission as object)
    expect((cfg.permission as Record<string, string>)['gmail_send *']).toBe('deny')
    expect(keys.indexOf('gmail_send *')).toBeGreaterThan(keys.indexOf('gmail_*'))
  })

  it('cambiar la confianza o añadir un conector deja la config vieja (para relanzar)', async () => {
    state.appServers = { gmail: {} }
    const { server } = await inline({ codeTrustedMcp: [] })
    expect(server.inlineStale()).toBe(false)
    state.settings = { ...state.settings, codeTrustedMcp: ['gmail'] }
    expect(server.inlineStale()).toBe(true)
    state.settings = { ...state.settings, codeTrustedMcp: [] }
    state.appServers = { gmail: {}, nuevo: {} }
    expect(server.inlineStale()).toBe(true)
  })
})

describe('sidecar principal: subagentes del Chat (F8-B206)', () => {
  const prevBin = process.env.OPENCODE_BIN
  beforeEach(() => {
    // Cualquier ejecutable que exista en todas las plataformas hace de motor falso (`spawn` está simulado); `/bin/sh` no existe en Windows.
    process.env.OPENCODE_BIN = process.execPath
  })
  afterEach(() => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
  })

  const chatTask = async (engineExperiments: EngineExperiments): Promise<{ task: unknown; server: OpencodeServer }> => {
    state.settings = { engineExperiments, language: 'es' }
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await server.start()
    const cfg = JSON.parse(state.spawnEnv!.OPENCODE_CONFIG_CONTENT) as { agent: { chat: { permission: { task?: unknown } } } }
    return { task: cfg.agent.chat.permission.task, server }
  }

  it('solo con la función encendida para el Chat se abre `task` (únicamente a lazunox-chat-helper)', async () => {
    expect((await chatTask(exp({ backgroundSubagents: { chat: false, code: true, tasks: false } }))).task).toBeUndefined()
    const { task, server } = await chatTask(exp({ backgroundSubagents: { chat: true, code: false, tasks: false } }))
    expect(task).toEqual({ '*': 'deny', 'lazunox-chat-helper': 'allow' })
    expect(state.spawnEnv!.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBe('true')
    // Apagarla en el Chat deja la config inline vieja aunque Code mantenga la variable (hay que relanzar).
    state.settings = { ...state.settings, engineExperiments: exp({ backgroundSubagents: { chat: false, code: true, tasks: false } }) }
    expect(server.inlineStale()).toBe(true)
  })
})

describe('sidecar principal: bgshell (F8-B204)', () => {
  const prevBin = process.env.OPENCODE_BIN
  let dir = ''
  beforeEach(() => {
    // Cualquier ejecutable que exista en todas las plataformas hace de motor falso (`spawn` está simulado); `/bin/sh` no existe en Windows.
    process.env.OPENCODE_BIN = process.execPath
    dir = mkdtempSync(join(tmpdir(), 'lazunox-bg-srv-'))
    state.userData = dir
    state.wakes = []
  })
  afterEach(() => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    state.userData = '/tmp/lazunox-test'
    state.node = null
    state.script = null
    rmSync(dir, { recursive: true, force: true })
  })

  async function boot(): Promise<{ cfg: Record<string, unknown>; server: OpencodeServer }> {
    state.settings = { engineExperiments: ENGINE_EXPERIMENTS_DEFAULTS, language: 'es', codeTrustedMcp: ['bgshell'] }
    const server = new OpencodeServer({ chatDirectory: join(dir, 'chat') })
    await server.start()
    return { cfg: JSON.parse(state.spawnEnv!.OPENCODE_CONFIG_CONTENT) as Record<string, unknown>, server }
  }

  it('con Node incluido y el .cjs: bloque mcp.bgshell con el envoltorio de entorno, permisos fijos y despertador vivo con la conexión', async () => {
    state.node = '/abs/node'
    state.script = '/abs/shell-bg-mcp.cjs'
    // Un aviso viejo de otro proceso se vacía antes de arrancar.
    const root = join(dir, 'shell-bg', 'code')
    const { server, cfg } = await boot()
    const mcp = cfg.mcp as Record<string, { command: string[]; environment: Record<string, string> }>
    const bg = mcp.bgshell
    // El envoltorio `env -u` solo existe en macOS/Linux; en Windows (server.ts) el comando va sin prefijo.
    expect(bg.command).toEqual(
      process.platform === 'win32'
        ? ['/abs/node', '/abs/shell-bg-mcp.cjs']
        : ['/usr/bin/env', '-u', 'OPENCODE_SERVER_PASSWORD', '/abs/node', '/abs/shell-bg-mcp.cjs']
    )
    expect(bg.environment.LAZUNOX_SHELL_BG_DIR).toBe(join(root, 'work'))
    expect(bg.environment.LAZUNOX_SHELL_BG_EVENTS).toBe(join(root, 'events.jsonl'))
    if (process.platform !== 'win32') expect(statSync(root).mode & 0o777).toBe(0o700)
    const perm = cfg.permission as Record<string, string>
    // Aunque alguien marcara «bgshell» como de confianza a mano, `start` pregunta (no hay `bgshell_*: allow`).
    expect(perm['bgshell_*']).toBeUndefined()
    expect(perm.bgshell_start).toBe('ask')
    expect(perm.bgshell_status).toBe('allow')
    expect(state.wakes).toHaveLength(1)
    expect(state.wakes[0]).toMatchObject({ eventsFile: join(root, 'events.jsonl'), started: 1, stopped: 0 })
    writeFileSync(join(root, 'events.jsonl'), '{"type":"exit"}\n')
    await server.restart()
    expect(readFileSync(join(root, 'events.jsonl'), 'utf8')).toBe('')
    expect(state.wakes[0]!.stopped).toBeGreaterThan(0)
    expect(state.wakes).toHaveLength(2)
    await server.stop()
    expect(state.wakes[1]!.stopped).toBeGreaterThan(0)
  }, 15_000) // el proceso falso no sale solo: cada `stop` espera la gracia de 3 s

  it('sin Node incluido: no hay bloque bgshell ni despertador ni carpetas, el motor arranca igual', async () => {
    state.script = '/abs/shell-bg-mcp.cjs'
    const { cfg } = await boot()
    expect((cfg.mcp as Record<string, unknown> | undefined)?.bgshell).toBeUndefined()
    expect(state.wakes).toHaveLength(0)
    expect(() => statSync(join(dir, 'shell-bg'))).toThrow()
    expect((cfg.permission as Record<string, string>).bgshell_start).toBe('ask')
  })
})
