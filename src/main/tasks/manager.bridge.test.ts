/**
 * Puente de apps del modo unificado en el gestor: con LAZUNOX_UNIFIED_APPS=1 el servidor AISLADO ve la ruta `computer` del proxy
 * (un solo puerto, sin ampliar los permitidos); sin la bandera, o en el servidor sin sandbox, no existe.
 */
import { mkdirSync, readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
const started = vi.hoisted(() => [] as Array<{ noSandbox?: boolean; extraOutboundPorts?: number[]; extraEnv?: Record<string, string> }>)

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null, revokeToken: () => undefined }
}))
const pol = vi.hoisted(() => ({ value: null as { disableComputerUse?: boolean } | null }))
vi.mock('./policy', () => ({
  loadManagedPolicy: () => pol.value,
  isComputerUseDisabled: (p: { disableComputerUse?: boolean } | null | undefined) => p?.disableComputerUse === true
}))
vi.mock('./sandbox', () => ({
  sandboxKey: (f: string) => f,
  startTasksServer: async (
    folder: string,
    opts: { noSandbox?: boolean; extraOutboundPorts?: number[]; extraEnv?: Record<string, string> }
  ) => {
    started.push(opts)
    return {
      folder,
      baseUrl: 'http://127.0.0.1:1',
      authorization: 'x',
      sandboxed: false,
      version: '0',
      pid: undefined,
      stop: async () => undefined
    }
  }
}))

import { BRIDGE_ORIGIN_HEADER, BRIDGE_SERVER_HEADER, UNIFIED_APPS_ENV } from '@shared/unified-bridge'
import { getBridgeSecret } from './bridge-secret'
import { TasksManager } from './manager'

const REAL = 'TOKEN-REAL-DEL-MCP-DE-CONTROL'
let root: string
let home: string
let prevHome: string | undefined
let prevFlag: string | undefined

const computer = {
  mcpConfig: async () => ({
    type: 'remote',
    url: 'http://127.0.0.1:45999/mcp',
    headers: { Authorization: `Bearer ${REAL}` },
    oauth: false,
    enabled: true,
    timeout: 600_000
  }),
  info: async () => ({ available: true, accessibility: true, screenRecording: true }) as never,
  planGateUrl: async () => null
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(homedir(), '.lazunox-bridge-test-')))
  home = join(root, 'home')
  mkdirSync(join(home, 'Documents'), { recursive: true })
  state.userData = join(root, 'userData')
  mkdirSync(state.userData, { recursive: true })
  started.length = 0
  pol.value = null
  prevHome = process.env.HOME
  prevFlag = process.env[UNIFIED_APPS_ENV]
  process.env.HOME = home
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevFlag === undefined) delete process.env[UNIFIED_APPS_ENV]
  else process.env[UNIFIED_APPS_ENV] = prevFlag
  rmSync(root, { recursive: true, force: true })
})

async function startIsolated(): Promise<{ cfg: Record<string, unknown>; ports: number[] | undefined; env: Record<string, string> }> {
  const m = new TasksManager({ computer })
  const folder = m.approveFolder(join(home, 'Documents')).path
  await m.start(folder, false)
  const o = started[0]
  const env = o.extraEnv ?? {}
  return { cfg: JSON.parse(env.OPENCODE_CONFIG_CONTENT), ports: o.extraOutboundPorts, env }
}

describe.skipIf(!macOnly)('puente de apps en el servidor aislado', () => {
  it('sin bandera: no hay ruta computer ni variable del puente', async () => {
    delete process.env[UNIFIED_APPS_ENV]
    const { cfg, ports, env } = await startIsolated()
    expect((cfg.mcp as Record<string, unknown> | undefined)?.computer).toBeUndefined()
    expect(ports).toHaveLength(1)
    expect(env.LAZUNOX_UNIFIED_BRIDGE).toBeUndefined()
  })

  it('con bandera: ruta computer en el proxy, mismos puertos permitidos y sin secretos en la configuración', async () => {
    delete process.env[UNIFIED_APPS_ENV]
    const base = await startIsolated()
    started.length = 0
    process.env[UNIFIED_APPS_ENV] = '1'
    const { cfg, ports, env } = await startIsolated()
    const comp = (cfg.mcp as Record<string, Record<string, unknown>>).computer
    expect(comp.type).toBe('remote')
    expect(comp.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(comp.url).toContain(`:${ports![0]}/`)
    expect(ports).toHaveLength(base.ports!.length)
    expect(env.LAZUNOX_UNIFIED_BRIDGE).toBe('1')
    const blob = JSON.stringify(Object.values(env)) + JSON.stringify(cfg)
    expect(blob).not.toContain(REAL)
    expect(blob).not.toContain(getBridgeSecret())
    expect(blob).not.toContain(BRIDGE_ORIGIN_HEADER)
    expect(blob).not.toContain(BRIDGE_SERVER_HEADER)
    expect(blob).not.toContain('45999')
  })

  it('instrucciones del agente: solo con bandera (archivo en la config de la app) y nunca sin ella', async () => {
    delete process.env[UNIFIED_APPS_ENV]
    expect((await startIsolated()).cfg.instructions).toBeUndefined()
    started.length = 0
    process.env[UNIFIED_APPS_ENV] = '1'
    const ins = (await startIsolated()).cfg.instructions as string[]
    expect(ins).toHaveLength(1)
    expect(ins[0]).toMatch(/unified-apps\.md$/)
    expect(readFileSync(ins[0], 'utf8')).toContain('computer_request_access')
    started.length = 0
    pol.value = { disableComputerUse: true }
    expect((await startIsolated()).cfg.instructions).toBeUndefined()
  })

  it('con bandera pero la política `disableComputerUse` activa: no hay ruta del puente', async () => {
    process.env[UNIFIED_APPS_ENV] = '1'
    pol.value = { disableComputerUse: true }
    const { cfg, ports, env } = await startIsolated()
    expect((cfg.mcp as Record<string, unknown> | undefined)?.computer).toBeUndefined()
    expect(ports).toHaveLength(1)
    expect(env.LAZUNOX_UNIFIED_BRIDGE).toBeUndefined()
  })

  it('con bandera pero Control total (sin sandbox): no hay ruta del puente', async () => {
    process.env[UNIFIED_APPS_ENV] = '1'
    const m = new TasksManager({ computer })
    m.grantFullAccessConsent()
    await m.start(m.fullAccessState().workspace, true)
    const env = started[0].extraEnv ?? {}
    expect(env.LAZUNOX_UNIFIED_BRIDGE).toBeUndefined()
    expect(started[0].extraOutboundPorts).toBeUndefined()
  })
})
