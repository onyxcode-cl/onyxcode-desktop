import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mock = vi.hoisted(() => ({ servers: [] as Array<(s: unknown) => void>, views: [] as any[], userData: '' }))
vi.mock('./web-server', () => ({ startWebServer: vi.fn(() => new Promise((resolve) => mock.servers.push(resolve))) }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => mock.userData },
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
      executeJavaScript: vi.fn(async () => true),
      capturePage: vi.fn(async () => screenshot(false))
    }
    loaded!: () => void
    setBounds = vi.fn()
    constructor() {
      mock.views.push(this)
    }
  }
}))
import { attachWeb, closeWeb, isWebActive, openWebDoc, onWebEvent } from './web-view'
import { startWebServer } from './web-server'
vi.mock('./craft-problems', () => ({ recordCraftProblem: vi.fn() }))
import { recordCraftProblem } from './craft-problems'

function screenshot(blank: boolean) {
  const pixels = Buffer.alloc(16 * 16 * 4, 255)
  if (!blank) pixels.fill(0, 0, pixels.length / 2)
  return { toBitmap: () => pixels, getSize: () => ({ width: 16, height: 16 }), toPNG: () => Buffer.from('png de prueba') }
}
async function painted(opening: Promise<boolean>): Promise<boolean> {
  await vi.advanceTimersByTimeAsync(1500)
  return opening
}
const server = (port: number) => ({ origin: `http://127.0.0.1:${port}`, port, close: vi.fn(async () => undefined) })
const open = () => openWebDoc('/web', 'docx', 'a.docx', Buffer.from('documento'))
beforeEach(() => {
  vi.useFakeTimers()
  mock.userData = mkdtempSync(join(tmpdir(), 'web-blank-'))
  vi.mocked(recordCraftProblem).mockClear()
  mock.servers = []
  mock.views = []
  vi.mocked(startWebServer).mockClear()
})
afterEach(() => {
  closeWeb()
  vi.useRealTimers()
  rmSync(mock.userData, { recursive: true, force: true })
})
it.each(['pdf', 'docx', 'xlsx', 'pptx'] as const)(
  'abre el HTML original sin preferencias inyectadas y con una única carga: %s',
  async (ext) => {
    const opening = openWebDoc('/web', ext, `a.${ext}`, Buffer.from('documento'))
    expect(startWebServer).toHaveBeenCalledWith('/web')
    mock.servers[0]!(server(1))
    await Promise.resolve()
    const view = mock.views[0]
    view.loaded()
    expect(await painted(opening)).toBe(true)
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(view.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
  }
)

it('la caída o el error tardío de una vista cerrada no se atribuye a la nueva', async () => {
  const first = open()
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const old = mock.views[0]
  old.loaded()
  await painted(first)
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
  await painted(second)
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
  expect(await painted(second)).toBe(true)
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
  expect(await painted(second)).toBe(true)
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
  expect(await painted(opening)).toBe(true)
})

it('PDF recibe el tamaño del panel incluso si un attach pide mantenerlo oculto', async () => {
  const win = {
    isDestroyed: () => false,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { getZoomFactor: () => 1.25 }
  }
  attachWeb(win as never, { x: 10, y: 40, width: 392, height: 600 }, false)
  const opening = openWebDoc('/web', 'pdf', 'a.pdf', Buffer.from('documento'))
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const view = mock.views[0]
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 13, y: 50, width: 490, height: 750 })
  expect(view.setBounds.mock.invocationCallOrder[0]).toBeLessThan(view.webContents.loadURL.mock.invocationCallOrder[0])
  expect(win.contentView.addChildView).not.toHaveBeenCalled()
  // Otra medida durante la carga también se aplica sin descubrir el documento bajo el spinner.
  attachWeb(win as never, { x: 10, y: 40, width: 559, height: 662 }, false)
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 13, y: 50, width: 699, height: 828 })
  expect(win.contentView.addChildView).not.toHaveBeenCalled()
  view.loaded()
  expect(await painted(opening)).toBe(true)
  attachWeb(win as never, { x: 10, y: 40, width: 559, height: 662 }, true)
  expect(win.contentView.addChildView).toHaveBeenCalledOnce()
})

it('un hueco 0x0 no muestra ni reduce a cero la superficie ya medida', async () => {
  const win = {
    isDestroyed: () => false,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { getZoomFactor: () => 1 }
  }
  attachWeb(win as never, { x: 0, y: 0, width: 559, height: 662 }, true)
  const opening = open()
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const view = mock.views[0]
  view.loaded()
  await painted(opening)
  view.setBounds.mockClear()
  win.contentView.addChildView.mockClear()
  attachWeb(win as never, { x: 0, y: 0, width: 0, height: 0 }, true)
  expect(view.setBounds).not.toHaveBeenCalled()
  expect(win.contentView.addChildView).not.toHaveBeenCalled()
  expect(win.contentView.removeChildView).toHaveBeenCalledWith(view)
})

it('no declara cargado hasta ver contenido, y reintenta a los 4 s si la primera captura es blanca', async () => {
  const events: string[] = []
  const off = onWebEvent((event) => events.push(event.type))
  try {
    const opening = open()
    mock.servers[0]!(server(1))
    await Promise.resolve()
    const view = mock.views[0]
    view.webContents.capturePage.mockResolvedValueOnce(screenshot(true)).mockResolvedValueOnce(screenshot(false))
    view.loaded()
    await vi.advanceTimersByTimeAsync(1499)
    expect(view.webContents.capturePage).not.toHaveBeenCalled()
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(view.webContents.capturePage).toHaveBeenCalledOnce()
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(2500)
    expect(await opening).toBe(true)
    expect(events).toEqual(['loaded'])
    expect(recordCraftProblem).not.toHaveBeenCalled()
    expect(existsSync(join(mock.userData, 'diagnostico'))).toBe(false)
  } finally {
    off()
  }
})

it('dos capturas blancas devuelven false para el respaldo, conservan evidencia y solo las 50 últimas líneas', async () => {
  const bytes = Buffer.from('documento original')
  const opening = openWebDoc('/web', 'pptx', 'a.pptx', bytes)
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const view = mock.views[0]
  const consoleMessage = view.webContents.on.mock.calls.find(([name]: [string]) => name === 'console-message')![1]
  for (let i = 0; i < 60; i++) consoleMessage({}, 1, `línea ${i}\n`)
  view.webContents.capturePage.mockResolvedValue(screenshot(true))
  view.loaded()
  await vi.advanceTimersByTimeAsync(4000)
  expect(await opening).toBe(false)
  expect(view.webContents.capturePage).toHaveBeenCalledTimes(2)
  const root = join(mock.userData, 'diagnostico', 'visor-en-blanco')
  const png = readdirSync(root).find((name) => name.endsWith('.png'))!
  const base = png.slice(0, -4)
  expect(readFileSync(join(root, png))).toEqual(screenshot(true).toPNG())
  expect(readFileSync(join(root, `${base}.pptx`))).toEqual(bytes)
  const lines = readFileSync(join(root, `${base}.log`), 'utf8').split('\n')
  expect(lines).toHaveLength(50)
  expect(lines[0]).toBe('línea 10 ')
  expect(lines[49]).toBe('línea 59 ')
  expect(recordCraftProblem).toHaveBeenCalledWith(
    'vista web',
    expect.any(Error),
    expect.objectContaining({ ancho: 16, alto: 16, bytes: bytes.length })
  )
})

it('conserva tres incidentes y elimina también los PDF y logs de los antiguos', async () => {
  const root = join(mock.userData, 'diagnostico', 'visor-en-blanco')
  mkdirSync(root, { recursive: true })
  for (let i = 0; i < 3; i++) {
    for (const ext of ['png', 'pdf', 'log']) writeFileSync(join(root, `captura-${i}.${ext}`), 'anterior')
    utimesSync(join(root, `captura-${i}.png`), new Date(i * 1000), new Date(i * 1000))
  }
  const opening = openWebDoc('/web', 'pdf', 'a.pdf', Buffer.from('PDF'))
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const view = mock.views[0]
  view.webContents.capturePage.mockResolvedValue(screenshot(true))
  view.loaded()
  await vi.advanceTimersByTimeAsync(4000)
  expect(await opening).toBe(false)
  const files = readdirSync(root)
  expect(files).toHaveLength(9)
  expect(files.filter((name) => name.endsWith('.png'))).toHaveLength(3)
  expect(files.some((name) => name.startsWith('captura-0.'))).toBe(false)
})

it('cerrar mientras se captura no emite cargado ni guarda evidencia de la vista anterior', async () => {
  const events: string[] = []
  const off = onWebEvent((event) => events.push(event.type))
  try {
    const opening = open()
    mock.servers[0]!(server(1))
    await Promise.resolve()
    const view = mock.views[0]
    let finish!: (shot: ReturnType<typeof screenshot>) => void
    view.webContents.capturePage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    view.loaded()
    await vi.advanceTimersByTimeAsync(1500)
    closeWeb()
    finish(screenshot(false))
    expect(await opening).toBe(false)
    expect(events).toEqual([])
    expect(recordCraftProblem).not.toHaveBeenCalled()
    expect(existsSync(join(mock.userData, 'diagnostico'))).toBe(false)
  } finally {
    off()
  }
})

it('una captura colgada vence y permite el respaldo sin esperar para siempre', async () => {
  const opening = open()
  const assertion = expect(opening).rejects.toThrow('captura')
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const view = mock.views[0]
  view.webContents.capturePage.mockImplementation(() => new Promise(() => undefined))
  view.loaded()
  await vi.advanceTimersByTimeAsync(2500)
  await assertion
})

it('un fallo al escribir la evidencia no impide devolver false para abrir el respaldo', async () => {
  writeFileSync(join(mock.userData, 'diagnostico'), 'archivo que impide crear la carpeta')
  const opening = open()
  mock.servers[0]!(server(1))
  await Promise.resolve()
  const view = mock.views[0]
  view.webContents.capturePage.mockResolvedValue(screenshot(true))
  view.loaded()
  await vi.advanceTimersByTimeAsync(4000)
  expect(await opening).toBe(false)
})
