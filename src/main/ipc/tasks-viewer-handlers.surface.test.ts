/** Handlers → web-open → view reales; solo Electron, disco y motores Office simulados. */
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { TasksInvokeChannel } from '@shared/ipc-tasks'
import type { TasksHandler, TasksIpcContext, TasksSubmodule } from './tasks-handle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveUiPath } from '../tasks/ui-path'

const mock = vi.hoisted(() => ({
  header: Buffer.from('%PDF-1.7'),
  loaded: undefined as (() => void) | undefined,
  installed: false,
  webActive: false,
  webAttach: vi.fn(),
  webOpen: vi.fn(),
  log: vi.fn(),
  approved: vi.fn(),
  present: vi.fn()
}))

vi.mock('../viewer/present-pptx', () => ({ presentPptxFile: mock.present }))
vi.mock('node:fs', () => ({
  openSync: () => 1,
  closeSync: vi.fn(),
  readSync: (_fd: number, head: Buffer) => head.set(mock.header),
  statSync: () => ({ size: 100 })
}))
vi.mock('node:fs/promises', () => ({ stat: async () => ({ size: 100 }), readFile: async () => Buffer.alloc(100) }))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  WebContentsView: class {
    bounds = { x: 0, y: 0, width: 0, height: 0 }
    visible = true
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
      isDestroyed: () => false,
      invalidate: vi.fn(),
      loadURL: vi.fn(() => new Promise<void>((resolve) => (mock.loaded = resolve)))
    }
    setBounds = (bounds: typeof this.bounds): void => {
      this.bounds = bounds
    }
    getBounds = () => this.bounds
    setVisible = (visible: boolean): void => {
      this.visible = visible
    }
    getVisible = () => this.visible
  }
}))
vi.mock('../viewer/session', () => ({ viewerSession: () => ({}) }))
vi.mock('../viewer/scheme', () => ({ installViewerScheme: vi.fn(), registerViewerPathValidator: vi.fn() }))
vi.mock('../office/craft/service', () => ({ craftService: () => ({ webDir: () => (mock.installed ? '/craft' : null) }) }))
vi.mock('../office/craft/craft-problems', () => ({ recordCraftProblem: vi.fn() }))
vi.mock('../office/craft/web-view', () => ({
  MAX_WEB_FILE_BYTES: 1000,
  onWebEvent: () => () => undefined,
  closeWeb: () => {
    mock.webActive = false
  },
  attachWeb: mock.webAttach,
  isWebActive: () => mock.webActive,
  openWebDoc: mock.webOpen
}))
vi.mock('../diagnostics/problem-log', () => ({ recordProblem: vi.fn() }))
vi.mock('./sender-window', () => ({ windowOfSender: () => null }))

import { registerTasksViewerHandlers } from './tasks-viewer-handlers'
import { viewerSurfaceState } from '../viewer/view'

type View = {
  visible: boolean
  bounds: { x: number; y: number; width: number; height: number }
  webContents: { invalidate: ReturnType<typeof vi.fn> }
}
let children: View[]
let win: BrowserWindow
let submodule: TasksSubmodule
let handlers: Partial<{ [C in TasksInvokeChannel]: TasksHandler<C> }>
const event = { sender: {} } as IpcMainInvokeEvent
const rect = { x: 730, y: 136, width: 559, height: 662 }
const attach = (visible: boolean, bounds = rect) => handlers['tasks:viewer:attach']!({ rect: bounds, visible }, event)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'info').mockImplementation(mock.log)
  mock.approved.mockImplementation((path: string) => path)
  mock.header = Buffer.from('%PDF-1.7')
  mock.loaded = undefined
  mock.installed = false
  mock.webActive = false
  mock.webOpen.mockImplementation(async () => {
    mock.webActive = true
    return true
  })
  children = []
  win = {
    isDestroyed: () => false,
    webContents: { getZoomFactor: () => 1 },
    contentView: {
      children,
      addChildView: (v: View) => children.push(v),
      removeChildView: (v: View) => {
        const i = children.indexOf(v)
        if (i >= 0) children.splice(i, 1)
      }
    }
  } as unknown as BrowserWindow
  handlers = {}
  submodule = registerTasksViewerHandlers({
    handle: (ch: TasksInvokeChannel, fn: TasksHandler<typeof ch>) => {
      Object.assign(handlers, { [ch]: fn })
    },
    tasks: { assertInsideApproved: mock.approved },
    send: vi.fn(),
    getWindow: () => win
  } as unknown as TasksIpcContext)
})
afterEach(async () => {
  await submodule.dispose?.()
  vi.restoreAllMocks()
})

describe('superficie del respaldo de Tareas', () => {
  it.each(['darwin', 'win32'] as const)(
    'PDF %s carga oculto y al estar listo se adjunta visible en el rectángulo del panel',
    async (platform) => {
      const path = resolveUiPath(platform === 'win32' ? '/win/c/Trabajo/Informe #1 ñ.PDF' : '/docs/Informe #1 ñ.PDF', platform)
      if (!path.ok) throw new Error('ruta de prueba inválida')
      await attach(false)
      const opening = handlers['tasks:viewer:open']!({ path: path.path, lang: 'es', theme: 'light', openingId: 'pdf' }, event)
      await vi.waitFor(() => expect(mock.loaded).toBeTypeOf('function'))
      expect(children).toHaveLength(0)
      expect(viewerSurfaceState()).toContain('visible=false, bounds=730,136,559x662')
      mock.loaded!()
      expect(await opening).toMatchObject({ ok: true, mode: 'classic', kind: 'pdf' })
      await attach(true)
      expect(children).toHaveLength(1)
      const view = children[0]
      expect(view.visible).toBe(true)
      expect(view.bounds).toEqual(rect)
      expect(view.webContents.invalidate).toHaveBeenCalledOnce()
      expect(mock.webOpen).not.toHaveBeenCalled()
      expect(mock.log).toHaveBeenLastCalledWith(expect.stringContaining('adjunta=true, visible=true, bounds=730,136,559x662'))
      // Diálogo/tab oculto y vuelta al documento, con una medida nueva.
      await attach(false)
      expect(children).toHaveLength(0)
      expect(view.visible).toBe(false)
      await attach(true, { ...rect, width: 640 })
      expect(children).toEqual([view])
      expect(view.visible).toBe(true)
      expect(view.bounds.width).toBe(640)
      handlers['tasks:viewer:close']!({ openingId: 'pdf' }, event)
      expect(children).toHaveLength(0)
    }
  )

  it.each(['docx', 'xlsx', 'pptx'] as const)('Office %s mantiene Craft y el respaldo visible si no está instalado', async (kind) => {
    mock.approved.mockImplementation((path: string) => path)
    mock.header = Buffer.from([0x50, 0x4b, 3, 4])
    const request = { path: `C:\\Trabajo\\archivo.${kind}`, lang: 'es' as const, theme: 'light' as const, openingId: kind }
    mock.installed = true
    await attach(false)
    expect(await handlers['tasks:viewer:open']!(request, event)).toMatchObject({ ok: true, mode: 'web', kind })
    await attach(true)
    expect(mock.webAttach).toHaveBeenLastCalledWith(win, rect, true)
    expect(children).toHaveLength(0)
    mock.installed = false
    await attach(false)
    const fallback = handlers['tasks:viewer:open']!({ ...request, openingId: `${kind}-fallback` }, event)
    await vi.waitFor(() => expect(mock.loaded).toBeTypeOf('function'))
    mock.loaded!()
    expect(await fallback).toMatchObject({ ok: true, mode: 'classic', kind })
    await attach(true)
    expect(children).toHaveLength(1)
    expect(children[0].visible).toBe(true)
    expect(children[0].bounds).toEqual(rect)
  })
})

it('Presentar valida el ámbito otra vez y solo pasa al motor la ruta autorizada', async () => {
  mock.approved.mockReturnValueOnce('/autorizada/real.pptx')
  await handlers['tasks:presentPptx']!({ path: '/visible/enlace.pptx' }, event)
  expect(mock.present).toHaveBeenCalledWith('/autorizada/real.pptx', expect.any(Function))
  mock.present.mockClear()
  mock.approved.mockImplementationOnce(() => {
    throw new Error('fuera de ámbito')
  })
  await expect(handlers['tasks:presentPptx']!({ path: '/fuera/archivo.pptx' }, event)).rejects.toThrow('fuera de ámbito')
  expect(mock.present).not.toHaveBeenCalled()
})
