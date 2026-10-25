import { describe, expect, it, vi } from 'vitest'
import { Engine1Adapter, normalizeEvent } from './engine1'
import { Engine2Adapter } from './engine2'

const g = (type: string, properties: unknown): never => ({ directory: '/work/p', payload: { id: 'e1', type, properties } }) as never

const props = {
  id: 'eli_1',
  sessionID: 'ses_1',
  server: 'crm',
  callID: 'call_1',
  message: 'Dato',
  fields: [{ name: 'a', type: 'string', required: true, maxLength: 10 }],
  expiresAt: 1_900_000_000_000
}

describe('adaptador del motor: eventos mcp.elicitation.*', () => {
  it('asked -> evento propio con la solicitud saneada y la carpeta', () => {
    const ev = normalizeEvent(g('mcp.elicitation.asked', props))
    expect(ev).toMatchObject({
      directory: '/work/p',
      type: 'mcp.elicitation.asked',
      request: { id: 'eli_1', server: 'crm', callID: 'call_1' }
    })
  })
  it('replied y rejected conservan id, sesión y motivo/acción', () => {
    expect(normalizeEvent(g('mcp.elicitation.replied', { id: 'eli_1', sessionID: 's', action: 'decline' }))).toEqual({
      directory: '/work/p',
      type: 'mcp.elicitation.replied',
      id: 'eli_1',
      sessionID: 's',
      action: 'decline'
    })
    // `rejected` puede llegar SIN `asked` previo (secreto, esquema, ambiguo): se entrega igual.
    expect(normalizeEvent(g('mcp.elicitation.rejected', { id: 'eli_9', sessionID: 's', reason: 'secret' }))).toEqual({
      directory: '/work/p',
      type: 'mcp.elicitation.rejected',
      id: 'eli_9',
      sessionID: 's',
      reason: 'secret'
    })
  })
  it('un evento mal formado no se pierde: llega como unknown', () => {
    for (const [t, p] of [
      ['mcp.elicitation.asked', { id: 'x' }],
      ['mcp.elicitation.replied', { id: 'x', sessionID: 's', action: 'otra' }],
      ['mcp.elicitation.rejected', { id: 'x', sessionID: 's', reason: 'rara' }],
      ['mcp.elicitation.nueva', {}]
    ] as const)
      expect(normalizeEvent(g(t, p))).toMatchObject({ type: 'unknown', rawType: t })
  })
  it('los demás eventos de mcp siguen igual (unknown) y los de siempre no cambian', () => {
    expect(normalizeEvent(g('mcp.tools.changed', { server: 'x' }))).toMatchObject({ type: 'unknown', rawType: 'mcp.tools.changed' })
    expect(normalizeEvent(g('session.idle', { sessionID: 's' }))).toEqual({ directory: '/work/p', type: 'session.idle', sessionID: 's' })
  })
})

describe('adaptador del motor: rutas de formularios (fetch crudo, sin SDK)', () => {
  const mk = (fetchImpl: typeof fetch): Engine1Adapter =>
    new Engine1Adapter({ baseUrl: 'http://127.0.0.1:4999', authorization: 'Basic abc', directory: '/work/p', fetch: fetchImpl })

  it('list usa la carpeta de la conexión y la autorización; devuelve [] si el motor no tiene la ruta', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([props]), { status: 200 }))
    const list = await mk(f as never).elicitations.list()
    expect(list.map((e) => e.id)).toEqual(['eli_1'])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/mcp/elicitation?directory=%2Fwork%2Fp')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc')
    expect(await mk((async () => new Response('', { status: 404 })) as never).elicitations.list()).toEqual([])
  })

  it('reply manda la acción y el contenido por la ruta exacta y devuelve el resultado tipado', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ errors: [{ campo: 'a', motivo: 'mal' }] }), { status: 400 }))
    const r = await mk(f as never).elicitations.reply('eli_1', 'accept', { a: 'x' })
    expect(r).toEqual({ ok: false, invalid: [{ campo: 'a', motivo: 'mal' }] })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/mcp/elicitation/eli_1/reply?directory=%2Fwork%2Fp')
    expect(JSON.parse(init.body as string)).toEqual({ action: 'accept', content: { a: 'x' } })
  })

  it('el motor 2 aún no los tiene: lista vacía y responder falla como «no soportado»', async () => {
    const e2 = new Engine2Adapter()
    expect(await e2.elicitations.list()).toEqual([])
    await expect(e2.elicitations.reply('e', 'cancel')).rejects.toMatchObject({ kind: 'unsupported' })
  })
})
