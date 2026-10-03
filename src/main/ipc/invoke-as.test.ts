import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const sent: Array<{ wc: number; ch: string; args: unknown[] }> = []
  const wins: Array<{ webContents: Record<string, unknown>; isDestroyed(): boolean }> = []
  const made = (id: number): { webContents: Record<string, unknown>; isDestroyed(): boolean } => {
    const w = {
      isDestroyed: () => false,
      webContents: {
        id,
        isDestroyed: () => false,
        send: (ch: string, ...args: unknown[]) => sent.push({ wc: id, ch, args }),
        once: () => undefined,
        on: () => undefined
      }
    }
    return w
  }
  return { handlers, sent, wins, made }
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), getPath: () => '/tmp', isPackaged: false },
  shell: { trashItem: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => h.wins,
    fromWebContents: () => {
      throw new Error('fromWebContents no debe llamarse con un remitente virtual')
    }
  },
  webContents: { fromId: (id: number) => h.wins.find((w) => w.webContents.id === id)?.webContents }
}))
vi.mock('../security/app-protocol', () => ({ isTrustedUrl: () => true }))
vi.mock('../store', () => ({ settingsStore: { addRecentFolder: vi.fn() } }))
vi.mock('../extras/prefs', () => ({ extrasPrefs: { get: () => ({}) } }))
vi.mock('../git/service', () => ({ GitError: class extends Error {} }))
vi.mock('../dialog/service', () => ({ openFolder: vi.fn(), revealInFinder: vi.fn(), openInEditor: vi.fn() }))
vi.mock('../editors/service', () => ({ EditorError: class extends Error {}, listInstalled: vi.fn(), openWithEditor: vi.fn() }))
vi.mock('../editors/catalog', () => ({ resolveE2eEditors: () => null }))
vi.mock('../tasks/trash', () => ({ resolveE2eTrashDir: () => null, trashToDir: vi.fn() }))
vi.mock('../pty/service', () => {
  class PtyService {
    private owners = new Map<string, number>()
    private n = 0
    constructor(private ev: { onData(id: string, d: string): void }) {}
    availability() {
      return { available: true }
    }
    create(_r: unknown, owner: number) {
      const id = `pty-${++this.n}`
      this.owners.set(id, owner)
      queueMicrotask(() => this.ev.onData(id, 'hola'))
      return { id }
    }
    isOwner(id: string, owner: number) {
      return this.owners.get(id) === owner
    }
    list(owner: number) {
      return [...this.owners].filter(([, o]) => o === owner).map(([id]) => ({ id }))
    }
    kill(id: string) {
      this.owners.delete(id)
    }
    killOwner(owner: number) {
      for (const [id, o] of this.owners) if (o === owner) this.owners.delete(id)
    }
    killAll() {}
    write() {}
    resize() {}
  }
  return { PtyService }
})

import { registerWindowRole } from './guard'
import { IPC_SCHEMAS } from './schemas'
import { registerCodeHandlers } from './code-handlers'
import { invokeAs, type RemoteCaller } from './handle'
import { createRemoteSender } from '../remote/sender'

const ipcMain = {
  removeHandler: (ch: string) => h.handlers.delete(ch),
  handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => h.handlers.set(ch, fn)
}
const winEvent = (id: number) => {
  const wc = h.made(id).webContents
  registerWindowRole(wc as never, 'main')
  return { sender: wc, senderFrame: { parent: null, url: 'onyxcode://app/' } }
}
const callerFor = (allow: (ch: string) => boolean = () => true): RemoteCaller & { sent: Array<{ ch: string; args: unknown[] }> } => {
  const sent: Array<{ ch: string; args: unknown[] }> = []
  const sender = createRemoteSender((ch, ...args) => sent.push({ ch, args }))
  return { sender, authorize: (ch) => allow(ch), sent }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  h.handlers.clear()
  h.sent.length = 0
  h.wins.length = 0
})

describe('invokeAs: mismo guardado que el IPC real', () => {
  it('rechaza un payload inválido igual que la ventana (mismo esquema)', async () => {
    registerCodeHandlers(ipcMain as never, () => null)
    const caller = callerFor()
    const bad = { cwd: 'relativa/no/absoluta', parent: '', name: 'a', kind: 'file' }
    const remote = await invokeAs(caller, 'files:create', [bad])
    const real = await (h.handlers.get('files:create') as (e: unknown, ...a: unknown[]) => Promise<unknown>)(winEvent(1), bad)
    expect(remote).toMatchObject({ ok: false, code: 'INVALID' })
    expect(remote).toEqual(real)
  })

  it('rechaza varios argumentos y canales sin esquema ni handler', async () => {
    registerCodeHandlers(ipcMain as never, () => null)
    const caller = callerFor()
    expect(await invokeAs(caller, 'pty:available', [1, 2])).toMatchObject({ ok: false, code: 'INVALID' })
    expect(await invokeAs(caller, 'canal:inexistente', [])).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it('el gancho de política decide antes de despachar (denegar por defecto)', async () => {
    registerCodeHandlers(ipcMain as never, () => null)
    const denied = callerFor(() => false)
    expect(await invokeAs(denied, 'pty:available', [])).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    const noPolicy = { sender: denied.sender } as unknown as RemoteCaller
    expect(await invokeAs(noPolicy, 'pty:available', [])).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await invokeAs(callerFor(), 'pty:available', [])).toMatchObject({ ok: true })
  })

  it('las ventanas no cambian: sin frame válido sigue rechazando, y todo canal con handler tiene esquema', async () => {
    registerCodeHandlers(ipcMain as never, () => null)
    const fn = h.handlers.get('pty:available') as (e: unknown, ...a: unknown[]) => Promise<unknown>
    expect(await fn({ sender: { id: 5 }, senderFrame: null })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    for (const ch of h.handlers.keys()) expect(IPC_SCHEMAS[ch], ch).toBeTypeOf('function')
  })
})

describe('remitente virtual: pty y archivos con propiedad aislada', () => {
  it('pty: un celular no ve ni controla las terminales de otro remitente ni de una ventana', async () => {
    registerCodeHandlers(ipcMain as never, () => null)
    const a = callerFor()
    const b = callerFor()
    h.wins.push(h.made(7) as never)
    const created = (await invokeAs(a, 'pty:create', [{ cwd: '/tmp', cols: 80, rows: 24 }])) as { ok: true; data: { id: string } }
    expect(created.ok).toBe(true)
    const id = created.data.id
    // La ventana real crea la suya
    const winCreate = await (h.handlers.get('pty:create') as (e: unknown, ...x: unknown[]) => Promise<{ data: { id: string } }>)(
      winEvent(7),
      { cwd: '/tmp', cols: 80, rows: 24 }
    )
    const winId = winCreate.data.id
    expect(((await invokeAs(a, 'pty:list', [])) as { data: Array<{ id: string }> }).data.map((p) => p.id)).toEqual([id])
    expect(((await invokeAs(b, 'pty:list', [])) as { data: unknown[] }).data).toEqual([])
    // B no puede escribir en la de A ni en la de la ventana
    expect(await invokeAs(b, 'pty:write', [{ id, data: 'x' }])).toMatchObject({ ok: false })
    expect(await invokeAs(a, 'pty:write', [{ id: winId, data: 'x' }])).toMatchObject({ ok: false })
    expect(await invokeAs(a, 'pty:write', [{ id, data: 'x' }])).toMatchObject({ ok: true })
    // La salida llega solo por el canal del dueño
    await Promise.resolve()
    expect(a.sent.map((s) => s.ch)).toContain('pty:data')
    expect(b.sent).toEqual([])
    const toWindow = h.sent.filter((s) => s.wc === 7 && s.ch === 'pty:data').map((s) => (s.args[0] as { id: string }).id)
    expect(toWindow).toEqual([winId])
    expect(a.sent.map((s) => (s.args[0] as { id: string }).id)).toEqual([id])
  })

  it('pty: al destruirse el remitente se liberan sus terminales', async () => {
    registerCodeHandlers(ipcMain as never, () => null)
    const a = callerFor()
    await invokeAs(a, 'pty:create', [{ cwd: '/tmp', cols: 80, rows: 24 }])
    expect(((await invokeAs(a, 'pty:list', [])) as { data: unknown[] }).data).toHaveLength(1)
    a.sender.destroy()
    const again = callerFor()
    expect(((await invokeAs(again, 'pty:list', [])) as { data: unknown[] }).data).toEqual([])
  })

  it('files: suscripción por id de remitente; el gestor solo actúa sobre la carpeta activa del propio remitente', async () => {
    registerCodeHandlers(ipcMain as never, () => null)
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'invoke-as-')))
    try {
      const a = callerFor()
      const b = callerFor()
      const w = await invokeAs(a, 'files:watch', [{ folder: dir, subId: 'sub-aaaaaaaa' }])
      expect(w).toMatchObject({ ok: true })
      // B no tiene esa carpeta activa: files:create falla con «no activa» antes de tocar disco
      const denied = await invokeAs(b, 'files:create', [{ cwd: dir, parent: '', name: 'x.txt', kind: 'file' }])
      expect(denied).toMatchObject({ ok: false })
      expect(await invokeAs(a, 'files:unwatch', [{ subId: 'sub-aaaaaaaa' }])).toMatchObject({ ok: true })
      a.sender.destroy()
      b.sender.destroy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('diálogos: sin ventana propia no se llama a BrowserWindow.fromWebContents (se usa el respaldo)', async () => {
    registerCodeHandlers(ipcMain as never, () => null)
    const a = callerFor()
    // dialog:openFolder usa windowOfSender: con remitente virtual no lanza (fromWebContents está minado)
    const res = await invokeAs(a, 'dialog:openFolder', [{}])
    expect(JSON.stringify(res)).not.toContain('no debe llamarse')
  })
})
