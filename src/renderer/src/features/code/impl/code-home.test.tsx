import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { stripDesk } from '../../../../../test/strip-desk'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { CodeHomeBlocks } from './CodeHomeBlocks'
import { CODE_HOME_RECENT_MAX, CODE_HOME_WAITING_MAX, pickCodeHome, waitingRoots } from './code-home'
import type { SessionState } from '../../../components/SidebarTree'

const NOW = Date.now()
const ses = (id: string, title: string, minAgo: number, extra: Record<string, unknown> = {}): Session =>
  ({ id, title, directory: '/p', time: { created: 0, updated: NOW - minAgo * 60_000, ...extra }, ...extra }) as unknown as Session
const states = (m: Record<string, SessionState>) => (s: Session) => m[s.id] ?? null

describe('pickCodeHome', () => {
  it('sin sesiones todo sale vacío (primera vez)', () => {
    expect(pickCodeHome([], states({}))).toEqual({ waiting: [], waitingTotal: 0, recent: [], hasSessions: false })
  })

  it('separa las que esperan de las recientes sin repetir', () => {
    const h = pickCodeHome([ses('a', 'A', 5), ses('b', 'B', 1), ses('c', 'C', 3)], states({ a: 'waiting', c: 'working' }))
    expect(h.waiting.map((i) => i.session.id)).toEqual(['a'])
    expect(h.recent.map((i) => i.session.id)).toEqual(['b', 'c'])
    expect(h.hasSessions).toBe(true)
  })

  it('topes: 3 esperando (con el total) y 5 recientes', () => {
    const all = [
      ...Array.from({ length: 5 }, (_, i) => ses(`w${i}`, `W${i}`, i + 1)),
      ...Array.from({ length: 8 }, (_, i) => ses(`r${i}`, `R${i}`, 20 + i))
    ]
    const h = pickCodeHome(all, (s) => (s.id.startsWith('w') ? 'waiting' : null))
    expect(h.waiting.length).toBe(CODE_HOME_WAITING_MAX)
    expect(h.waitingTotal).toBe(5)
    expect(h.recent.length).toBe(CODE_HOME_RECENT_MAX)
    expect(h.recent.map((i) => i.session.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('ignora archivadas, subsesiones e ids repetidos', () => {
    const h = pickCodeHome(
      [ses('a', 'A', 1), ses('a', 'A2', 2), ses('x', 'X', 3, { archived: 1 }), ses('s', 'S', 4, { parentID: 'a' })],
      states({})
    )
    expect(h.recent.map((i) => i.session.id)).toEqual(['a'])
  })
})

describe('pickCodeHome con la sesión abierta', () => {
  it('la sesión vacía que ya está en pantalla no se ofrece retomar y, si es la única, cuenta como primera vez', () => {
    const only = pickCodeHome([ses('n', 'Nueva', 0)], states({}), 'n')
    expect(only).toEqual({ waiting: [], waitingTotal: 0, recent: [], hasSessions: false })
    const more = pickCodeHome([ses('n', 'Nueva', 0), ses('a', 'A', 5)], states({}), 'n')
    expect(more.recent.map((i) => i.session.id)).toEqual(['a'])
    expect(more.hasSessions).toBe(true)
  })
})

describe('waitingRoots', () => {
  it('un permiso o una pregunta de una subsesión bloquean a su sesión raíz', () => {
    const roots = waitingRoots({ p1: { sessionID: 'sub' } }, { q1: { sessionID: 'b' } }, (id) => (id === 'sub' ? 'a' : id))
    expect([...roots].sort()).toEqual(['a', 'b'])
  })
})

describe('bloques del inicio de Code', () => {
  it('esperando aprobación: tarjeta con estado y botón «Abrir», y el aviso de las que sobran', () => {
    const all = [1, 2, 3, 4].map((n) => ses(`w${n}`, `Tarea ${n}`, n))
    const h = pickCodeHome(all, () => 'waiting')
    const html = stripDesk(renderToStaticMarkup(<CodeHomeBlocks home={h} part="waiting" />))
    expect(html).toContain('Esperando tu aprobación')
    expect(html).toContain('Esperando tu aprobación o respuesta')
    expect(html).toContain('data-state="waiting"')
    expect(html).toMatch(/aria-label="Abrir la sesión «Tarea 1»"/)
    expect(html).toContain('y 1 más esperando')
  })

  it('retomar: estado y hora en la segunda línea según el estado de la barra', () => {
    const h = pickCodeHome(
      [ses('a', 'Migrar a Vite', 2), ses('b', 'Arreglar login', 30), ses('c', 'Docs', 90)],
      states({ a: 'working', b: 'review' })
    )
    const html = stripDesk(renderToStaticMarkup(<CodeHomeBlocks home={h} part="resume" />))
    expect(html).toContain('Retomar')
    expect(html).toContain('Trabajando')
    expect(html).toContain('Cambios por revisar · hace 30 min')
    expect(html).toContain('Terminado · hace 2 h')
  })

  it('sin datos no pinta nada', () => {
    const h = pickCodeHome([], states({}))
    expect(renderToStaticMarkup(<CodeHomeBlocks home={h} part="resume" />)).toBe('')
    expect(renderToStaticMarkup(<CodeHomeBlocks home={h} part="waiting" />)).toBe('')
  })
})
