import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveUiPath } from '../tasks/ui-path'
import { isInside } from '../util/paths'
import { unpacked } from '../util/asar'

const mock = vi.hoisted(() => ({
  web: vi.fn<(_kind: 'pdf' | 'docx' | 'xlsx' | 'pptx', _path: string, _title: string) => Promise<boolean>>(async () => true),
  header: [0x50, 0x4b, 3, 4],
  classic: vi.fn<(_url: string) => Promise<boolean>>(async () => true),
  problem: vi.fn(),
  close: vi.fn()
}))
afterEach(() => vi.useRealTimers())
vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent', isPackaged: false }, session: {}, protocol: {} }))
vi.mock('node:fs', () => ({
  openSync: () => 1,
  closeSync: () => undefined,
  readSync: (_fd: number, head: Buffer) => {
    head.set(mock.header)
    return mock.header.length
  },
  statSync: () => ({ size: 100 })
}))
vi.mock('../viewer/present-pptx', () => ({ presentPptxFile: vi.fn() }))
vi.mock('../viewer/scheme', () => ({ installViewerScheme: vi.fn(), registerViewerPathValidator: vi.fn() }))
vi.mock('../viewer/view', () => ({
  viewerSurfaceState: () => 'simulada',
  onViewerEvent: () => () => undefined,
  openDoc: mock.classic,
  detach: vi.fn(),
  attach: vi.fn(),
  closeView: vi.fn()
}))
vi.mock('../office/craft/web-view', () => ({
  onWebEvent: () => () => undefined,
  closeWeb: vi.fn(),
  attachWeb: vi.fn(),
  isWebActive: () => false
}))
vi.mock('../office/craft/service', () => ({
  craftService: () => {
    throw new Error('PDF no necesita Craft')
  }
}))
vi.mock('../office/craft/web-open', () => ({
  openInCraftWeb: mock.web,
  panelAttach: vi.fn(),
  panelClose: mock.close,
  useClassicViewer: vi.fn()
}))
vi.mock('../diagnostics/problem-log', () => ({ recordProblem: mock.problem }))
vi.mock('./sender-window', () => ({ windowOfSender: () => null }))
import { registerTasksViewerHandlers, viewerLogPath } from './tasks-viewer-handlers'

let handlers: Record<string, (req: any, event?: any) => any>
beforeEach(() => {
  vi.clearAllMocks()
  mock.header = [0x50, 0x4b, 3, 4]
  mock.web.mockResolvedValue(true)
  mock.classic.mockResolvedValue(true)
  handlers = {}
  registerTasksViewerHandlers({
    handle: (ch: string, fn: any) => {
      handlers[ch] = fn
    },
    tasks: {
      assertInsideApproved: (path: string) => {
        const r = resolveUiPath(path, 'win32')
        if (!r.ok || !isInside(r.path, 'C:\\Trabajo', 'win32')) throw new Error('no autorizado')
        return r.path
      }
    },
    send: vi.fn(),
    getWindow: () => null
  } as never)
})
const open = (path = 'C:\\Trabajo\\sub\\Informe #1 ñ.DOCX') =>
  handlers['tasks:viewer:open']({ path, openingId: 'win', lang: 'es', theme: 'light' })

describe('camino del visor con win32 inyectado', () => {
  it.each([
    ['C:\\Trabajo\\sub\\Informe #1 ñ.PDF', 'C:\\Trabajo\\sub\\Informe #1 ñ.PDF'],
    ['c:/Trabajo/sub/Informe #1 ñ.PDF', 'C:\\Trabajo\\sub\\Informe #1 ñ.PDF'],
    ['/win/c/Trabajo/sub/Informe #1 ñ.PDF', 'C:\\Trabajo\\sub\\Informe #1 ñ.PDF']
  ])('PDF con %s selecciona PDF.js y conserva la ruta únicamente en el token', async (input, expected) => {
    mock.header = [0x25, 0x50, 0x44, 0x46, 0x2d]
    const { openInCraftWeb } = await vi.importActual<typeof import('../office/craft/web-open')>('../office/craft/web-open')
    mock.web.mockImplementationOnce(openInCraftWeb)
    expect(await open(input)).toMatchObject({ ok: true, mode: 'classic', kind: 'pdf' })
    const url = new URL(mock.classic.mock.calls[0][0])
    expect(url.protocol).toBe('lazunox-viewer:')
    expect(url.hash).toMatch(/^#t=[0-9a-f]{64}&kind=pdf&lang=es&theme=light$/)
    expect(url.href).not.toMatch(/Trabajo|Informe|file:/)
    const { resolveToken } = await import('../viewer/tokens')
    expect(resolveToken(new URLSearchParams(url.hash.slice(1)).get('t')!)).toEqual({ path: expected, kind: 'pdf' })
  })

  it('el reloj de main cierra una apertura pendiente aunque el renderer no mande cierre', async () => {
    vi.useFakeTimers()
    let done!: (ok: boolean) => void
    mock.web.mockImplementationOnce(
      () =>
        new Promise((r) => {
          done = r
        })
    )
    const p = open()
    await vi.advanceTimersByTimeAsync(8000)
    expect(mock.close).toHaveBeenCalledOnce()
    expect(mock.problem).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('sin respuesta a los 8 s; etapa=web') })
    )
    done(false)
    expect(await p).toMatchObject({ ok: false })
    expect(mock.classic).not.toHaveBeenCalled()
  })
  it('sin ventana no confirma la colocación de la superficie nativa', () => {
    expect(handlers['tasks:viewer:attach']({ rect: { x: 0, y: 0, width: 500, height: 600 }, visible: true }, { sender: {} })).toBe(false)
  })
  it.each([
    ['C:\\Trabajo\\sub\\Informe #1 ñ.DOCX', 'C:\\Trabajo\\sub\\Informe #1 ñ.DOCX'],
    ['c:/Trabajo/sub/Informe #1 ñ.DOCX', 'C:\\Trabajo\\sub\\Informe #1 ñ.DOCX'],
    ['/win/c/Trabajo/sub/Informe #1 ñ.DOCX', 'C:\\Trabajo\\sub\\Informe #1 ñ.DOCX'],
    ['C:\\TRABAJO\\sub\\Informe #1 ñ.DOCX', 'C:\\TRABAJO\\sub\\Informe #1 ñ.DOCX']
  ])('normaliza %s antes de leer y abrir', async (input, expected) => {
    expect(await open(input)).toMatchObject({ ok: true, mode: 'web', kind: 'docx' })
    expect(mock.web).toHaveBeenCalledWith('docx', expected, 'Informe #1 ñ')
  })
  it('el respaldo usa esquema/token, sin convertir C: ni # ni espacios a file://', async () => {
    mock.web.mockResolvedValue(false)
    expect(await open()).toMatchObject({ ok: true, mode: 'classic' })
    const url = new URL(mock.classic.mock.calls[0]![0] as string)
    expect(url.protocol).toBe('lazunox-viewer:')
    expect(url.host).toBe('viewer')
    expect(url.hash).toMatch(/^#t=[0-9a-f]{64}&kind=docx&lang=es&theme=light$/)
    expect(url.href).not.toContain('Trabajo')
  })
  it('el respaldo no se da por cargado hasta que loadURL termina', async () => {
    mock.web.mockResolvedValue(false)
    let done!: (ok: boolean) => void
    mock.classic.mockImplementation(
      () =>
        new Promise((r) => {
          done = r
        })
    )
    let settled = false
    const p = open().then((result: unknown) => {
      settled = true
      return result
    })
    await vi.waitFor(() => expect(mock.classic).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    done(false)
    expect(await p).toEqual({ ok: false, reason: 'load-failed' })
    expect(mock.problem).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('carga del respaldo fallida') }))
  })
  it('un error anterior a craft queda registrado sin filtrar los padres', async () => {
    expect(await open('C:\\Users\\persona\\privado\\a.docx')).toEqual({ ok: false, reason: 'load-failed' })
    expect(mock.web).not.toHaveBeenCalled()
    const message = mock.problem.mock.calls[0]![0].message
    expect(message).toContain('etapa=ruta; ruta=…/a.docx')
    expect(message).not.toMatch(/Users|persona|privado/)
  })
  it('el vencimiento deja motivo y nombre del archivo en el registro permanente', async () => {
    await open()
    handlers['tasks:viewer:close']({ openingId: 'viejo', reason: 'timeout' })
    expect(mock.problem).not.toHaveBeenCalled()
    handlers['tasks:viewer:close']({ openingId: 'win', reason: 'timeout' })
    expect(mock.problem).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('sin respuesta a los 8 s; etapa=listo; ruta=…/Informe #1 ñ.DOCX') })
    )
    expect(mock.close).toHaveBeenCalledOnce()
  })
  it('una ruta del asar con barras de Windows apunta al pin desempaquetado', () => {
    expect(unpacked('C:\\Apps\\resources\\app.asar\\resources\\craft\\pin.json')).toBe(
      'C:\\Apps\\resources\\app.asar.unpacked\\resources\\craft\\pin.json'
    )
  })
  it('el registro descarta padres y saltos de línea de cualquier plataforma', () => {
    expect(viewerLogPath('/carpeta/personal/archivo\n.docx')).toBe('…/archivo_.docx')
    expect(viewerLogPath('/win/c/Users/persona/a.docx')).toBe('…/a.docx')
  })
})
