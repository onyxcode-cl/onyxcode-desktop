// @vitest-environment jsdom
import { act, createElement } from 'react'
import { mount as mountEl, pressKey, typeInto, type Mounted } from '../../../test/dom-render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationEntry } from '../lib/conversation/entries'
import { buildSession } from '../features/search/search-index'

const openSearchHit = vi.hoisted(() => vi.fn())
vi.mock('../features/search/open-hit', () => ({ openSearchHit }))
vi.mock('../features/search/search-service', async (orig) => ({
  ...(await orig<typeof import('../features/search/search-service')>()),
  ensureSearchIndex: vi.fn()
}))

import { clearSearchIndex, indexForTests, useSearchStatus } from '../features/search/search-service'
import { useUi } from '../stores/ui'
import { CommandPalette } from './CommandPalette'

function entry(id: string, role: 'user' | 'assistant', text: string): ConversationEntry {
  return {
    info: { id, role, sessionID: 's', time: { created: Date.now() - 86_400_000 } },
    parts: [{ id: `p${id}`, type: 'text', text }]
  } as never
}

let m: Mounted | null = null

const input = (): HTMLInputElement => document.querySelector('input[role="combobox"]') as HTMLInputElement
function mount(): void {
  m = mountEl(createElement(CommandPalette))
}
const type = (text: string): void => typeInto(input(), text)
const key = (k: string): void => pressKey(input(), k)
const hits = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="search-hit"]'))
const statusText = (): string => document.querySelector('[data-testid="palette-search-status"]')?.textContent ?? ''

beforeEach(() => {
  vi.unstubAllGlobals()
  Element.prototype.scrollIntoView = vi.fn() // jsdom no lo trae
  clearSearchIndex()
  indexForTests().upsert(
    buildSession({ id: 'c1', mode: 'chat', directory: '/d', title: 'Receta de pan', updated: 3000 }, [
      entry('u1', 'user', 'Necesito una receta con masa madre'),
      entry('a1', 'assistant', 'La hidratación ideal es del 75% y el reposo en frío dura toda la noche.')
    ])
  )
  indexForTests().upsert(
    buildSession({ id: 'k1', mode: 'code', directory: '/p', title: 'Refactor', updated: 2000 }, [
      entry('u2', 'user', 'La hidratación del componente falla')
    ])
  )
  useSearchStatus.setState({ phase: 'ready', done: 2, total: 2, failed: 0 })
  useUi.setState({ paletteOpen: true })
  openSearchHit.mockReset()
})

afterEach(() => {
  m?.unmount()
  m = null
  useUi.setState({ paletteOpen: false })
  clearSearchIndex()
})

describe('paleta: búsqueda dentro de los mensajes', () => {
  it('con 1 letra no busca en los mensajes; con 2 o más sí, agrupado por conversación con el fragmento resaltado', () => {
    mount()
    type('h')
    expect(hits()).toHaveLength(0)
    type('hidratacion')
    expect(hits()).toHaveLength(2)
    const groups = Array.from(document.querySelectorAll('[role="group"]')).map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(['Receta de pan', 'Refactor'])
    expect(document.querySelector('mark')?.textContent).toBe('hidratación')
    expect(hits()[0].textContent).toContain('IA')
  })

  it('anuncia el número de resultados en una región aria-live', () => {
    mount()
    type('hidratacion')
    const live = document.querySelector('[data-testid="palette-search-status"]') as HTMLElement
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(statusText()).toBe('2 mensajes encontrados en 2 conversaciones')
  })

  it('flechas y Enter: marcan, abren la conversación elegida y cierran la paleta', () => {
    mount()
    type('hidratacion')
    expect(hits()[0].getAttribute('aria-selected')).toBe('true')
    expect(hits()[1].getAttribute('aria-selected')).toBe('false')
    // Sin comandos que coincidan, el primer resultado es el primer mensaje.
    expect(document.querySelector('input[role="combobox"]')?.getAttribute('aria-activedescendant')).toBe(hits()[0].id)
    key('ArrowDown')
    expect(hits()[1].getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('input[role="combobox"]')?.getAttribute('aria-activedescendant')).toBe(hits()[1].id)
    key('Enter')
    expect(openSearchHit).toHaveBeenCalledTimes(1)
    const [group, hit] = openSearchHit.mock.calls[0]
    expect(group.sessionId).toBe('k1')
    expect(group.mode).toBe('code')
    expect(hit.anchor).toBe('u2')
    expect(useUi.getState().paletteOpen).toBe(false)
  })

  it('clic en un resultado lo abre', () => {
    mount()
    type('masa madre')
    act(() => hits()[0].click())
    expect(openSearchHit.mock.calls[0][0].sessionId).toBe('c1')
    expect(openSearchHit.mock.calls[0][1].messageId).toBe('u1')
  })

  it('sin resultados muestra el aviso vacío; mientras prepara, el progreso; con fallo, el error', () => {
    mount()
    type('zzzqqq')
    expect(hits()).toHaveLength(0)
    expect(document.body.textContent).toContain('Sin resultados para «zzzqqq»')
    expect(statusText()).toBe('No hay mensajes con «zzzqqq»')

    act(() => useSearchStatus.setState({ phase: 'building', done: 40, total: 300 }))
    expect(statusText()).toContain('Preparando la búsqueda en tus mensajes… 40 de 300 conversaciones')
    expect(document.body.textContent).not.toContain('Sin resultados para')

    act(() => useSearchStatus.setState({ phase: 'error' }))
    expect(statusText()).toContain('No se pudo leer el historial')
  })

  it('«Borrar lo leído» vacía la búsqueda y lo avisa', () => {
    mount()
    type('hidratacion')
    expect(hits()).toHaveLength(2)
    act(() => (document.querySelector('[data-palette-clear]') as HTMLElement).click())
    expect(indexForTests().size).toBe(0)
    expect(hits()).toHaveLength(0)
    expect(statusText()).toBe('Listo: se borró el texto preparado para buscar.')
  })

  it('dice dónde busca y que todo se queda en el equipo', () => {
    mount()
    expect(document.body.textContent).toContain('Todo se queda en este equipo')
  })
})
