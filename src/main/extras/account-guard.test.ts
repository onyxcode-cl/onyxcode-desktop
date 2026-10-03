import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccountAccessCheck, whenAccountAllowed } from '../account/access'

// Electron y las ventanas se sustituyen: aquí solo importa si se ABRE algo o no.
const created: unknown[] = []
vi.mock('electron', () => {
  class FakeWindow {
    webContents = {
      send: vi.fn(),
      isLoading: () => false,
      once: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      isDevToolsOpened: () => false
    }
    constructor() {
      created.push(this)
    }
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    on = vi.fn()
    setBounds = vi.fn()
    isDestroyed = () => false
    isVisible = () => false
    isFocused = () => false
    hide = vi.fn()
    destroy = vi.fn()
  }
  return {
    BrowserWindow: FakeWindow,
    globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } })
    },
    app: { quit: vi.fn(), on: vi.fn(), isPackaged: false, getPath: () => '/tmp' }
  }
})
vi.mock('../ipc/guard', () => ({ registerWindowRole: vi.fn() }))
vi.mock('../e2e-headless', () => ({ presentWindow: vi.fn() }))

const showMainWindow = vi.fn(() => ({
  win: { isDestroyed: () => false, webContents: { isLoading: () => false, send: vi.fn(), once: vi.fn() } },
  fresh: false
}))
vi.mock('./windows', () => ({
  extrasWindows: new Set(),
  loadRendererPage: vi.fn(async () => undefined),
  loadLocalizedPage: vi.fn(async () => undefined),
  isLangStale: () => false,
  preloadPath: () => '/preload.js',
  showMainWindow: (...a: unknown[]) => (showMainWindow as (...x: unknown[]) => unknown)(...a)
}))

beforeEach(() => {
  created.length = 0
  showMainWindow.mockClear()
})
afterEach(() => setAccountAccessCheck(null))

describe('Quick Entry con la cuenta', () => {
  it('cuenta al día (o apagada): el atajo abre Quick Entry', async () => {
    const qe = await import('./quick-entry')
    qe.toggleQuickEntry()
    expect(created).toHaveLength(1)
    qe.destroyQuickEntry()
  })

  it('sin cuenta al día: ni el atajo global (toggle) ni show abren nada', async () => {
    setAccountAccessCheck(() => false)
    const qe = await import('./quick-entry')
    qe.toggleQuickEntry()
    qe.showQuickEntry()
    expect(created).toHaveLength(0)
  })

  it('sin cuenta al día: un prompt pendiente no llega a la ventana principal', async () => {
    setAccountAccessCheck(() => false)
    const qe = await import('./quick-entry')
    qe.deliverQuickPrompt({ createMainWindow: vi.fn(), getMainWindow: () => null }, { text: 'hola' })
    expect(showMainWindow).not.toHaveBeenCalled()
  })

  it('con cuenta al día el prompt sí se entrega', async () => {
    const qe = await import('./quick-entry')
    qe.deliverQuickPrompt({ createMainWindow: vi.fn(), getMainWindow: () => null }, { text: 'hola' })
    expect(showMainWindow).toHaveBeenCalledTimes(1)
  })
})

describe('whenAccountAllowed (atajo y bandeja)', () => {
  it('ejecuta solo con cuenta al día y pasa los argumentos', () => {
    const fn = vi.fn()
    const wrapped = whenAccountAllowed(fn)
    wrapped(1, 2)
    expect(fn).toHaveBeenCalledWith(1, 2)
    setAccountAccessCheck(() => false)
    wrapped(3)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('bandeja con la cuenta', () => {
  it('«Nueva conversación», «Quick Entry» y «Ajustes» no actúan sin cuenta; «Abrir» y «Salir» sí', async () => {
    vi.resetModules()
    const actions: Record<string, () => void> = {}
    vi.doMock('./tray', () => ({
      createTray: (a: Record<string, () => void>) => Object.assign(actions, a),
      destroyTray: vi.fn(),
      updateTrayShortcut: vi.fn(),
      setTrayRemoteActive: vi.fn()
    }))
    const toggle = vi.fn()
    vi.doMock('./quick-entry', () => ({
      destroyQuickEntry: vi.fn(),
      registerQuickEntryShortcut: () => null,
      toggleQuickEntry: toggle,
      warmQuickEntry: vi.fn()
    }))
    vi.doMock('./prefs', () => ({
      extrasPrefs: { get: () => ({ quickEntryShortcut: 'Alt+Space', showTray: true }), onChange: vi.fn() }
    }))
    vi.doMock('./artifact-window', () => ({ openArtifact: vi.fn(), ARTIFACT_CSP: '' }))
    vi.doMock('./mcp-config', () => ({ appOpencodeConfigEnv: vi.fn(), appOpencodeConfigPath: vi.fn(), ensureAppOpencodeConfig: vi.fn() }))
    const send = vi.fn()
    showMainWindow.mockReturnValue({
      win: { isDestroyed: () => false, webContents: { isLoading: () => false, send, once: vi.fn() } },
      fresh: false
    })
    const { initExtras } = await import('./index')
    const { setAccountAccessCheck: set } = await import('../account/access')
    initExtras({ createMainWindow: vi.fn(), getMainWindow: () => null })

    set(() => false)
    actions.onNewConversation()
    actions.onQuickEntry()
    actions.onOpenSettings()
    expect(toggle).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    actions.onOpenApp()
    expect(showMainWindow).toHaveBeenCalledTimes(1)

    set(() => true)
    actions.onQuickEntry()
    actions.onNewConversation()
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('extras:new-conversation')
    vi.doUnmock('./tray')
    vi.doUnmock('./quick-entry')
    vi.doUnmock('./prefs')
  })
})
