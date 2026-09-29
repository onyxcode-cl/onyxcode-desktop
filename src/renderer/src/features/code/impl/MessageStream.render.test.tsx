import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageStream } from './MessageStream'
import { allEntries, assistantFull, userWithFile } from '../../../../../test/fixtures/entries'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const base = { busy: false, error: null, root: '/proj', permissions: [], questions: [], onUnrevert: () => undefined, loading: false }

describe('MessageStream (render estático)', () => {
  it('conversación completa', () => {
    expect(renderToStaticMarkup(<MessageStream {...base} entries={allEntries} />)).toMatchSnapshot()
  })
  it('ocupado, con error de sesión', () => {
    expect(renderToStaticMarkup(<MessageStream {...base} busy error="Se cayó" entries={[userWithFile, assistantFull]} />)).toMatchSnapshot()
  })
  it('sin mensajes y cargando', () => {
    expect(renderToStaticMarkup(<MessageStream {...base} loading entries={[]} />)).toMatchSnapshot()
  })
  it('sesión revertida desde un mensaje oculta ese y los siguientes', () => {
    const html = renderToStaticMarkup(<MessageStream {...base} revertMessageID="msg_002" entries={[userWithFile, assistantFull]} />)
    expect(html).toMatchSnapshot()
  })
})
