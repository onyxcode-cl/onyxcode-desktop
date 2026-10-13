// El clic derecho debe ofrecer Cortar/Copiar/Pegar en los campos de texto (Electron no trae menú contextual por defecto).
// El menú nativo no se ve desde Playwright: se comprueba que la ventana lo tenga enganchado y que, al dispararse el evento de un campo
// editable, se construya el menú con las acciones de edición.
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { fakeOutsideUserData } from '../lib/lotes'

const fakeBin = fakeOutsideUserData()

describe('menú de clic derecho (copiar y pegar)', () => {
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin } })

  it('un campo de texto editable abre un menú con deshacer, cortar, copiar, pegar y seleccionar todo', async () => {
    const a = app()
    const roles = await a.electronApp.evaluate(async ({ BrowserWindow, Menu }) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'))
      if (!win) return ['sin-ventana']
      let captured: string[] = []
      const original = Menu.buildFromTemplate.bind(Menu)
      Menu.buildFromTemplate = ((tpl: Electron.MenuItemConstructorOptions[]) => {
        captured = tpl.filter((i) => i.type !== 'separator').map((i) => String(i.role ?? i.label))
        const menu = original(tpl)
        menu.popup = (() => undefined) as typeof menu.popup
        return menu
      }) as typeof Menu.buildFromTemplate
      const flags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
      win.webContents.emit('context-menu', {}, { isEditable: true, selectionText: '', linkURL: '', editFlags: flags })
      Menu.buildFromTemplate = original
      return captured
    })
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
  })
})
