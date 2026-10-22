import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { ENGINE_EXPERIMENTS_DEFAULTS } from '@shared/engine-experiments'
import type { EngineExperiments } from '@shared/types'

const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, spawnEnv: null as Record<string, string> | null }))

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp/lazunox-test' } }))
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
vi.mock('../extras/mcp-config', () => ({ appOpencodeConfigEnv: () => ({}) }))
vi.mock('../tasks/opencode-config', () => ({ getOpencodeEnv: () => ({}) }))
vi.mock('../embedded-browser/mcp-server', () => ({ embeddedBrowserMcp: { setApi: () => {}, configFor: async () => null } }))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../diagnostics/problem-log', () => ({ recordProblem: () => {} }))
vi.mock('../util/net', () => ({ getFreePort: async () => 4999, waitForHealth: async () => '1.19.0' }))
vi.mock('./pids', () => ({ killTree: () => {}, trackPid: () => {}, untrackPid: () => {} }))
vi.mock('./catalog-wait', () => ({ catalogFile: () => '/x', waitForCatalog: async () => 'present' }))
vi.mock('../process/disclaim', () => ({ withDisclaim: (command: string, args: string[]) => ({ command, args, disclaimed: false }) }))

import { OpencodeServer } from './server'

const exp = (over: Partial<EngineExperiments>): EngineExperiments => ({ ...ENGINE_EXPERIMENTS_DEFAULTS, ...over })

async function envFor(engineExperiments: EngineExperiments): Promise<Record<string, string>> {
  state.settings = { engineExperiments, language: 'es' }
  state.spawnEnv = null
  const server = new OpencodeServer({ chatDirectory: '/tmp/lazunox-test/chat' })
  await server.start()
  return state.spawnEnv as unknown as Record<string, string>
}

describe('sidecar principal: variables de las funciones experimentales', () => {
  const prevBin = process.env.OPENCODE_BIN
  beforeEach(() => {
    process.env.OPENCODE_BIN = '/bin/sh'
  })
  afterEach(() => {
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
  })

  it('con todo apagado no lleva ninguna de las dos variables ni la general', async () => {
    const env = await envFor(ENGINE_EXPERIMENTS_DEFAULTS)
    expect(env.OPENCODE_EXPERIMENTAL_CODE_MODE).toBeUndefined()
    expect(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBeUndefined()
    expect(env.OPENCODE_EXPERIMENTAL).toBeUndefined()
  })

  it('Code encendido: lleva solo la variable de esa función', async () => {
    const env = await envFor(exp({ codeMode: { chat: false, code: true, tasks: false } }))
    expect(env.OPENCODE_EXPERIMENTAL_CODE_MODE).toBe('true')
    expect(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBeUndefined()
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
