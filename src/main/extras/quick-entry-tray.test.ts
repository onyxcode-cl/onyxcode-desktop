import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('Quick Entry sin puerta de cuenta', () => {
  it('el atajo (toggle) abre Quick Entry', async () => {
    const qe = await import('./quick-entry')
    qe.toggleQuickEntry()
    expect(created).toHaveLength(1)
    qe.destroyQuickEntry()
  })

  it('showQuickEntry abre la ventana', async () => {
    const qe = await import('./quick-entry')
    qe.showQuickEntry()
    expect(created).toHaveLength(1)
    qe.destroyQuickEntry()
  })

  it('el prompt se entrega a la ventana principal', async () => {
    const qe = await import('./quick-entry')
    qe.deliverQuickPrompt({ createMainWindow: vi.fn(), getMainWindow: () => null }, { text: 'hola' })
    expect(showMainWindow).toHaveBeenCalledTimes(1)
  })

  it('un prompt vacío no se entrega', async () => {
    const qe = await import('./quick-entry')
    qe.deliverQuickPrompt({ createMainWindow: vi.fn(), getMainWindow: () => null }, { text: '   ' })
    expect(showMainWindow).not.toHaveBeenCalled()
  })
})

describe('bandeja sin puerta de cuenta', () => {
  it('«Nueva conversación», «Quick Entry», «Ajustes», «Abrir» y «Salir» actúan siempre', async () => {
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
    initExtras({ createMainWindow: vi.fn(), getMainWindow: () => null })

    actions.onQuickEntry()
    expect(toggle).toHaveBeenCalledTimes(1)
    actions.onNewConversation()
    expect(send).toHaveBeenCalledWith('extras:new-conversation')
    actions.onOpenSettings()
    expect(send).toHaveBeenCalledWith('extras:open-settings')
    actions.onOpenApp()
    expect(showMainWindow).toHaveBeenCalledTimes(3)
    expect(typeof actions.onQuit).toBe('function')
    vi.doUnmock('./tray')
    vi.doUnmock('./quick-entry')
    vi.doUnmock('./prefs')
  })
})
