import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ clipboard: { writeText: vi.fn() }, Menu: { buildFromTemplate: vi.fn() } }))

import { editMenuTemplate, type EditMenuInput } from './edit-context-menu'

const FLAGS = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
const base = (o: Partial<EditMenuInput>): EditMenuInput => ({ isEditable: false, selectionText: '', linkURL: '', editFlags: FLAGS, ...o })
const roles = (items: Electron.MenuItemConstructorOptions[]): string[] =>
  items.filter((i) => i.type !== 'separator').map((i) => String(i.role ?? i.label))

describe('editMenuTemplate', () => {
  it('campo de texto: deshacer, rehacer, cortar, copiar, pegar y seleccionar todo (con sus estados)', () => {
    const items = editMenuTemplate(base({ isEditable: true }), vi.fn())
    expect(roles(items)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
    expect(items.find((i) => i.role === 'redo')?.enabled).toBe(false)
    expect(items.find((i) => i.role === 'paste')?.enabled).toBe(true)
  })
  it('texto seleccionado fuera de un campo: copiar y seleccionar todo', () => {
    expect(roles(editMenuTemplate(base({ selectionText: 'hola' }), vi.fn()))).toEqual(['copy', 'selectAll'])
  })
  it('enlace: copiar enlace escribe la URL en el portapapeles', () => {
    const copy = vi.fn()
    const items = editMenuTemplate(base({ linkURL: 'https://getartcraft.com/' }), copy)
    expect(items).toHaveLength(1)
    ;(items[0].click as () => void)()
    expect(copy).toHaveBeenCalledWith('https://getartcraft.com/')
  })
  it('sin nada útil no hay menú', () => {
    expect(editMenuTemplate(base({}), vi.fn())).toEqual([])
  })
})
