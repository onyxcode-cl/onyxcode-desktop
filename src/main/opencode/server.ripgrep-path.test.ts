import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { ENGINE_EXPERIMENTS_DEFAULTS } from '@shared/engine-experiments'

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  spawnEnv: null as Record<string, string> | null,
  appServers: {} as Record<string, unknown>,
  appPermission: {} as Record<string, unknown>,
  global: { servers: [] as string[], permission: {} as Record<string, unknown> },
  // En Windows una ruta sin letra de unidad no es absoluta (y el motor no recibe archivos de ganchos con rutas así).
  userData: process.platform === 'win32' ? 'C:\\tmp\\lazunox-test' : '/tmp/lazunox-test',
  appPath: '/no-existe',
  node: null as string | null,
  script: null as string | null,
  wakes: [] as Array<{ eventsFile: string; started: number; stopped: number }>,
  // Confianza (lazunox.16): lo que se declaró al arrancar y el estado del sidecar en ese momento.
  declared: [] as Array<{ baseUrl: string; always: string[]; statusThen: string | null }>,
  statusProbe: null as null | (() => string)
}))

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => state.userData, getAppPath: () => state.appPath } }))
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
vi.mock('./engine-trust', () => ({
  engineTrust: {
    declareAll: async (conn: { baseUrl: string }, always: string[]) => {
      state.declared.push({ baseUrl: conn.baseUrl, always: [...always], statusThen: state.statusProbe ? state.statusProbe() : null })
      return []
    }
  }
}))
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
vi.mock('../documents', () => ({ documentsMcp: { configFor: async () => null, revokeToken: () => false } }))
vi.mock('../diagnostics/problem-log', () => ({ recordProblem: () => {} }))
vi.mock('../util/net', () => ({ getFreePort: async () => 4999, waitForHealth: async () => '1.19.0' }))
vi.mock('./pids', () => ({ killTree: () => [], killPids: () => {}, trackPid: () => {}, untrackPid: () => {} }))
vi.mock('./catalog-wait', () => ({ catalogFile: () => '/x', waitForCatalog: async () => 'present' }))
vi.mock('../process/disclaim', () => ({ withDisclaim: (command: string, args: string[]) => ({ command, args, disclaimed: false }) }))

import { OpencodeServer } from './server'

const supported = (process.platform === 'darwin' && process.arch === 'arm64') || (process.platform === 'win32' && process.arch === 'x64')
const RG = process.platform === 'win32' ? 'rg.exe' : 'rg'

async function pathFor(appPath: string): Promise<string[]> {
  state.settings = { engineExperiments: ENGINE_EXPERIMENTS_DEFAULTS, language: 'es' }
  state.appPath = appPath
  state.spawnEnv = null
  const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
  await server.start()
  const env = state.spawnEnv as unknown as Record<string, string>
  return (env.PATH ?? env.Path ?? '').split(delimiter)
}

describe('sidecar principal (Chat/Code): el rg incluido va al principio del PATH (1.8.17)', () => {
  const prevBin = process.env.OPENCODE_BIN
  const dirs: string[] = []
  beforeEach(() => {
    process.env.OPENCODE_BIN = process.execPath
  })
  afterEach(() => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it.skipIf(!supported)('con rg incluido: su carpeta es la PRIMERA del PATH y el resto sigue ahí', async () => {
    const app = mkdtempSync(join(tmpdir(), 'lazunox-rgpath-'))
    dirs.push(app)
    const bin = join(app, 'resources', 'ripgrep-bin', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, RG), '#!/bin/sh\n')
    chmodSync(join(bin, RG), 0o755)
    const path = await pathFor(app)
    expect(path[0]).toBe(bin)
    expect(path.filter((d) => d === bin)).toHaveLength(1)
    expect(path.length).toBeGreaterThan(1)
  })

  it('sin rg incluido: el PATH queda como siempre (no se añade ninguna carpeta inexistente)', async () => {
    const app = mkdtempSync(join(tmpdir(), 'lazunox-rgpath-'))
    dirs.push(app)
    const path = await pathFor(app)
    expect(path.some((d) => d.includes('ripgrep-bin'))).toBe(false)
  })
})
