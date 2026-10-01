import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron se sustituye: solo importa el menú que se construye y cuándo se reconstruye.
const menus: { label?: string }[][] = []
const setContextMenu = vi.fn()

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  Menu: {
    buildFromTemplate: (items: { label?: string }[]) => {
      menus.push(items)
      return { items }
    }
  },
  nativeImage: { createFromBitmap: () => ({ setTemplateImage: vi.fn() }) },
  Tray: class {
    setToolTip = vi.fn()
    setContextMenu = setContextMenu
    isDestroyed = (): boolean => false
    destroy = vi.fn()
  }
}))

const labels = (items: { label?: string }[]): string[] => items.map((i) => i.label).filter((l): l is string => Boolean(l))

describe('bandeja: idioma', () => {
  beforeEach(() => {
    menus.length = 0
    setContextMenu.mockClear()
    vi.resetModules()
  })
  it('en español el menú es el de siempre', async () => {
    const { createTray, destroyTray } = await import('./tray')
    createTray({ onNewConversation: vi.fn(), onQuickEntry: vi.fn(), onOpenApp: vi.fn(), onOpenSettings: vi.fn() }, 'Alt+Space')
    expect(labels(menus.at(-1) ?? [])).toEqual(['Nueva conversación', 'Quick Entry', 'Abrir OnyxCode', 'Ajustes…', 'Salir de OnyxCode'])
    destroyTray()
  })

  it('al cambiar de idioma la bandeja se reconstruye en inglés', async () => {
    const { createTray, destroyTray } = await import('./tray')
    // Tras resetModules, el módulo de idioma es el que ve tray.ts.
    const { setLang } = await import('@shared/i18n')
    createTray({ onNewConversation: vi.fn(), onQuickEntry: vi.fn(), onOpenApp: vi.fn(), onOpenSettings: vi.fn() }, 'Alt+Space')
    setContextMenu.mockClear()
    setLang('en')
    expect(setContextMenu).toHaveBeenCalledTimes(1)
    expect(labels(menus.at(-1) ?? [])).toEqual(['New conversation', 'Quick Entry', 'Open OnyxCode', 'Settings…', 'Quit OnyxCode'])
    destroyTray()
  })
})
