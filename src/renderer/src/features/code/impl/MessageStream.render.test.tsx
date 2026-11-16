import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageStream } from './MessageStream'
import { allEntries, assistantFull, userWithFile } from '../../../../../test/fixtures/entries'
import { stripDesk } from '../../../../../test/strip-desk'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const base = { busy: false, error: null, root: '/proj', permissions: [], questions: [], onUnrevert: () => undefined, loading: false }

describe('MessageStream (render estático)', () => {
  it('conversación completa', () => {
    expect(stripDesk(renderToStaticMarkup(<MessageStream {...base} entries={allEntries} />))).toMatchSnapshot()
  })
  it('ocupado, con error de sesión', () => {
    expect(
      stripDesk(renderToStaticMarkup(<MessageStream {...base} busy error="Se cayó" entries={[userWithFile, assistantFull]} />))
    ).toMatchSnapshot()
  })
  it('sin mensajes y cargando', () => {
    expect(stripDesk(renderToStaticMarkup(<MessageStream {...base} loading entries={[]} />))).toMatchSnapshot()
  })
  it('sesión revertida desde un mensaje oculta ese y los siguientes', () => {
    const html = renderToStaticMarkup(<MessageStream {...base} revertMessageID="msg_002" entries={[userWithFile, assistantFull]} />)
    expect(stripDesk(html)).toMatchSnapshot()
  })
})

const QUOTA = {
  name: 'APIError' as const,
  data: {
    message: 'Provider allowance exhausted for this account',
    statusCode: 429,
    isRetryable: false,
    responseBody: '{"error":"usage_limit_reached"}'
  }
}

it.each(['session', 'assistant'])('cuota terminal (%s): detalle del proveedor visible una sola vez', (source) => {
  const entries = source === 'assistant' ? [{ ...assistantFull, info: { ...assistantFull.info, error: QUOTA } }] : [userWithFile]
  const html = renderToStaticMarkup(<MessageStream {...base} entries={entries} error={QUOTA} />)
  expect(html).toContain('role="alert"')
  expect(html).toMatch(/<details open=""/)
  expect(html).toContain(QUOTA.data.message)
  expect(html.match(/Provider allowance exhausted/g)).toHaveLength(1)
})
