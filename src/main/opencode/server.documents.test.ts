import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { DOCUMENTS_SERVER } from '@shared/documents-permissions'
import { ENGINE_EXPERIMENTS_DEFAULTS } from '@shared/engine-experiments'

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  spawnEnv: null as Record<string, string> | null,
  configFor: null as
    null | ((binding: { folder: string; code?: { roots: () => readonly string[] } }) => Promise<Record<string, unknown> | null>),
  bindings: [] as Array<{ folder: string; code?: { roots: () => readonly string[] }; session?: (root: string) => Promise<string | null> }>,
  revoked: [] as string[],
  tokens: 0,
  instructions: [] as string[]
}))

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp/lazunox-test' } }))
vi.mock('../runtimes/service', () => ({ runtimesService: () => ({ bins: () => ({ node: null, uv: null, npmCli: null }) }) }))
vi.mock('./shell-bg-bundled', () => ({ bundledShellBgPath: () => null }))
vi.mock('../tasks/mcp-tasks', () => ({ MCP_ENV_WRAPPER: [] }))
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
      Object.assign(child, { pid: 4243, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() })
      return child
    }
  }
})
vi.mock('../store', () => ({ settingsStore: { get: () => state.settings } }))
vi.mock('../extras/mcp-config', () => ({
  appOpencodeConfigEnv: () => ({}),
  readAppMcpConfig: () => ({ path: '/x', servers: {} }),
  readAppPermission: () => ({})
}))
vi.mock('./code-mcp-permission', async (orig) => ({
  ...(await orig<typeof import('./code-mcp-permission')>()),
  readGlobalOpencodeConfig: () => ({ servers: [], permission: {} })
}))
vi.mock('../tasks/opencode-config', () => ({ getOpencodeEnv: () => ({}) }))
vi.mock('./code-docs-instructions', () => ({ codeDocsInstructions: () => state.instructions }))
vi.mock('../embedded-browser/mcp-server', () => ({ embeddedBrowserMcp: { setApi: () => {}, configFor: async () => null } }))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../diagnostics/problem-log', () => ({ recordProblem: () => {} }))
vi.mock('../util/net', () => ({ getFreePort: async () => 4998, waitForHealth: async () => '1.19.0' }))
vi.mock('./pids', () => ({ killTree: () => [], killPids: () => {}, trackPid: () => {}, untrackPid: () => {} }))
vi.mock('./catalog-wait', () => ({ catalogFile: () => '/x', waitForCatalog: async () => 'present' }))
vi.mock('../process/disclaim', () => ({ withDisclaim: (command: string, args: string[]) => ({ command, args, disclaimed: false }) }))
vi.mock('../documents', () => ({
  documentsMcp: {
    configFor: async (binding: { folder: string; code?: { roots: () => readonly string[] } }) => {
      state.bindings.push(binding)
      return state.configFor ? state.configFor(binding) : null
    },
    revokeToken: (token: string) => {
      state.revoked.push(token)
      return true
    }
  }
}))

import { OpencodeServer } from './server'

const fakeBlock = async (): Promise<Record<string, unknown>> => {
  state.tokens++
  return { type: 'remote', url: 'http://127.0.0.1:5555/mcp', headers: { Authorization: `Bearer tok-${state.tokens}` }, enabled: true }
}

const inline = (): Record<string, any> => JSON.parse(state.spawnEnv!.OPENCODE_CONFIG_CONTENT)

describe('sidecar principal: documentos en Code', () => {
  const prevBin = process.env.OPENCODE_BIN
  beforeEach(() => {
    process.env.OPENCODE_BIN = process.execPath
    state.settings = { engineExperiments: ENGINE_EXPERIMENTS_DEFAULTS, language: 'es', recentFolders: ['/tmp/proyecto-a'] }
    state.spawnEnv = null
    state.configFor = fakeBlock
    state.bindings = []
    state.revoked = []
    state.tokens = 0
    state.instructions = []
  })
  afterEach(() => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
  })

  it('la config inline trae mcp.documentos remoto con su token, y el permiso conservador', async () => {
    state.instructions = ['/cfg/code-documentos.md']
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await server.start()
    const cfg = inline()
    expect(cfg.mcp[DOCUMENTS_SERVER]).toMatchObject({ type: 'remote', headers: { Authorization: 'Bearer tok-1' } })
    expect(cfg.instructions).toEqual(['/cfg/code-documentos.md'])
    expect(cfg.permission.documentos_crear).toBe('ask')
    expect(cfg.permission.documentos_renderizar).toBe('allow')
    // No hay regla general `documentos_*` (el servidor es de reglas fijas, no un conector configurable).
    expect(cfg.permission['documentos_*']).toBeUndefined()
    // El agente chat sigue sin poder usarla.
    expect(cfg.agent.chat.permission['*']).toBe('deny')
    expect(cfg.agent.chat.permission.documentos_crear).toBeUndefined()
  })

  it('la atadura es la de Code (no una carpeta) y sus raíces son las carpetas abiertas', async () => {
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await server.start()
    expect(state.bindings).toHaveLength(1)
    expect(state.bindings[0]!.folder).toBe('<code>')
    expect(state.bindings[0]!.code!.roots()).toEqual(['/tmp/proyecto-a'])
    state.settings = { ...state.settings, recentFolders: ['/tmp/proyecto-b'] }
    expect(state.bindings[0]!.code!.roots()).toEqual(['/tmp/proyecto-b'])
  })

  it('el ámbito de correcciones de Code viene de su motor vivo y desaparece al detenerlo', async () => {
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await server.start()
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ses_prueba: { type: 'busy' } })))
    vi.stubGlobal('fetch', fetcher)
    try {
      const session = state.bindings[0]!.session!
      expect(await session('/tmp/proyecto-a')).toBe('ses_prueba')
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringContaining('/session/status?directory=%2Ftmp%2Fproyecto-a'),
        expect.objectContaining({ headers: { authorization: expect.stringMatching(/^Basic /) } })
      )
      await server.stop()
      expect(await session('/tmp/proyecto-a')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
      await server.stop()
    }
  })

  it('si el MCP no arranca el motor arranca igual, sin documentos y sin instrucciones', async () => {
    state.configFor = async () => null
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await server.start()
    expect(inline().mcp ?? {}).not.toHaveProperty('documentos')
    expect(inline()).not.toHaveProperty('instructions')
    state.configFor = async () => {
      throw new Error('boom')
    }
    const again = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await again.start()
    expect(inline().mcp ?? {}).not.toHaveProperty('documentos')
  })

  it('stop() revoca el token; relanzar emite uno nuevo y revoca el viejo', async () => {
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await server.start()
    expect(state.revoked).toEqual([])
    await server.stop()
    expect(state.revoked).toEqual(['tok-1'])
    await server.start()
    expect(inline().mcp[DOCUMENTS_SERVER].headers.Authorization).toBe('Bearer tok-2')
    await server.restart()
    expect(state.revoked).toEqual(['tok-1', 'tok-2'])
    expect(inline().mcp[DOCUMENTS_SERVER].headers.Authorization).toBe('Bearer tok-3')
    // El motor falso no muere al SIGTERM: cada `stop()` espera el período de gracia (3 s) antes de rematarlo.
  }, 20_000)

  it('killSync() también revoca', async () => {
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    await server.start()
    server.killSync()
    expect(state.revoked).toEqual(['tok-1'])
  })

  it('la huella de la config no cambia por documentos (es un servidor de reglas fijas)', async () => {
    const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
    const before = server.wantedInlineKey()
    await server.start()
    expect(server.inlineStale()).toBe(false)
    expect(server.appliedInlineKey()).toBe(before)
  })
})
