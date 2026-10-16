// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { SidebarTree } from '../../components/SidebarTreeRoot'
import { ChatSessionList } from './ChatSessionList'
import { ChatSidebarRow } from './ChatSidebarRow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mk = (id: string, title: string, updated: number, archived?: number): Session =>
  ({ id, title, time: { created: 1, updated, ...(archived ? { archived } : {}) } }) as unknown as Session

let host: HTMLDivElement
let root: Root
const now = Date.now()
const live = [mk('a', 'Receta de pan', now), mk('b', 'Plan de viaje', now - 1000), mk('c', 'Ideas de regalo', now - 2000)]
const old = mk('z', 'Charla vieja', now - 5000, now - 100)
const noop = (): void => undefined

function render(extra: Record<string, unknown>): void {
  act(() => {
    root.render(
      createElement(
        SidebarTree,
        null,
        createElement(ChatSessionList, {
          sessions: live,
          activeId: null,
          onSelect: noop,
          onRename: noop,
          onDelete: noop,
          showTime: true,
          ...extra
        })
      )
    )
  })
}
const titles = (): string[] => Array.from(host.querySelectorAll('[role="treeitem"]')).map((e) => e.getAttribute('aria-label') ?? '')
const groupLabels = (): string[] => Array.from(host.querySelectorAll('[role="group"]')).map((e) => e.getAttribute('aria-label') ?? '')

beforeEach(() => {
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('ChatSessionList: fijadas', () => {
  it('las fijadas van primero en el grupo «Fijadas» y llevan ícono de pin', () => {
    render({ pinnedIds: new Set(['c']), onTogglePin: noop })
    expect(groupLabels()[0]).toBe('Fijadas')
    expect(titles()).toEqual(['Ideas de regalo', 'Receta de pan', 'Plan de viaje'])
    expect(host.querySelectorAll('svg[aria-label="Fijada"]')).toHaveLength(1)
  })

  it('sin fijadas no hay grupo «Fijadas»', () => {
    render({ pinnedIds: new Set<string>(), onTogglePin: noop })
    expect(groupLabels()).not.toContain('Fijadas')
  })
})

describe('ChatSessionList: archivadas', () => {
  it('la lista normal no muestra las archivadas; el botón lleva el contador', () => {
    render({ archived: [old], showArchived: false, onToggleArchived: noop, onRestore: noop })
    expect(titles()).not.toContain('Charla vieja')
    const btn = host.querySelector('button[aria-label="Ver las conversaciones archivadas"]')!
    expect(btn.textContent).toBe('1')
  })

  it('sin archivadas no aparece el botón', () => {
    render({ archived: [], showArchived: false, onToggleArchived: noop })
    expect(host.querySelector('button[aria-pressed]')).toBeNull()
  })

  it('la vista «Archivadas» solo muestra las archivadas, con «Restaurar» en cada fila', () => {
    const onRestore = vi.fn()
    const toggle = vi.fn()
    render({ archived: [old], showArchived: true, onToggleArchived: toggle, onRestore, pinnedIds: new Set(['a']) })
    expect(titles()).toEqual(['Charla vieja'])
    expect(groupLabels()).not.toContain('Fijadas')
    const restore = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Restaurar')!
    act(() => restore.click())
    expect(onRestore).toHaveBeenCalledWith('z')
    act(() => (host.querySelector('button[aria-label="Volver a las conversaciones"]') as HTMLButtonElement).click())
    expect(toggle).toHaveBeenCalled()
  })

  it('la vista vacía de archivadas lo dice', () => {
    render({ archived: [], showArchived: true, onToggleArchived: noop })
    expect(host.textContent).toContain('No hay conversaciones archivadas')
  })

  it('la fila archivada ofrece Restaurar y Eliminar en el menú (sin Fijar ni Archivar)', () => {
    act(() => {
      root.render(
        createElement(
          SidebarTree,
          null,
          createElement(ChatSidebarRow, {
            session: old,
            active: false,
            busy: false,
            archivedView: true,
            onSelect: noop,
            onRename: noop,
            onDelete: noop,
            onRestore: noop,
            onTogglePin: noop,
            onArchive: noop
          })
        )
      )
    })
    act(() => (host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement).click())
    const items = Array.from(document.body.querySelectorAll('[role="menu"] [role="menuitem"]')).map((i) => i.textContent)
    expect(items).toEqual(['Renombrar', 'Restaurar', 'Eliminar'])
  })
})
