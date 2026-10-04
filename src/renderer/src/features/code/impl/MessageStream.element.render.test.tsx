import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageStream } from './MessageStream'
import { ChatMessageList } from '../../chat/ChatMessageList'
import { assistantFull } from '../../../../../test/fixtures/entries'
import { assistantMessage, textPart, userMessage } from '../../../../../test/fixtures/events'
import { pickedElement } from '../../../../../test/fixtures/element'
import { formatElementContext } from '../../browser/element-context'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const S = 'ses_el'
const base = { busy: false, error: null, root: '/proj', permissions: [], questions: [], onUnrevert: () => undefined, loading: false }
const block = formatElementContext(pickedElement(), { image: false, diagnostics: true })

const withElement = {
  info: userMessage('msg_el', S),
  parts: [
    textPart('p1', 'msg_el', S, 'Haz que este botón sea azul'),
    textPart('p2', 'msg_el', S, block, { synthetic: true, metadata: { kind: 'browser_element', v: 2 } })
  ]
}
const onlyElement = { info: userMessage('msg_el2', S), parts: [textPart('p3', 'msg_el2', S, block, { synthetic: true })] }
const syntheticOther = {
  info: userMessage('msg_syn', S),
  parts: [textPart('p4', 'msg_syn', S, 'Hola'), textPart('p5', 'msg_syn', S, 'contexto interno del editor', { synthetic: true })]
}
const reply = { ...assistantFull, info: assistantMessage('msg_a', S) }

describe('Burbuja del usuario con un elemento del navegador', () => {
  it('Code: chip compacto y el texto del usuario; nunca el volcado', () => {
    const html = renderToStaticMarkup(<MessageStream {...base} entries={[withElement, reply]} />)
    expect(html).toContain('data-testid="user-elements"')
    expect(html).toContain('&lt;button&gt; [data-testid=&quot;buy&quot;]')
    expect(html).toContain('Haz que este botón sea azul')
    expect(html).not.toContain('[Elemento de la página]')
    expect(html).not.toContain('Estilos calculados')
    expect(html).not.toContain('boom')
  })
  it('Code: un mensaje con solo el elemento también se pinta', () => {
    expect(renderToStaticMarkup(<MessageStream {...base} entries={[onlyElement]} />)).toContain('data-testid="user-elements"')
  })
  it('Code: una parte sintética sin el marcador sigue oculta', () => {
    const html = renderToStaticMarkup(<MessageStream {...base} entries={[syntheticOther]} />)
    expect(html).not.toContain('contexto interno')
    expect(html).not.toContain('user-elements')
  })
  it('Code: si el motor no conservara synthetic, el marcador basta y tampoco se vuelca', () => {
    const plain = {
      info: userMessage('msg_p', S),
      parts: [textPart('p6', 'msg_p', S, 'Cambia el color'), textPart('p7', 'msg_p', S, block)]
    }
    const html = renderToStaticMarkup(<MessageStream {...base} entries={[plain]} />)
    expect(html).toContain('data-testid="user-elements"')
    expect(html).not.toContain('Estilos calculados')
  })
  it('Chat: el mismo chip y sin volcado', () => {
    const html = renderToStaticMarkup(<ChatMessageList entries={[withElement, reply]} busy={false} />)
    expect(html).toContain('&lt;button&gt; [data-testid=&quot;buy&quot;]')
    expect(html).toContain('Haz que este botón sea azul')
    expect(html).not.toContain('Estilos calculados')
  })
})
