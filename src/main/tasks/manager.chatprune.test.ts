/** Modo unificado: barrido de carpetas de chat vacías y antiguas (`pruneEmptyChatFolders`). */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
const fsHook = vi.hoisted(() => ({ failFor: '' }))

vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    rmdirSync: (p: string, o?: never) => {
      if (fsHook.failFor && String(p).endsWith(fsHook.failFor)) throw new Error('EBUSY')
      return real.rmdirSync(p, o)
    }
  }
})
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null, revokeToken: () => undefined }
}))
vi.mock('./policy', () => ({ loadManagedPolicy: () => null, isComputerUseDisabled: () => false }))

import { UNIFIED_APPS_ENV } from '@shared/unified-bridge'
import { TasksManager } from './manager'

const LATER = 48 * 3600 * 1000
let root: string
let home: string
let prevHome: string | undefined
let prevFlag: string | undefined

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(homedir(), '.lazunox-chatprune-test-')))
  home = join(root, 'home')
  mkdirSync(home, { recursive: true })
  state.userData = join(root, 'userData')
  mkdirSync(state.userData, { recursive: true })
  fsHook.failFor = ''
  prevHome = process.env.HOME
  prevFlag = process.env[UNIFIED_APPS_ENV]
  process.env.HOME = home
  process.env[UNIFIED_APPS_ENV] = '1'
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevFlag === undefined) delete process.env[UNIFIED_APPS_ENV]
  else process.env[UNIFIED_APPS_ENV] = prevFlag
  rmSync(root, { recursive: true, force: true })
})

type Priv = { load(): { chatFolders: string[]; folders: { path: string }[] }; servers: Map<string, unknown> }

describe.skipIf(!macOnly)('pruneEmptyChatFolders', () => {
  it('borra una vacía y antigua, y la quita del registro y de las carpetas aprobadas', async () => {
    const m = new TasksManager()
    const f = await m.createChatFolder()
    expect(m.pruneEmptyChatFolders(Date.now() + LATER)).toEqual([f.path.split('/').pop()])
    expect(existsSync(f.path)).toBe(false)
    expect(m.isApproved(f.path)).toBe(false)
    expect((m as unknown as Priv).load().chatFolders).not.toContain(f.path)
  })

  it('deja una vacía reciente', async () => {
    const m = new TasksManager()
    const f = await m.createChatFolder()
    expect(m.pruneEmptyChatFolders()).toEqual([])
    expect(existsSync(f.path)).toBe(true)
    expect(m.isApproved(f.path)).toBe(true)
  })

  it('deja una con un archivo (nunca borra de forma recursiva)', async () => {
    const m = new TasksManager()
    const f = await m.createChatFolder()
    writeFileSync(join(f.path, 'a.txt'), 'x')
    expect(m.pruneEmptyChatFolders(Date.now() + LATER)).toEqual([])
    expect(existsSync(join(f.path, 'a.txt'))).toBe(true)
    expect(m.isApproved(f.path)).toBe(true)
  })

  it('deja una con entrada en el índice de chats', async () => {
    const m = new TasksManager()
    const f = await m.createChatFolder()
    m.upsertChatIndex({ folder: f.path, sessionId: 'ses_1', title: 't', updatedAt: Date.now() } as never)
    expect(m.pruneEmptyChatFolders(Date.now() + LATER)).toEqual([])
    expect(existsSync(f.path)).toBe(true)
  })

  it('deja una conectada o con servidor', async () => {
    const m = new TasksManager()
    const f = await m.createChatFolder()
    ;(m as unknown as Priv).servers.set('k', { info: { folder: f.path, state: 'running' } })
    expect(m.pruneEmptyChatFolders(Date.now() + LATER)).toEqual([])
    expect(existsSync(f.path)).toBe(true)
  })

  it('un enlace simbólico dentro de Chats y una ruta fuera de Chats nunca se tocan', async () => {
    const m = new TasksManager()
    const real = await m.createChatFolder()
    const chats = join(realpathSync(home), 'Lazunox', 'Chats')
    const outside = join(root, 'fuera')
    mkdirSync(outside)
    const target = join(root, 'destino')
    mkdirSync(target)
    const link = join(chats, '20200101-aaaaaa')
    symlinkSync(target, link)
    const outsideChat = join(outside, '20200101-bbbbbb')
    mkdirSync(outsideChat)
    const d = (m as unknown as Priv).load()
    d.chatFolders.push(link, outsideChat)
    const removed = m.pruneEmptyChatFolders(Date.now() + LATER)
    expect(removed).toEqual([real.path.split('/').pop()])
    expect(existsSync(target)).toBe(true)
    expect(existsSync(outsideChat)).toBe(true)
    expect(existsSync(link)).toBe(true)
  })

  it('sin bandera no hace nada', async () => {
    const m = new TasksManager()
    const f = await m.createChatFolder()
    process.env[UNIFIED_APPS_ENV] = '0'
    expect(m.pruneEmptyChatFolders(Date.now() + LATER)).toEqual([])
    expect(existsSync(f.path)).toBe(true)
  })

  it('un error en una carpeta no impide las siguientes', async () => {
    const m = new TasksManager()
    const a = await m.createChatFolder()
    const b = await m.createChatFolder()
    fsHook.failFor = a.path.split('/').pop() as string
    const removed = m.pruneEmptyChatFolders(Date.now() + LATER)
    expect(removed).toEqual([b.path.split('/').pop()])
    expect(existsSync(a.path)).toBe(true)
    expect(existsSync(b.path)).toBe(false)
  })
})
