// @vitest-environment jsdom
/**
 * MessageStream con compactaciones: la parte `compaction` se ve como tarjeta (no como un mensaje vacío) con el resumen plegado, y
 * «Compactar hasta aquí» solo aparece con el motor propio nuevo, en mensajes posteriores a la última compactación y sin el primero.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { assistantMessage, textPart, userMessage } from '../../../../../test/fixtures/events'
import { mount, type Mounted } from '../../../../../test/dom-render'
import { MessageStream } from './MessageStream'
import { useCode } from './store'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const S = 'ses_c'
const base = { busy: false, error: null, root: '/proj', permissions: [], questions: [], onUnrevert: () => undefined, loading: false }

const u = (id: string, text: string): { info: ReturnType<typeof userMessage>; parts: Part[] } => ({
  info: userMessage(id, S),
  parts: [textPart(`p_${id}`, id, S, text)]
})
const a = (id: string, text: string, summary = false): { info: ReturnType<typeof assistantMessage>; parts: Part[] } => ({
  info: assistantMessage(id, S, { time: { created: 1, completed: 2 }, ...(summary ? { summary: true } : {}) } as never),
  parts: [textPart(`p_${id}`, id, S, text)]
})
const compaction = (id: string, lazunox?: Record<string, unknown>): { info: ReturnType<typeof userMessage>; parts: Part[] } => ({
  info: userMessage(id, S),
  parts: [
    { id: `p_${id}`, sessionID: S, messageID: id, type: 'compaction', auto: false, ...(lazunox ? { lazunox } : {}) } as unknown as Part
  ]
})

const entries = [
  u('msg_01', 'Primero'),
  a('msg_02', 'R1'),
  u('msg_03', 'Segundo'),
  a('msg_04', 'R2'),
  compaction('msg_05', { mensajes: 4, tokensAntes: 90000, tokensDespues: 12000, reinyectado: ['plan:3'] }),
  a('msg_06', 'TEXTO-DEL-RESUMEN', true),
  u('msg_07', 'Tercero'),
  a('msg_08', 'R3')
]

// En jsdom no hay preload: el escritorio se simula con `window.api` mínimo (sin `code`, como un perfil sin acceso nativo).
;(window as unknown as { api: unknown }).api = { platform: 'darwin' }

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  useCode.setState({ rewindSupport: {}, runState: {} })
})
/** Pinta el stream en jsdom (el store se lee con suscripción real, a diferencia del render estático) y devuelve el HTML. */
function renderToStaticMarkup(el: React.ReactElement): string {
  m?.unmount()
  m = mount(el)
  return m.host.innerHTML
}

describe('MessageStream con compactaciones', () => {
  it('la compactación es una tarjeta con las cifras; el resumen queda plegado y las respuestas normales siguen', () => {
    const html = renderToStaticMarkup(<MessageStream {...base} entries={entries} />)
    expect(html).toContain('data-testid="compaction-card"')
    expect(html).toContain('Se resumieron 4 mensajes')
    expect(html).toContain('plan (3)')
    expect(html).toContain('Ver resumen')
    expect(html).not.toContain('TEXTO-DEL-RESUMEN')
    expect(html).toContain('R3')
  })

  it('con un motor sin métricas la tarjeta dice solo que se resumió', () => {
    const html = renderToStaticMarkup(
      <MessageStream {...base} entries={[u('msg_01', 'a'), compaction('msg_02'), a('msg_03', 'RES', true)]} />
    )
    expect(html).toContain('Se resumió la conversación')
    expect(html).not.toContain('≈')
  })

  it('compactación en curso: «Resumiendo…»', () => {
    const html = renderToStaticMarkup(<MessageStream {...base} busy entries={[u('msg_01', 'a'), compaction('msg_02')]} />)
    expect(html).toContain('Resumiendo la conversación')
  })

  it('«Compactar hasta aquí» no sale sin el motor nuevo', () => {
    expect(renderToStaticMarkup(<MessageStream {...base} entries={entries} />)).not.toContain('Compactar hasta aquí')
  })

  it('con el motor nuevo sale solo en los mensajes posteriores a la última compactación (y no en el primero)', () => {
    useCode.setState({ rewindSupport: { [S]: true } })
    const html = renderToStaticMarkup(<MessageStream {...base} entries={entries} />)
    // Solo «Tercero» (msg_07): «Primero» es el inicio, «Segundo» queda antes de la compactación.
    expect(html.match(/aria-label="Compactar hasta aquí"/g)?.length).toBe(1)
    const sin = renderToStaticMarkup(<MessageStream {...base} entries={entries.slice(0, 4)} />)
    expect(sin.match(/aria-label="Compactar hasta aquí"/g)?.length).toBe(1) // «Segundo»
  })

  it('ocupada: el botón está deshabilitado y dice por qué', () => {
    useCode.setState({ rewindSupport: { [S]: true }, runState: { [S]: 'busy' } })
    try {
      const html = renderToStaticMarkup(<MessageStream {...base} busy entries={entries.slice(0, 4)} />)
      expect(html).toContain('No se puede compactar mientras la conversación trabaja.')
      expect(html).toMatch(/<button[^>]*aria-label="Compactar hasta aquí\. No se puede[^>]*disabled/)
    } finally {
      useCode.setState({ runState: {} })
    }
  })
})
