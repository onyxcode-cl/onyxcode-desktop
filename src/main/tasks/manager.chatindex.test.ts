/** Modo unificado: índice de chats en main (`chat-index.json`). */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))

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
import { MAX_CHAT_INDEX } from './chat-index'

let root: string
let home: string
let prevHome: string | undefined
let prevFlag: string | undefined

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(homedir(), '.lazunox-chatindex-test-')))
  home = join(root, 'home')
  mkdirSync(home, { recursive: true })
  state.userData = join(root, 'userData')
  mkdirSync(state.userData, { recursive: true })
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

const idxFile = (): string => join(state.userData, 'chat-index.json')
const e = (folder: string, sessionId: string, updatedAt = 1000, title = 't') => ({ folder, sessionId, title, updatedAt })

async function approved(m: TasksManager, name = 'proj'): Promise<string> {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  return (await m.approveFolder(d)).path
}

describe.skipIf(!macOnly)('índice de chats', () => {
  it('upsert/list: una clave por carpeta+sesión, orden por fecha descendente', async () => {
    const m = new TasksManager()
    const a = await approved(m)
    const chat = (await m.createChatFolder()).path
    m.upsertChatIndex(e(a, 's1', 1000, 'viejo'))
    m.upsertChatIndex(e(chat, 's2', 3000, 'nuevo'))
    m.upsertChatIndex(e(a, 's1', 2000, 'viejo editado'))
    expect(m.listChatIndex()).toEqual([e(chat, 's2', 3000, 'nuevo'), e(a, 's1', 2000, 'viejo editado')])
  })

  it('persiste entre instancias', async () => {
    const m = new TasksManager()
    const a = await approved(m)
    m.upsertChatIndex(e(a, 's1'))
    expect(new TasksManager().listChatIndex()).toEqual([e(a, 's1')])
  })

  it('rechaza carpetas no aprobadas y no escribe nada', async () => {
    const m = new TasksManager()
    const stranger = join(root, 'ajena')
    mkdirSync(stranger)
    expect(() => m.upsertChatIndex(e(stranger, 's1'))).toThrow()
    expect(() => m.upsertChatIndex(e('/etc', 's1'))).toThrow()
    expect(existsSync(idxFile())).toBe(false)
    expect(m.listChatIndex()).toEqual([])
  })

  it('título: sin saltos de línea y recortado a 300', async () => {
    const m = new TasksManager()
    const a = await approved(m)
    m.upsertChatIndex(e(a, 's1', 1, 'uno\ndos\r\ntres'))
    m.upsertChatIndex(e(a, 's2', 2, 'x'.repeat(1000)))
    const [long, short] = m.listChatIndex()
    expect(short.title).toBe('uno dos tres')
    expect(long.title).toHaveLength(300)
  })

  it('updatedAt futuro se acota a ahora + 1 día', async () => {
    const m = new TasksManager()
    const a = await approved(m)
    const before = Date.now()
    m.upsertChatIndex(e(a, 's1', Date.now() + 10 * 365 * 86_400_000))
    const t = m.listChatIndex()[0].updatedAt
    expect(t).toBeLessThanOrEqual(Date.now() + 86_400_000)
    expect(t).toBeGreaterThanOrEqual(before + 86_400_000 - 1000)
  })

  it('tope: al pasarse se descartan las más antiguas', async () => {
    const m = new TasksManager()
    const a = await approved(m)
    for (let i = 0; i < MAX_CHAT_INDEX + 5; i++) m.upsertChatIndex(e(a, `s${i}`, 1000 + i))
    const list = m.listChatIndex()
    expect(list).toHaveLength(MAX_CHAT_INDEX)
    expect(list[0].sessionId).toBe(`s${MAX_CHAT_INDEX + 4}`)
    expect(list.some((x) => x.sessionId === 's0')).toBe(false)
  }, 60_000)

  it('archivo roto o con basura: índice vacío / entradas válidas, sin lanzar', async () => {
    writeFileSync(idxFile(), '{no json')
    expect(new TasksManager().listChatIndex()).toEqual([])
    const m = new TasksManager()
    const a = await approved(m)
    writeFileSync(idxFile(), JSON.stringify([null, 5, { folder: a }, e(a, 'ok')]))
    expect(new TasksManager().listChatIndex()).toEqual([e(a, 'ok')])
  })

  it('filtra huérfanas: carpeta olvidada o que ya no existe', async () => {
    const m = new TasksManager()
    const a = await approved(m, 'a')
    const b = await approved(m, 'b')
    m.upsertChatIndex(e(a, 's1'))
    m.upsertChatIndex(e(b, 's2'))
    rmSync(b, { recursive: true })
    expect(m.listChatIndex().map((x) => x.sessionId)).toEqual(['s1'])
    // a la mano en el archivo: ruta no aprobada
    writeFileSync(idxFile(), JSON.stringify([e(join(root, 'ajena'), 'x'), e(a, 's1')]))
    expect(new TasksManager().listChatIndex().map((x) => x.sessionId)).toEqual(['s1'])
  })

  it('remove: una sesión o todas las de la carpeta', async () => {
    const m = new TasksManager()
    const a = await approved(m, 'a')
    const b = await approved(m, 'b')
    m.upsertChatIndex(e(a, 's1'))
    m.upsertChatIndex(e(a, 's2'))
    m.upsertChatIndex(e(b, 's3'))
    m.removeChatIndex(a, 's1')
    expect(
      m
        .listChatIndex()
        .map((x) => x.sessionId)
        .sort()
    ).toEqual(['s2', 's3'])
    m.removeChatIndex(a)
    expect(m.listChatIndex().map((x) => x.sessionId)).toEqual(['s3'])
    expect(JSON.parse(readFileSync(idxFile(), 'utf8'))).toHaveLength(1)
  })

  it('removeFolder limpia las entradas de esa carpeta (también en disco)', async () => {
    const m = new TasksManager()
    const a = await approved(m, 'a')
    const b = await approved(m, 'b')
    m.upsertChatIndex(e(a, 's1'))
    m.upsertChatIndex(e(b, 's2'))
    await m.removeFolder(a)
    expect(JSON.parse(readFileSync(idxFile(), 'utf8')).map((x: { sessionId: string }) => x.sessionId)).toEqual(['s2'])
  })

  it('sin bandera: list devuelve [] y upsert/remove no hacen nada', async () => {
    const m = new TasksManager()
    const a = await approved(m)
    m.upsertChatIndex(e(a, 's1'))
    delete process.env[UNIFIED_APPS_ENV]
    expect(m.listChatIndex()).toEqual([])
    m.upsertChatIndex(e(a, 's2'))
    m.removeChatIndex(a)
    process.env[UNIFIED_APPS_ENV] = '1'
    expect(m.listChatIndex().map((x) => x.sessionId)).toEqual(['s1'])
  })
})
