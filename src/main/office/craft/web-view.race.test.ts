import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ servers: [] as Array<(s: unknown) => void>, views: [] as any[] }))
vi.mock('./web-server', () => ({ startWebServer: () => new Promise((resolve) => mock.servers.push(resolve)) }))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  session: {
    fromPartition: () => ({
      webRequest: { onBeforeRequest: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn()
    })
  },
  WebContentsView: class {
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn(),
      loadURL: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            this.loaded = resolve
          })
      ),
      executeJavaScript: vi.fn(async () => true)
    }
    loaded!: () => void
    setBounds = vi.fn()
    constructor() {
      mock.views.push(this)
    }
  }
}))
import { attachWeb, closeWeb, isWebActive, openWebDoc, onWebEvent } from './web-view'
const server = (port: number) => ({ origin: `http://127.0.0.1:${port}`, port, close: vi.fn(async () => undefined) })
const open = () => openWebDoc('/web', 'docx', 'a.docx', Buffer.from('documento'))
beforeEach(() => {
  mock.servers = []
  mock.views = []
})
afterEach(() => closeWeb())
it('la caída o el error tardío de una vista cerrada no se atribuye a la nueva', async () => {
  const first = open()
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const old = mock.views[0]
  old.loaded()
  await first
  const events: string[] = []
  const off = onWebEvent((event) => events.push(event.type))
  const second = open()
  mock.servers[1]!(server(2))
  await Promise.resolve()
  const callbacks = old.webContents.on.mock.calls as Array<[string, (...args: any[]) => void]>
  callbacks.find(([name]) => name === 'render-process-gone')![1]()
  callbacks.find(([name]) => name === 'did-fail-load')![1]({}, -2, 'ERR_FAILED', '', true)
  expect(events).toEqual([])
  mock.views[1].loaded()
  await second
  off()
})
it('cerrar y reabrir durante el arranque: el servidor viejo no reemplaza al vigente', async () => {
  const first = open()
  closeWeb()
  const second = open()
  const old = server(1),
    current = server(2)
  mock.servers[1]!(current)
  await Promise.resolve()
  const view = mock.views[0]
  mock.servers[0]!(old)
  expect(await first).toBe(false)
  expect(old.close).toHaveBeenCalledOnce()
  expect(current.close).not.toHaveBeenCalled()
  view.loaded()
  expect(await second).toBe(true)
  expect(view.webContents.loadURL).toHaveBeenCalledWith(expect.stringContaining(':2/'))
})
it('cambio de tema mientras carga: la carga anterior no ejecuta el script ni cierra la nueva', async () => {
  const first = open()
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const old = mock.views[0]
  const second = open()
  mock.servers[1]!(server(2))
  await Promise.resolve()
  const current = mock.views[1]
  old.loaded()
  expect(await first).toBe(false)
  expect(old.webContents.executeJavaScript).not.toHaveBeenCalled()
  current.loaded()
  expect(await second).toBe(true)
  expect(current.webContents.close).not.toHaveBeenCalled()
  expect(isWebActive()).toBe(true)
})

it('conserva el hueco del panel durante la carga nueva', async () => {
  const addChildView = vi.fn()
  const win = { isDestroyed: () => false, contentView: { addChildView, removeChildView: vi.fn() }, webContents: { getZoomFactor: () => 1 } }
  attachWeb(win as never, { x: 0, y: 0, width: 600, height: 400 }, true)
  const opening = open()
  mock.servers[0]!(server(1))
  await Promise.resolve()
  expect(addChildView).toHaveBeenCalledWith(mock.views[0])
  expect(mock.views[0].setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 600, height: 400 })
  mock.views[0].loaded()
  expect(await opening).toBe(true)
})
