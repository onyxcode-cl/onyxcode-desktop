/**
 * Menú de clic derecho de la interfaz propia (ventana principal y Quick Entry): Deshacer/Rehacer, Cortar, Copiar, Pegar y Seleccionar todo en
 * los campos de texto, y Copiar sobre texto seleccionado o enlaces. Electron no trae ningún menú contextual por defecto, así que sin esto
 * el botón derecho no hacía nada. Solo acciones de edición del portapapeles: nada de «Inspeccionar» ni de navegar.
 */
import { clipboard, Menu, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { t } from '@shared/i18n'

export interface EditMenuInput {
  isEditable: boolean
  selectionText: string
  linkURL: string
  editFlags: Pick<ContextMenuParams['editFlags'], 'canUndo' | 'canRedo' | 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll'>
}

/** Plantilla del menú según dónde se hizo clic (vacía si no hay nada útil que ofrecer). Pura: se prueba sin Electron. */
export function editMenuTemplate(p: EditMenuInput, copyLink: (url: string) => void): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (p.isEditable) {
    items.push(
      { role: 'undo', label: t('main.menu.undo'), enabled: p.editFlags.canUndo },
      { role: 'redo', label: t('main.menu.redo'), enabled: p.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: t('main.menu.cut'), enabled: p.editFlags.canCut },
      { role: 'copy', label: t('main.menu.copy'), enabled: p.editFlags.canCopy },
      { role: 'paste', label: t('main.menu.paste'), enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: t('main.menu.selectAll'), enabled: p.editFlags.canSelectAll }
    )
  } else {
    if (p.selectionText) items.push({ role: 'copy', label: t('main.menu.copy') })
    if (p.linkURL) items.push({ label: t('merr.menu.copyLink'), click: () => copyLink(p.linkURL) })
    if (p.selectionText) items.push({ type: 'separator' }, { role: 'selectAll', label: t('main.menu.selectAll') })
  }
  return items
}

/** Engancha el menú al `webContents` (idempotente por contenido: llamar una vez por ventana). */
export function installEditContextMenu(wc: WebContents): void {
  wc.on('context-menu', (_event, params) => {
    const items = editMenuTemplate(params, (url) => clipboard.writeText(url))
    if (items.length > 0) Menu.buildFromTemplate(items).popup()
  })
}
