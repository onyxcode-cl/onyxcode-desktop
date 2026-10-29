/**
 * Cambio de cuenta: el servidor sandbox lee las credenciales una sola vez al arrancar. La firma incluye los ids de proveedores
 * con credencial (nunca claves) y un servidor ocioso se reinicia al conectar OpenCode Go; uno ocupado no se toca.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '', policy: null as null | { disableFullAccess?: boolean; allowedFolderRoots?: string[] } }))
const started = vi.hoisted(() => [] as Array<{ folder: string; noSandbox: boolean | undefined }>)
const stopped = vi.hoisted(() => ({ n: 0 }))

vi.mock('../project-profile', () => ({ projectProfiles: () => ({ accessOf: () => 'comandos' }) }))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null }
}))
vi.mock('./policy', () => ({ loadManagedPolicy: () => state.policy, isHostCommandsDisabled: () => false }))
vi.mock('./sandbox', () => ({
  sandboxKey: (f: string) => f,
  startTasksServer: async (folder: string, opts: { noSandbox?: boolean }) => {
    started.push({ folder, noSandbox: opts.noSandbox })
    return {
      folder,
      baseUrl: 'http://127.0.0.1:1',
      authorization: 'x',
      sandboxed: false,
      version: '0',
      pid: undefined,
      stop: async () => {
        stopped.n++
      }
    }
  },
  isHostCommandsDisabled: (p: { disableHostCommands?: boolean } | null | undefined) => p?.disableHostCommands === true
}))

import { TasksManager } from './manager'

let root: string
let home: string
let prevHome: string | undefined
const realFetch = globalThis.fetch

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(homedir(), '.lazunox-cred-test-')))
  home = join(root, 'home')
  mkdirSync(join(home, 'Documents'), { recursive: true })
  state.userData = join(root, 'userData')
  mkdirSync(state.userData, { recursive: true })
  state.policy = null
  started.length = 0
  stopped.n = 0
  prevHome = process.env.HOME
  process.env.HOME = home
})
afterEach(() => {
  globalThis.fetch = realFetch
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  rmSync(root, { recursive: true, force: true })
})

const statusReply = (body: unknown): void => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch
}

describe.skipIf(!macOnly)('credenciales del sandbox en la firma', () => {
  it('al conectar OpenCode Go un servidor ocioso se reinicia y ve el proveedor', async () => {
    let ids: string[] = []
    const m = new TasksManager({ credentialIds: () => ids })
    const docs = m.approveFolder(join(home, 'Documents')).path
    await m.start(docs, false)
    expect(m.folderSet(docs).applied).toBe(true)
    ids = ['opencode-go']
    expect(m.folderSet(docs).applied).toBe(false)
    statusReply({})
    await m.start(docs, false)
    expect(started).toHaveLength(2)
    expect(stopped.n).toBe(1)
    expect(m.folderSet(docs).applied).toBe(true)
  })

  it('con una sesión ocupada no se reinicia', async () => {
    let ids: string[] = []
    const m = new TasksManager({ credentialIds: () => ids })
    const docs = m.approveFolder(join(home, 'Documents')).path
    await m.start(docs, false)
    ids = ['opencode-go']
    statusReply({ s1: { type: 'busy' } })
    await m.start(docs, false)
    expect(started).toHaveLength(1)
    expect(m.folderSet(docs).applied).toBe(false)
  })

  it('si no se puede consultar al servidor tampoco se reinicia', async () => {
    let ids: string[] = []
    const m = new TasksManager({ credentialIds: () => ids })
    const docs = m.approveFolder(join(home, 'Documents')).path
    await m.start(docs, false)
    ids = ['opencode-go']
    globalThis.fetch = (async () => {
      throw new Error('boom')
    }) as typeof fetch
    await m.start(docs, false)
    expect(started).toHaveLength(1)
  })
})
