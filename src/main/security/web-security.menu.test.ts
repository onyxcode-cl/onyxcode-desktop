import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DISPLAY_NAME, INTERNAL_NAME } from '../../shared/brand'

const setAbout = vi.fn()
vi.mock('electron', () => ({
  app: { on: vi.fn(), isPackaged: false, getVersion: () => '9.9.9', setAboutPanelOptions: (o: unknown) => setAbout(o) },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  session: {
    defaultSession: {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      setDisplayMediaRequestHandler: vi.fn(),
      on: vi.fn()
    }
  },
  shell: { openExternal: vi.fn() }
}))
vi.mock('../embedded-browser/session', () => ({ isEmbeddedBrowserSession: () => false }))
vi.mock('./app-protocol', () => ({ isTrustedUrl: () => true, originOf: () => null }))

import { buildProductionMenuTemplate } from './web-security'

describe('menú de producción con el nombre visible', () => {
  beforeEach(() => setAbout.mockClear())

  it('en macOS el menú de la app dice Lazunox (Acerca de, Ocultar, Salir)', () => {
    const [appMenu] = buildProductionMenuTemplate(true)
    expect(appMenu.label).toBe('Lazunox')
    const labels = (appMenu.submenu as Array<{ label?: string }>).map((i) => i.label).filter(Boolean)
    expect(labels.length).toBe(3)
    for (const l of labels) {
      // Identidad única: DISPLAY_NAME e INTERNAL_NAME son ambos «Lazunox»; el menú muestra ese nombre.
      expect(l).toContain(DISPLAY_NAME)
      expect(l).toContain(INTERNAL_NAME)
    }
  })

  it('fuera de macOS no hay menú de la app', () => {
    expect(buildProductionMenuTemplate(false).some((i) => i.label === 'Lazunox')).toBe(false)
  })

  it('el panel Acerca de recibe applicationName «Lazunox»', async () => {
    const { installWebSecurity } = await import('./web-security')
    installWebSecurity()
    expect(setAbout).toHaveBeenCalledWith({ applicationName: 'Lazunox', applicationVersion: '9.9.9' })
  })
})
