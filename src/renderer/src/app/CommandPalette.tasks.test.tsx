// @vitest-environment jsdom
// P4 / W4 (1.8.9): Ctrl+K encuentra las tareas de Overdrive (también las de «Chat sin carpeta») por su nombre.
import { createElement } from 'react'
import { mount as mountEl, typeInto, type Mounted } from '../../../test/dom-render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openIndexedChat = vi.hoisted(() => vi.fn())
vi.mock('../features/tasks/impl/chatIndexOpen', () => ({ openIndexedChat, deleteIndexedChat: vi.fn() }))
vi.mock('../features/search/search-service', async (orig) => ({
  ...(await orig<typeof import('../features/search/search-service')>()),
  ensureSearchIndex: vi.fn()
}))

import { useChatIndex } from '../features/tasks/impl/chatIndex'
import { useUi } from '../stores/ui'
import { CommandPalette } from './CommandPalette'

let m: Mounted | null = null
const input = (): HTMLInputElement => document.querySelector('input[role="combobox"]') as HTMLInputElement
const labels = (): string[] => Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent ?? '')

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  openIndexedChat.mockReset()
  useChatIndex.setState({
    entries: [
      { folder: '/Users/x/Lazunox/Chats/20261104-abc123', sessionId: 's1', title: 'Ordena mis apuntes de la semana', updatedAt: 2000 },
      { folder: '/Users/x/proyectos/web', sessionId: 's2', title: 'Arregla el formulario', updatedAt: 1000 }
    ]
  })
  useUi.setState({ paletteOpen: true })
})
afterEach(() => {
  m?.unmount()
  m = null
  useUi.setState({ paletteOpen: false, mode: 'chat' })
  useChatIndex.setState({ entries: [] })
})

describe('paleta: tareas de Overdrive', () => {
  it('encuentra una tarea de «Chat sin carpeta» por su nombre y la abre conectando su carpeta', () => {
    m = mountEl(createElement(CommandPalette))
    typeInto(input(), 'apuntes')
    const opt = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) =>
      o.textContent?.includes('Ordena mis apuntes')
    )
    expect(opt).toBeTruthy()
    expect(labels().join('|')).not.toContain('Arregla el formulario')
    opt!.click()
    expect(useUi.getState().mode).toBe('tasks')
    expect(openIndexedChat).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }))
  })
  it('también las de una carpeta del usuario', () => {
    m = mountEl(createElement(CommandPalette))
    typeInto(input(), 'formulario')
    expect(labels().join('|')).toContain('Arregla el formulario')
  })
})
