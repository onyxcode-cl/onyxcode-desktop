// @vitest-environment jsdom
import { act, createElement } from 'react'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  viewers: [] as Array<{
    eventBus: { dispatch: (name: string, event?: unknown) => void }
    currentScaleValue: string | null
    currentScale: number
    currentPageNumber: number
    scrollMode: number
    setDocument: ReturnType<typeof vi.fn>
    fits: Array<[number, number]>
    update: ReturnType<typeof vi.fn>
    cleanup: ReturnType<typeof vi.fn>
  }>,
  observers: [] as Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn> }>,
  tasks: [] as Array<{ resolve: (pdf: { numPages: number }) => void; destroy: ReturnType<typeof vi.fn> }>,
  documentOptions: [] as unknown[],
  width: 0,
  height: 0
}))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (options: unknown) => {
    mock.documentOptions.push(options)
    let resolve!: (pdf: { numPages: number }) => void
    const task = { promise: new Promise((r) => (resolve = r)), destroy: vi.fn() }
    mock.tasks.push({ resolve, destroy: task.destroy })
    return task
  }
}))
vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
  ScrollMode: { VERTICAL: 0 },
  EventBus: class {
    listeners = new Map<string, (event: unknown) => void>()
    on(name: string, cb: (event: unknown) => void) {
      this.listeners.set(name, cb)
    }
    off(name: string) {
      this.listeners.delete(name)
    }
    dispatch(name: string, event?: unknown) {
      this.listeners.get(name)?.(event)
    }
  },
  PDFLinkService: class {
    setViewer = vi.fn()
    setDocument = vi.fn()
  },
  PDFFindController: class {},
  PDFViewer: class {
    eventBus: { dispatch: (name: string, event?: unknown) => void }
    currentScaleValue: string | null = null
    fits: Array<[number, number]> = []
    update = vi.fn()
    cleanup = vi.fn()
    constructor({ eventBus }: { eventBus: { dispatch: (name: string, event?: unknown) => void } }) {
      this.eventBus = eventBus
      Object.defineProperty(this, 'currentScaleValue', {
        get: () => this.value,
        set: (value: string) => {
          this.value = value
          this.fits.push([mock.width, mock.height])
          eventBus.dispatch('scalechanging', { scale: mock.width / 800 })
        }
      })
      mock.viewers.push(this)
    }
    scrollMode = -1
    currentPageNumber = 1
    value: string | null = null
    set currentScale(value: number) {
      this.value = String(value)
    }
    get currentScale() {
      return Number(this.value) || 1
    }
    setDocument = vi.fn(() => {
      this.eventBus.dispatch('pagesinit')
    })
  }
}))
import { PdfViewer } from './PdfViewer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
let frames: Map<number, FrameRequestCallback>
let frameId: number
const render = (token = 'test') => act(() => root.render(createElement(PdfViewer, { token, lang: 'es' })))
const loaded = async () => {
  await act(async () => mock.tasks.at(-1)!.resolve({ numPages: 2 }))
}
const resize = (width: number, height: number) => {
  mock.width = width
  mock.height = height
  act(() => mock.observers.at(-1)!.notify())
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('React', React)
  mock.viewers = []
  mock.observers = []
  mock.tasks = []
  mock.documentOptions = []
  mock.width = mock.height = 0
  frames = new Map()
  frameId = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++frameId, cb)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn()
      observe = vi.fn()
      constructor(notify: () => void) {
        mock.observers.push({ notify, disconnect: this.disconnect })
      }
    }
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => mock.width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => mock.height)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('espera a pagesinit y a ambas dimensiones, incluso si el documento llega antes del attach', async () => {
  render()
  resize(392, 600)
  expect(mock.viewers[0].fits).toEqual([])
  resize(0, 0)
  await loaded()
  resize(392, 0)
  expect(mock.viewers[0].fits).toEqual([])
  resize(392, 600)
  expect(mock.viewers[0].fits).toEqual([[392, 600]])
  expect(mock.viewers[0].currentScaleValue).toBe('page-width')
})

it('sigue ajustando desde la primera medida positiva hasta el tamaño final y los siguientes resize', async () => {
  render()
  resize(300, 400)
  await loaded()
  resize(392, 600)
  resize(559, 662)
  resize(559, 662)
  resize(0, 0)
  resize(700, 662)
  expect(mock.viewers[0].fits).toEqual([
    [300, 400],
    [392, 600],
    [559, 662],
    [700, 662]
  ])
  expect(frames.size).toBe(1)
  act(() => frames.values().next().value!(0))
  expect(mock.viewers[0].update).toHaveBeenCalledOnce()
})

it('conserva el zoom manual al ampliar o reducir el panel', async () => {
  render()
  resize(392, 600)
  await loaded()
  const buttons = host.querySelectorAll('button')
  act(() => buttons[1].click())
  const chosen = mock.viewers[0].currentScaleValue
  resize(559, 662)
  expect(mock.viewers[0].fits).toEqual([[392, 600]])
  expect(mock.viewers[0].currentScaleValue).toBe(chosen)
})

it('al abrir otro PDF vuelve al ajuste y cancela el observador, carga y repintado anteriores', async () => {
  render('one')
  resize(392, 600)
  await loaded()
  const old = mock.viewers[0]
  const observer = mock.observers[0]
  render('two')
  expect(observer.disconnect).toHaveBeenCalledOnce()
  expect(mock.tasks[0].destroy).toHaveBeenCalledOnce()
  expect(old.cleanup).toHaveBeenCalledOnce()
  expect(frames.size).toBe(0)
  act(() => observer.notify())
  expect(old.fits).toEqual([[392, 600]])
  await loaded()
  expect(mock.viewers[1].fits).toEqual([[392, 600]])
})

it('entrega el PDF completo al visor continuo, navega hasta la última página y sigue los cambios al desplazar', async () => {
  render()
  resize(392, 600)
  await act(async () => mock.tasks[0].resolve({ numPages: 5 }))
  const viewer = mock.viewers[0]
  expect(viewer.setDocument).toHaveBeenCalledWith({ numPages: 5 })
  expect(viewer.scrollMode).toBe(0)
  expect(mock.documentOptions[0]).toMatchObject({ url: '/doc/test', enableXfa: false })
  const next = host.querySelectorAll('button')[3]
  for (let i = 0; i < 4; i++) act(() => next.click())
  expect(viewer.currentPageNumber).toBe(5)
  expect(next.disabled).toBe(true)
  act(() => viewer.eventBus.dispatch('pagechanging', { pageNumber: 3 }))
  expect(host.textContent).toContain('3 / 5')
  expect(next.disabled).toBe(false)
})
