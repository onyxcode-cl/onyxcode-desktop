import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { on: vi.fn(), isPackaged: false, getVersion: () => '9.9.9', setAboutPanelOptions: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  session: { defaultSession: {} },
  shell: { openExternal: vi.fn() }
}))
vi.mock('../embedded-browser/session', () => ({ isEmbeddedBrowserSession: () => false }))
vi.mock('./app-protocol', () => ({ isTrustedUrl: () => true, originOf: () => null }))

import { setLang } from '@shared/i18n'
import { buildProductionMenuTemplate } from './web-security'

type Item = { label?: string; role?: string; submenu?: Item[] }
const top = (t: Item[]): string[] => t.map((i) => i.label ?? `role:${i.role}`)

describe('menú de Windows', () => {
  it('es: etiquetas explícitas en español, sin roles de menú de nivel superior', () => {
    setLang('es')
    const tpl = buildProductionMenuTemplate(false, 'win32') as Item[]
    expect(top(tpl)).toEqual(['Archivo', 'Edición', 'Ver', 'Ventana', 'Ayuda'])
    expect(tpl.every((i) => i.role === undefined)).toBe(true)
    expect(tpl[0].submenu?.[0]).toMatchObject({ role: 'quit', label: 'Salir' })
  })
  it('en: etiquetas en inglés', () => {
    setLang('en')
    const tpl = buildProductionMenuTemplate(false, 'win32') as Item[]
    expect(top(tpl)).toEqual(['File', 'Edit', 'View', 'Window', 'Help'])
    expect(tpl[0].submenu?.[0]).toMatchObject({ role: 'quit', label: 'Exit' })
    setLang('es')
  })
  it('todos los ítems con rol llevan etiqueta (si no, saldría el rótulo inglés) y conservan el rol', () => {
    setLang('es')
    const tpl = buildProductionMenuTemplate(false, 'win32') as Item[]
    const roles = tpl.flatMap((m) => m.submenu ?? []).filter((i) => i.role)
    expect(roles.map((i) => i.role)).toEqual([
      'quit',
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'selectAll',
      'resetZoom',
      'zoomIn',
      'zoomOut',
      'togglefullscreen',
      'minimize',
      'close'
    ])
    for (const i of roles) expect(i.label).toBeTruthy()
  })
  it('Linux y macOS no cambian (siguen usando roles)', () => {
    expect((buildProductionMenuTemplate(false) as Item[]).some((i) => i.role === 'fileMenu')).toBe(true)
    expect((buildProductionMenuTemplate(true) as Item[]).some((i) => i.role === 'windowMenu')).toBe(true)
  })
})
