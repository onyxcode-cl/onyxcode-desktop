// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { SidebarTree } from '../../components/SidebarTreeRoot'

const confirmDialog = vi.fn()
vi.mock('../../components/ConfirmDialog', () => ({ confirmDialog: (o: unknown) => confirmDialog(o) }))

import { ChatSidebarRow } from './ChatSidebarRow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const onDelete = vi.fn()
const onTogglePin = vi.fn()
const onArchive = vi.fn()

beforeEach(() => {
  vi.unstubAllGlobals()
  confirmDialog.mockReset()
  onDelete.mockReset()
  onTogglePin.mockReset()
  onArchive.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const session = { id: 's1', title: 'Plan de viaje', time: { created: 1, updated: Date.now() } } as unknown as Session
  act(() => {
    root.render(
      createElement(
        SidebarTree,
        null,
        createElement(ChatSidebarRow, {
          session,
          active: false,
          busy: false,
          onSelect: () => undefined,
          onRename: () => undefined,
          onDelete,
          onTogglePin,
          onArchive
        })
      )
    )
  })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const more = (): HTMLButtonElement => host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
const menu = (): HTMLElement | null => document.body.querySelector('[role="menu"]')

describe('ChatSidebarRow: menú «⋯»', () => {
  it('sale en un portal de posición fija en <body> (no dentro de la lista), con Fijar, Renombrar, Archivar, separador y Eliminar en rojo', () => {
    expect(menu()).toBeNull()
    act(() => more().click())
    const m = menu()!
    expect(m).not.toBeNull()
    expect(host.contains(m)).toBe(false)
    expect(m.parentElement).toBe(document.body)
    expect(m.className).toContain('fixed')
    expect(more().getAttribute('aria-expanded')).toBe('true')
    const items = Array.from(m.querySelectorAll('[role="menuitem"]'))
    expect(items.map((i) => i.textContent)).toEqual(['Fijar', 'Renombrar', 'Archivar', 'Eliminar'])
    expect(m.querySelectorAll('[role="separator"]')).toHaveLength(1)
    expect(items[3]!.className).toContain('text-danger')
  })

  it('«Fijar» y «Archivar» avisan y cierran el menú', () => {
    const click = (label: string): void => {
      act(() => more().click())
      const b = Array.from(menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((x) => x.textContent === label)!
      act(() => b.click())
    }
    click('Fijar')
    expect(onTogglePin).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
    click('Archivar')
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })

  it('Esc lo cierra y devuelve el foco a «⋯»; pulsar fuera también', () => {
    act(() => more().click())
    act(() => {
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(more())
    act(() => more().click())
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu()).toBeNull()
  })

  it('«Eliminar» (papelera y menú) pregunta antes y solo borra si se confirma', async () => {
    confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const trash = host.querySelector('button[aria-label="Eliminar"]') as HTMLButtonElement
    await act(async () => trash.click())
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
    act(() => more().click())
    const del = Array.from(menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === 'Eliminar')!
    await act(async () => del.click())
    expect(confirmDialog).toHaveBeenCalledTimes(2)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })
})
