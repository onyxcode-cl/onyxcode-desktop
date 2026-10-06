/** Un elemento del navegador en el compositor de Code se convierte, al enviar, en un texto sintético y (si se pide) la captura. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated } from '../../../../../test/fixtures/events'
import { pickedElement, TINY_JPEG } from '../../../../../test/fixtures/element'
import { makeElementAttachment, ELEMENT_TEXT_MAX } from '../../browser/element-context'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'

type Sent = { type: string; text?: string; synthetic?: boolean; metadata?: unknown; mime?: string; filename?: string; url?: string }
function install(): ReturnType<typeof vi.fn> {
  const p = vi.fn(() => Promise.resolve({ data: {} }))
  useServer.setState({
    client: {
      session: {
        update: (a: { sessionID: string; permission?: unknown }) =>
          Promise.resolve({ data: { id: a.sessionID, permission: a.permission } }),
        promptAsync: p,
        abort: () => Promise.resolve({ data: true })
      }
    } as never
  })
  return p
}
const partsOf = (p: ReturnType<typeof vi.fn>): Sent[] => (p.mock.calls[0]![0] as { parts: Sent[] }).parts

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
  useCode.getState().applyEvent(sessionCreated(makeSession('s1', D)).event, D)
  useCode.setState({ activeSessionID: 's1' })
})

describe('doSend con elemento del navegador', () => {
  it('texto del usuario, texto sintético que empieza por el marcador y la captura data: con la casilla marcada', async () => {
    const p = install()
    await useCode.getState().send('haz que este botón sea azul', [], [makeElementAttachment(pickedElement())])
    const parts = partsOf(p)
    expect(parts.map((x) => x.type)).toEqual(['text', 'text', 'file'])
    expect(parts[0]).toEqual({ type: 'text', text: 'haz que este botón sea azul' })
    expect(parts[1]!.synthetic).toBe(true)
    expect(parts[1]!.metadata).toEqual({ kind: 'browser_element', v: 2 })
    expect(parts[1]!.text!.startsWith('[Elemento de la página]')).toBe(true)
    expect(parts[1]!.text!.length).toBeLessThanOrEqual(ELEMENT_TEXT_MAX)
    expect(parts[2]).toEqual({ type: 'file', mime: 'image/jpeg', filename: 'elemento.jpg', url: TINY_JPEG })
  })
  it('sin la casilla de captura no sale ninguna parte file; sin la de errores el texto no los lleva', async () => {
    const p = install()
    const att = { ...makeElementAttachment(pickedElement()), include: { image: false, diagnostics: false } }
    await useCode.getState().send('hola', [], [att])
    const parts = partsOf(p)
    expect(parts.map((x) => x.type)).toEqual(['text', 'text'])
    expect(parts[1]!.text).not.toContain('boom')
  })
  it('un elemento sensible nunca manda captura, aunque la casilla esté marcada', async () => {
    const p = install()
    const att = {
      ...makeElementAttachment(pickedElement({ flags: { sensitive: true, truncated: false } })),
      include: { image: true, diagnostics: true }
    }
    await useCode.getState().send('hola', [], [att])
    expect(partsOf(p).some((x) => x.type === 'file')).toBe(false)
  })
  it('el elemento solo es un mensaje válido y convive con los demás adjuntos', async () => {
    const p = install()
    const img = { id: 'a1', name: 'captura.png', mime: 'image/png', url: 'data:image/png;base64,AAAA' }
    expect(await useCode.getState().send('  ', [], [makeElementAttachment(pickedElement({ image: undefined })), img])).toBe(true)
    const parts = partsOf(p)
    expect(parts.map((x) => x.type)).toEqual(['text', 'file'])
    expect(parts[1]!.filename).toBe('captura.png')
  })
  it('en el celular el bloque sale sin synthetic ni metadata (su política solo admite {type,text})', async () => {
    const g = globalThis as { window?: unknown }
    const before = g.window
    g.window = { ...(before as object | undefined), api: { platform: 'remote' } }
    const p = install()
    try {
      await useCode.getState().send('hola', [], [makeElementAttachment(pickedElement())])
    } finally {
      if (before === undefined) delete g.window
      else g.window = before
    }
    const el = partsOf(p)[1]!
    expect(Object.keys(el).sort()).toEqual(['text', 'type'])
    expect(el.text!.startsWith('[Elemento de la página]')).toBe(true)
  })
})
