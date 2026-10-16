import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { stripDesk } from '../../../../test/strip-desk'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { ChatHomeBlocks } from './ChatHomeBlocks'
import { CHAT_HOME_RECENT_MAX, CHAT_HOME_WORKING_MAX, pickChatHome } from './chat-home'
import { HomeIdeas } from '../../components/HomeBlocks'

const NOW = Date.now()
const chat = (id: string, title: string, minAgo: number, extra: Record<string, unknown> = {}): Session =>
  ({ id, title, directory: '/c', time: { created: 0, updated: NOW - minAgo * 60_000, ...extra }, ...extra }) as unknown as Session
const none = new Set<string>()

describe('pickChatHome', () => {
  it('sin conversaciones todo sale vacío (primera vez)', () => {
    expect(pickChatHome([], none)).toEqual({ working: [], recent: [], hasChats: false })
  })

  it('separa la que responde ahora de las recientes, sin repetir ninguna', () => {
    const h = pickChatHome([chat('a', 'A', 5), chat('b', 'B', 1), chat('c', 'C', 3)], new Set(['a']))
    expect(h.working.map((i) => i.session.id)).toEqual(['a'])
    expect(h.recent.map((i) => i.session.id)).toEqual(['b', 'c'])
    expect(h.hasChats).toBe(true)
  })

  it('topes: 3 respondiendo y 5 recientes, por fecha', () => {
    const all = [
      ...Array.from({ length: 5 }, (_, i) => chat(`w${i}`, `W${i}`, i + 1)),
      ...Array.from({ length: 9 }, (_, i) => chat(`r${i}`, `R${i}`, 10 + i))
    ]
    const h = pickChatHome(all, new Set(['w0', 'w1', 'w2', 'w3', 'w4']))
    expect(h.working.map((i) => i.session.id)).toEqual(['w0', 'w1', 'w2'])
    expect(h.working.length).toBe(CHAT_HOME_WORKING_MAX)
    expect(h.recent.length).toBe(CHAT_HOME_RECENT_MAX)
    expect(h.recent.map((i) => i.session.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })

  it('ignora archivadas, subsesiones e ids repetidos', () => {
    const h = pickChatHome(
      [chat('a', 'A', 1), chat('a', 'A otra vez', 2), chat('x', 'Archivada', 3, { archived: 1 }), chat('s', 'Sub', 4, { parentID: 'a' })],
      none
    )
    expect(h.recent.map((i) => i.session.id)).toEqual(['a'])
  })
})

describe('bloques del inicio de Chat', () => {
  it('respondiendo ahora: título, «Trabajando» y botón «Abrir»', () => {
    const h = pickChatHome([chat('a', 'Plan de mudanza', 1)], new Set(['a']))
    const html = stripDesk(renderToStaticMarkup(<ChatHomeBlocks home={h} part="working" />))
    expect(html).toContain('Respondiendo ahora')
    expect(html).toContain('Plan de mudanza')
    expect(html).toContain('Trabajando')
    expect(html).toContain('data-state="working"')
    expect(html).toMatch(/aria-label="Abrir la conversación «Plan de mudanza»"/)
  })

  it('retomar: dos líneas por conversación («Terminado · hace X»)', () => {
    const h = pickChatHome([chat('a', 'Carta al banco', 12), chat('b', '', 3)], none)
    const html = stripDesk(renderToStaticMarkup(<ChatHomeBlocks home={h} part="resume" />))
    expect(html).toContain('Retomar')
    expect(html).toContain('Carta al banco')
    expect(html).toContain('Terminado · hace 12 min')
    expect(html).toContain('Sin título')
    expect(html).toContain('<button')
  })

  it('sin datos no pinta nada', () => {
    const h = pickChatHome([], none)
    expect(renderToStaticMarkup(<ChatHomeBlocks home={h} part="resume" />)).toBe('')
    expect(renderToStaticMarkup(<ChatHomeBlocks home={h} part="working" />)).toBe('')
  })

  it('ideas: la primera vez salen abiertas y sin botón; con conversaciones salen plegadas tras «Mostrar ideas»', () => {
    const props = { storageKey: 'k', label: 'Ideas', showLabel: 'Mostrar ideas', hideLabel: 'Ocultar ideas' }
    const first = renderToStaticMarkup(
      <HomeIdeas {...props} secondary={false}>
        <p>tarjetas</p>
      </HomeIdeas>
    )
    expect(first).toBe('<p>tarjetas</p>')
    const later = renderToStaticMarkup(
      <HomeIdeas {...props} secondary>
        <p>tarjetas</p>
      </HomeIdeas>
    )
    expect(later).toContain('Mostrar ideas')
    expect(later).not.toContain('tarjetas')
  })
})
