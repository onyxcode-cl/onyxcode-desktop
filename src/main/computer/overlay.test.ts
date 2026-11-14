import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'
import { ComputerOverlay } from './overlay'
import { recordProblem } from '../diagnostics/problem-log'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (options: BrowserWindowConstructorOptions) {
    const win = new FakeWindow(options)
    windows.push(win)
    return win
  }),
  screen: {
    getPrimaryDisplay: () => ({ bounds, workArea: bounds, scaleFactor: 1.5 }),
    getCursorScreenPoint: () => ({ x: 10, y: 10 })
  }
}))
vi.mock('../extras/windows', () => ({
  extrasWindows: new Set(),
  isLangStale: () => false,
  loadLocalizedPage: async () => {},
  preloadPath: (name: string) => `${name}.js`
}))
vi.mock('../ipc/guard', () => ({ registerWindowRole: vi.fn() }))
vi.mock('./service', () => ({ motionDurationMs: () => 0 }))
vi.mock('../diagnostics/problem-log', () => ({ recordProblem: vi.fn() }))

const bounds = { x: 0, y: 0, width: 1280, height: 720 }
const windows: FakeWindow[] = []
class FakeWindow extends EventEmitter {
  destroyed = false
  visible = false
  opacity = 1
  bounds = { ...bounds }
  loading = true
  webContents = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    isLoading: () => this.loading
  })
  setAlwaysOnTop = vi.fn()
  setVisibleOnAllWorkspaces = vi.fn()
  setContentProtection = vi.fn()
  setIgnoreMouseEvents = vi.fn()
  constructor(readonly options: BrowserWindowConstructorOptions) {
    super()
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    this.destroyed = true
  }
  setBounds(value: Rectangle): void {
    this.bounds = value
  }
  getBounds(): Rectangle {
    return this.bounds
  }
  getContentBounds(): Rectangle {
    return this.bounds
  }
  setOpacity(value: number): void {
    this.opacity = value
  }
  getOpacity(): number {
    return this.opacity
  }
  showInactive(): void {
    this.visible = true
  }
  hide(): void {
    this.visible = false
  }
  isVisible(): boolean {
    return this.visible
  }
  isAlwaysOnTop(): boolean {
    return true
  }
}

describe.each(['win32', 'darwin'] as const)('diagnóstico del borde: %s', (platform) => {
  let overlay: ComputerOverlay
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    windows.length = 0
    vi.mocked(recordProblem).mockClear()
    overlay = new ComputerOverlay()
  })
  afterEach(() => {
    overlay.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('la acción abre el borde, registra geometría real y conserva protección y clics transparentes', () => {
    overlay.handleAction({ tool: 'mouse_move', phase: 'start', at: 0, x: 20, y: 30 })
    const win = windows[0]
    expect(win.options).toMatchObject({ transparent: true, frame: false, resizable: false, focusable: false })
    expect(win.setContentProtection).toHaveBeenCalledWith(true)
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 0)
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    expect(recordProblem).toHaveBeenCalledWith({
      source: 'main',
      level: 'warn',
      message: '[computer:overlay] show:action',
      detail: {
        platform,
        visible: 'true',
        opacity: 1,
        bounds: JSON.stringify(bounds),
        contentBounds: JSON.stringify(bounds),
        displayBounds: JSON.stringify(bounds),
        scaleFactor: 1.5,
        alwaysOnTop: 'true',
        loading: 'true',
        hideOnCapture: 'false'
      }
    })
    // La página puede cargar después de la acción: entrega la cola y deja constancia sin capturar.
    win.loading = false
    win.webContents.emit('did-finish-load')
    expect(win.webContents.send).toHaveBeenCalledWith('computer:overlay', expect.objectContaining({ type: 'show' }))
    expect(recordProblem).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: '[computer:overlay] loaded', detail: expect.objectContaining({ loading: 'false' }) })
    )
    overlay.handleAction({ tool: 'mouse_move', phase: 'end', at: 1 })
    expect(recordProblem).toHaveBeenCalledTimes(2)
  })

  it('anota la sesión sin su etiqueta y no levanta el borde por una captura automática', () => {
    overlay.handleAction({ tool: 'screenshot', phase: 'start', auto: true, at: 0 })
    expect(windows).toHaveLength(0)
    expect(recordProblem).not.toHaveBeenCalled()
    overlay.setSession(true, 'etiqueta privada')
    expect(recordProblem).toHaveBeenCalledWith(expect.objectContaining({ message: '[computer:overlay] show:session' }))
    expect(JSON.stringify(vi.mocked(recordProblem).mock.calls)).not.toContain('etiqueta privada')
  })

  it.each(['action', 'session'] as const)('registra el primer %s tras un permiso flotante, sin repetir por cada movimiento', (trigger) => {
    overlay.showAccessRequest({ id: 'req', apps: [], plan: ['paso privado'] }, true)
    expect(recordProblem).toHaveBeenCalledWith(expect.objectContaining({ message: '[computer:overlay] show:permission' }))
    overlay.handleAction({ tool: 'screenshot', phase: 'start', auto: true, at: 0 })
    expect(recordProblem).toHaveBeenCalledTimes(1)
    if (trigger === 'session') overlay.setSession(true, 'etiqueta privada')
    overlay.handleAction({ tool: 'mouse_move', phase: 'start', at: 1 })
    overlay.handleAction({ tool: 'mouse_move', phase: 'end', at: 2 })
    overlay.handleAction({ tool: 'mouse_move', phase: 'start', at: 3 })
    expect(recordProblem).toHaveBeenCalledTimes(2)
    expect(recordProblem).toHaveBeenLastCalledWith(expect.objectContaining({ message: `[computer:overlay] control:${trigger}` }))
    expect(JSON.stringify(vi.mocked(recordProblem).mock.calls)).not.toContain('privad')
    // Otra sesión puede empezar antes de terminar el desvanecimiento: debe quedar diagnosticada.
    overlay.setSession(false)
    overlay.setSession(true)
    expect(recordProblem).toHaveBeenCalledTimes(3)
    expect(recordProblem).toHaveBeenLastCalledWith(expect.objectContaining({ message: '[computer:overlay] control:session' }))
  })

  it('un error al leer el estado para diagnóstico no interrumpe la acción', () => {
    overlay.setSession(true)
    overlay.serverGone()
    vi.advanceTimersByTime(400)
    const getContentBounds = vi.spyOn(windows[0], 'getContentBounds').mockImplementation(() => {
      throw new Error('ventana cerrándose')
    })
    expect(() => overlay.handleAction({ tool: 'mouse_move', phase: 'start', at: 400 })).not.toThrow()
    expect(getContentBounds).toHaveBeenCalledOnce()
  })
})
