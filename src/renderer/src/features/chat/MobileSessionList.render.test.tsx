import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { ChatSessionList } from './ChatSessionList'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
const mk = (id: string, title: string, at: number): Session => ({ id, title, time: { created: at, updated: at } }) as unknown as Session
const base = { activeId: null, onSelect: () => undefined, onRename: () => undefined, onDelete: () => undefined }

beforeEach(() => {
  g.window = { api: { platform: 'remote' } }
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
})
afterEach(() => {
  delete g.window
  vi.useRealTimers()
})

describe('lista de conversaciones del celular', () => {
  it('búsqueda siempre visible (aunque haya pocas), filas de 56 px y cabeceras de grupo fijas', () => {
    const now = Date.now()
    const html = renderToStaticMarkup(
      createElement(ChatSessionList, { ...base, sessions: [mk('a', 'Hoy', now), mk('b', 'Ayer', now - 86_400_000)] })
    )
    expect(html).toContain('type="button"')
    expect(html).toContain('<input')
    expect(html).toContain('sticky top-0')
    expect(html).toContain('sticky top-[60px]')
    expect(html).toContain('min-h-[var(--m-row)]')
    expect(html).toContain('>Hoy<')
    expect(html).toContain('>Ayer<')
    expect(html).toContain('data-m="swipe-row"')
  })

  it('cada fila conserva el botón «Opciones» accesible (el gesto es solo un atajo)', () => {
    const html = renderToStaticMarkup(createElement(ChatSessionList, { ...base, sessions: [mk('a', 'Hoy', Date.now())] }))
    expect(html).toContain('aria-label="Opciones"')
  })

  it('las acciones del deslizamiento están ocultas (inert) hasta abrirlas', () => {
    const html = renderToStaticMarkup(createElement(ChatSessionList, { ...base, sessions: [mk('a', 'Hoy', Date.now())] }))
    expect(html).toContain('inert')
    expect(html).toContain('Renombrar')
    expect(html).toContain('Eliminar')
  })

  it('vacío: icono, título, texto y botón «Nuevo»', () => {
    const html = renderToStaticMarkup(createElement(ChatSessionList, { ...base, sessions: [], emptyText: 'Aún no hay conversaciones' }))
    expect(html).toContain('data-m="empty-state"')
    expect(html).toContain('Aún no hay conversaciones')
    expect(html).toContain('lucide-square-pen')
    expect(html).toContain('Nuevo')
  })

  it('cargando: esqueleto de filas de 56 px', () => {
    const html = renderToStaticMarkup(createElement(ChatSessionList, { ...base, sessions: [], loading: true }))
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('h-[var(--m-row)]')
  })
})
