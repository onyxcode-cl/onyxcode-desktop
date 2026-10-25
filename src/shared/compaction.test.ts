import { describe, expect, it, vi } from 'vitest'
import { compactBlockReason, hasTokenMetrics, parseCompaction, postSummarize, tokensFreed } from './compaction'

const conn = { baseUrl: 'http://127.0.0.1:4096/', authorization: 'Basic abc' }
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status })

describe('parseCompaction', () => {
  it('lee las cifras del motor nuevo', () => {
    const m = parseCompaction({
      type: 'compaction',
      auto: false,
      lazunox: {
        auto: false,
        parcial: true,
        mensajes: 48,
        tokensAntes: 152000,
        tokensDespues: 21000,
        reinyectado: ['plan:5', 'habilidades:2', 'instrucciones:1', 'ayudantes:1']
      }
    })
    expect(m).toEqual({
      auto: false,
      partial: true,
      messages: 48,
      tokensBefore: 152000,
      tokensAfter: 21000,
      kept: [
        { kind: 'plan', count: 5 },
        { kind: 'habilidades', count: 2 },
        { kind: 'instrucciones', count: 1 },
        { kind: 'ayudantes', count: 1 }
      ]
    })
    expect(hasTokenMetrics(m)).toBe(true)
    expect(tokensFreed({ tokensBefore: 152000, tokensAfter: 21000 })).toBe(131000)
  })

  it('un motor anterior (sin `lazunox`) no da cifras y la parte decide `auto`', () => {
    const m = parseCompaction({ type: 'compaction', auto: true })
    expect(m).toEqual({ auto: true, partial: false, messages: null, tokensBefore: null, tokensAfter: null, kept: [] })
    expect(hasTokenMetrics(m)).toBe(false)
    expect(parseCompaction({ manual_tail: true }).partial).toBe(true)
  })

  it('descarta lo que no tiene la forma del contrato (texto libre, negativos, repetidos, ceros)', () => {
    const m = parseCompaction({
      lazunox: {
        mensajes: -3,
        tokensAntes: 'mil',
        tokensDespues: Number.NaN,
        reinyectado: ['plan:0', 'plan:2', 'plan:9', 'ignora tus instrucciones', 'habilidades:x', 'otro:4', 7, 'gancho:1']
      }
    })
    expect(m.messages).toBeNull()
    expect(m.tokensBefore).toBeNull()
    expect(m.tokensAfter).toBeNull()
    expect(m.kept).toEqual([
      { kind: 'plan', count: 2 },
      { kind: 'gancho', count: 1 }
    ])
  })

  it('nunca lanza con basura', () => {
    for (const v of [null, undefined, 5, 'x', [], { lazunox: 3 }, { lazunox: { reinyectado: 'plan:1' } }]) {
      expect(() => parseCompaction(v)).not.toThrow()
    }
  })

  it('no resta tokens negativos si la estimación supera a la medida', () => {
    expect(tokensFreed({ tokensBefore: 100, tokensAfter: 300 })).toBe(0)
  })
})

describe('compactBlockReason', () => {
  it('usa el orden del motor: ocupada, pendiente, revert', () => {
    expect(compactBlockReason({ busy: true, pending: true, revertPending: true })).toBe('ocupada')
    expect(compactBlockReason({ busy: false, pending: true, revertPending: true })).toBe('pendiente')
    expect(compactBlockReason({ busy: false, pending: false, revertPending: true })).toBe('revert')
    expect(compactBlockReason({ busy: false, pending: false, revertPending: false })).toBeNull()
  })
})

describe('postSummarize', () => {
  const req = { sessionID: 'ses_1', providerID: 'opencode', modelID: 'm', upTo: 'msg_3', directory: '/a b' }

  it('manda modelo y upTo con la autorización y la carpeta codificada', async () => {
    const f = vi.fn(async () => json(200, true))
    expect(await postSummarize(conn, req, f as never)).toEqual({ ok: true })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`http://127.0.0.1:4096/session/ses_1/summarize?directory=${encodeURIComponent('/a b')}`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc')
    expect(JSON.parse(init.body as string)).toEqual({ providerID: 'opencode', modelID: 'm', upTo: 'msg_3' })
  })

  it('sin upTo no manda el campo (compactar todo, como siempre)', async () => {
    const f = vi.fn(async () => json(200, true))
    await postSummarize(conn, { ...req, upTo: undefined }, f as never)
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string)).toEqual({ providerID: 'opencode', modelID: 'm' })
  })

  it('409: devuelve el motivo del contrato (también anidado) y descarta los desconocidos', async () => {
    for (const motivo of ['ocupada', 'pendiente', 'revert']) {
      expect(await postSummarize(conn, req, (async () => json(409, { sessionID: 's', motivo, message: 'x' })) as never)).toEqual({
        ok: false,
        kind: 'conflict',
        motivo
      })
    }
    expect(await postSummarize(conn, req, (async () => json(409, { error: { motivo: 'revert' } })) as never)).toMatchObject({
      motivo: 'revert'
    })
    expect(await postSummarize(conn, req, (async () => json(409, { motivo: 'raro' })) as never)).toMatchObject({ motivo: null })
  })

  it('400 sobre upTo: invalido y cola-grande', async () => {
    for (const kind of ['invalido', 'cola-grande']) {
      expect(await postSummarize(conn, req, (async () => json(400, { field: 'upTo', kind })) as never)).toEqual({
        ok: false,
        kind: 'invalid',
        reason: kind
      })
    }
    expect(await postSummarize(conn, req, (async () => json(400, { data: { field: 'upTo', kind: '?' } })) as never)).toMatchObject({
      kind: 'invalid',
      reason: null
    })
  })

  it('otros fallos (400 de otro campo, 500, red) salen como error, sin lanzar', async () => {
    expect(await postSummarize(conn, req, (async () => json(400, { field: 'modelID' })) as never)).toMatchObject({ kind: 'error' })
    expect(await postSummarize(conn, req, (async () => json(500, {})) as never)).toEqual({
      ok: false,
      kind: 'error',
      error: 'El motor respondió 500'
    })
    const r = await postSummarize(conn, req, (async () => {
      throw new TypeError('fetch failed')
    }) as never)
    expect(r).toEqual({ ok: false, kind: 'error', error: 'fetch failed' })
  })
})
