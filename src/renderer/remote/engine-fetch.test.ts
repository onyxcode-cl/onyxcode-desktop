import { describe, expect, it } from 'vitest'
import { MuxCallError } from '@shared/remote/mux'
import { RemoteLinkError, abortError, isAbortError } from '@shared/remote/link'
import { createEngineFetch, globalEvent, isEngineUrl, parseEngineUrl } from './engine-fetch'
import { EventsHub } from './events-hub'
import { FakeLink } from './fake-link'

const text = (c: string): string => `err:${c}`

function rig(): { link: FakeLink; hub: EventsHub; f: typeof fetch; fallback: string[] } {
  const link = new FakeLink()
  const hub = new EventsHub(link)
  const fallback: string[] = []
  const f = createEngineFetch({
    link,
    events: hub,
    text,
    fallback: (async (input: RequestInfo | URL) => {
      fallback.push(String(input))
      return new Response('externo')
    }) as typeof fetch
  })
  return { link, hub, f, fallback }
}

const ok = (body: unknown, extra: Record<string, unknown> = {}): { status: number; contentType: string; body: string } => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
  ...extra
})

describe('parseEngineUrl', () => {
  it('motor principal y de tarea, con ruta y query decodificada', () => {
    expect(parseEngineUrl('onyx://engine/main/session?directory=%2Ftmp%2Fa%20b&limit=5')).toEqual({
      eng: 'main',
      path: '/session',
      query: { directory: '/tmp/a b', limit: '5' }
    })
    expect(parseEngineUrl('onyx://engine/task/AbCdEfGh1234/global/event')).toEqual({
      eng: 'task/AbCdEfGh1234',
      path: '/global/event',
      query: {}
    })
    expect(parseEngineUrl('onyx://engine/main')).toEqual({ eng: 'main', path: '/', query: {} })
  })
  it('lo que no es del motor o es inválido da null', () => {
    expect(parseEngineUrl('https://example.com/x')).toBeNull()
    expect(parseEngineUrl('onyx://engine/otro/x')).toBeNull()
    expect(parseEngineUrl('onyx://engine/task/corto/x')).toBeNull()
    expect(isEngineUrl('onyx://engine/main/x')).toBe(true)
    expect(isEngineUrl(new URL('https://a.b/'))).toBe(false)
  })
})

describe('createEngineFetch: HTTP', () => {
  it('GET → trama http con eng, método, ruta, query y accept; la respuesta vuelve como Response normal', async () => {
    const { link, f } = rig()
    link.onHttp = async () => ok([{ id: 's1' }])
    const res = await f(
      new Request('onyx://engine/main/session?directory=%2Fp', { headers: { accept: 'application/json', authorization: '' } })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 's1' }])
    expect(link.https[0]?.req).toEqual({
      eng: 'main',
      method: 'GET',
      path: '/session',
      query: { directory: '/p' },
      headers: { accept: 'application/json' }
    })
  })

  it('POST con cuerpo JSON (Request y init): content-type conservado; authorization NO sale hacia el Mac', async () => {
    const { link, f } = rig()
    link.onHttp = async () => ok({ ok: true })
    const body = JSON.stringify({ parts: [{ type: 'text', text: 'hola' }], messageID: 'msg_1' })
    await f(
      new Request('onyx://engine/main/session/ses_1/prompt_async?directory=%2Fp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Basic eHg6eXk=' },
        body
      })
    )
    await f('onyx://engine/main/session', { method: 'POST', body: '{"a":1}' })
    const [a, b] = link.https
    expect(a?.req).toMatchObject({
      method: 'POST',
      path: '/session/ses_1/prompt_async',
      body,
      headers: { 'content-type': 'application/json' }
    })
    expect(JSON.stringify(a?.req)).not.toContain('Basic')
    expect(b?.req.headers).toEqual({ 'content-type': 'application/json' })
    expect(b?.req.body).toBe('{"a":1}')
  })

  it('204 sin cuerpo, estado de error del motor sin lanzar, y binario en base64', async () => {
    const { link, f } = rig()
    link.onHttp = async () => ({ status: 204, body: '' })
    const empty = await f('onyx://engine/main/x', { method: 'DELETE' })
    expect(empty.status).toBe(204)
    expect(await empty.text()).toBe('')
    link.onHttp = async () => ok({ name: 'NotFoundError' }, { status: 404 })
    const nf = await f('onyx://engine/main/session/zzz')
    expect(nf.status).toBe(404)
    expect(await nf.json()).toEqual({ name: 'NotFoundError' })
    const bytes = new Uint8Array([0, 255, 1, 128, 7])
    link.onHttp = async () => ({ status: 200, contentType: 'image/png', body: Buffer.from(bytes).toString('base64'), encoding: 'base64' })
    const img = await f('onyx://engine/main/file/content?path=a.png')
    expect(img.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(bytes)
  })

  it('respuesta con forma inválida del Mac → error tipado «failed», no un Response a medias', async () => {
    const { link, f } = rig()
    link.onHttp = async () => ({ nada: true })
    await expect(f('onyx://engine/main/x')).rejects.toMatchObject({ code: 'failed' })
    link.onHttp = async () => ({ status: 99, body: '' })
    await expect(f('onyx://engine/main/x')).rejects.toMatchObject({ code: 'failed' })
  })

  it('métodos no permitidos y URLs de motor mal formadas fallan sin tocar el puente', async () => {
    const { link, f } = rig()
    await expect(f('onyx://engine/main/x', { method: 'OPTIONS' })).rejects.toMatchObject({ code: 'unsupported' })
    await expect(f('onyx://engine/raro/x')).rejects.toMatchObject({ code: 'bad-request' })
    expect(link.https).toHaveLength(0)
  })

  it('lo que no es del motor se delega en el fetch original', async () => {
    const { f, fallback, link } = rig()
    const res = await f('https://example.com/x')
    expect(await res.text()).toBe('externo')
    expect(fallback).toEqual(['https://example.com/x'])
    expect(link.https).toHaveLength(0)
  })
})

describe('createEngineFetch: errores tipados y reintentos', () => {
  const cases: Array<[MuxCallError, string]> = [
    [new MuxCallError('disconnected'), 'disconnected'],
    [new MuxCallError('forbidden', 'locked'), 'locked'],
    [new MuxCallError('forbidden', 'out-of-scope'), 'forbidden'],
    [new MuxCallError('unavailable'), 'unavailable'],
    [new MuxCallError('busy'), 'busy']
  ]
  it.each(cases)('%s → RemoteLinkError(%s) con texto legible', async (e, code) => {
    const { link, f } = rig()
    link.onHttp = () => Promise.reject(e)
    const err = (await f('onyx://engine/main/x', { method: 'POST', body: '{}' }).catch((x: unknown) => x)) as RemoteLinkError
    expect(err).toBeInstanceOf(RemoteLinkError)
    expect(err.code).toBe(code)
    expect(err.message).toBe(`err:${code}`)
  })

  it('NUNCA reintenta: una mutación fallida se envía una sola vez', async () => {
    const { link, f } = rig()
    link.onHttp = () => Promise.reject(new MuxCallError('disconnected'))
    await expect(f('onyx://engine/main/session/s/prompt_async', { method: 'POST', body: '{"parts":[]}' })).rejects.toBeInstanceOf(
      RemoteLinkError
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(link.https).toHaveLength(1)
  })

  it('AbortSignal: ya abortado no llama; abortado en vuelo pasa la señal al multiplexor y rechaza con AbortError', async () => {
    const { link, f } = rig()
    const pre = new AbortController()
    pre.abort()
    const early = await f('onyx://engine/main/x', { signal: pre.signal }).catch((x: unknown) => x)
    expect(isAbortError(early)).toBe(true)
    expect(link.https).toHaveLength(0)
    const ac = new AbortController()
    link.onHttp = (_r, signal) =>
      new Promise((_res, rej) => {
        signal?.addEventListener('abort', () => rej(abortError()))
      })
    const p = f('onyx://engine/main/slow', { signal: ac.signal })
    await Promise.resolve()
    expect(link.https[0]?.signal).toBe(ac.signal)
    ac.abort()
    expect(isAbortError(await p.catch((x: unknown) => x))).toBe(true)
  })
})

describe('createEngineFetch: SSE sobre sub/ev', () => {
  async function readFrames(res: Response, n: number): Promise<string[]> {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    const out: string[] = []
    while (out.length < n) {
      const { done, value } = await reader.read()
      if (done) break
      buf += value
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        out.push(buf.slice(0, i))
        buf = buf.slice(i + 2)
      }
    }
    reader.releaseLock()
    return out
  }

  it('`GET /global/event` → Response text/event-stream: server.connected, luego cada ev como GlobalEvent con id=seq', async () => {
    const { link, f } = rig()
    const resP = f(new Request('onyx://engine/main/global/event', { headers: { accept: 'text/event-stream' } }))
    await Promise.resolve()
    link.live('main')!.h.onReady?.(10)
    const res = await resP
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(link.https).toHaveLength(0) // el SSE NO pasa por `http`
    const h = link.live('main')!.h
    h.onEvent({ seq: 11, ch: 'opencode:status', p: {} }) // IPC: no sale por el SSE
    h.onEvent({ seq: 12, oc: 'message.part.delta', p: { directory: '/p', id: 'e1', properties: { delta: 'hola' } } })
    h.onEvent({ seq: 13, oc: 'session.idle', p: { directory: 'global', properties: {} } })
    const frames = await readFrames(res, 3)
    expect(frames[0]).toBe('data: {"directory":"global","payload":{"type":"server.connected","properties":{}}}')
    expect(frames[1]).toBe(
      `id: 12\ndata: ${JSON.stringify({ directory: '/p', payload: { id: 'e1', type: 'message.part.delta', properties: { delta: 'hola' } } })}`
    )
    expect(frames[2]).toMatch(/^id: 13\ndata: .*"type":"session.idle"/)
  })

  it('`/event` (por motor de tarea) también va por sub, con el motor correcto', async () => {
    const { link, f } = rig()
    const resP = f('onyx://engine/task/AbCdEfGh1234/event')
    await Promise.resolve()
    expect(link.live('task/AbCdEfGh1234')).toBeDefined()
    link.live('task/AbCdEfGh1234')!.h.onReady?.(0)
    expect((await resP).status).toBe(200)
  })

  it('`reset` cierra el stream limpio (el cliente reabre y su onOpen resincroniza); cancelar el lector cancela la suscripción', async () => {
    const { link, f } = rig()
    let p = f('onyx://engine/main/global/event')
    await Promise.resolve()
    link.live('main')!.h.onReady?.(1)
    let res = await p
    const reader = res.body!.getReader()
    await reader.read() // server.connected
    link.live('main')!.h.onReset?.(7)
    expect((await reader.read()).done).toBe(true)
    p = f('onyx://engine/main/global/event')
    await Promise.resolve()
    link.live('main')!.h.onReady?.(7)
    res = await p
    const r2 = res.body!.getReader()
    await r2.read()
    const sub = link.live('main')!
    await r2.cancel()
    expect(sub.cancelled).toBe(true)
  })

  it('abortar con AbortSignal cierra el stream y libera la suscripción', async () => {
    const { link, f } = rig()
    const ac = new AbortController()
    const p = f('onyx://engine/main/global/event', { signal: ac.signal })
    await Promise.resolve()
    link.live('main')!.h.onReady?.(0)
    const res = await p
    const sub = link.live('main')!
    ac.abort()
    const reader = res.body!.getReader()
    await reader.read() // server.connected ya encolado
    expect((await reader.read()).done).toBe(true)
    expect(sub.cancelled).toBe(true)
  })

  it('si el canal cae con el stream abierto, el stream falla con error tipado; sin canal, abrirlo falla tipado', async () => {
    const { link, f } = rig()
    const p = f('onyx://engine/main/global/event')
    await Promise.resolve()
    link.live('main')!.h.onReady?.(0)
    const res = await p
    const reader = res.body!.getReader()
    await reader.read()
    link.end(link.live('main')!, 'disconnected')
    await expect(reader.read()).rejects.toMatchObject({ code: 'disconnected' })
    link.set('offline')
    await expect(f('onyx://engine/main/global/event')).rejects.toMatchObject({ code: 'disconnected' })
    link.set('locked')
    await expect(f('onyx://engine/main/global/event')).rejects.toMatchObject({ code: 'disconnected' })
  })

  it('globalEvent tolera cargas raras', () => {
    expect(globalEvent({ seq: 1, oc: 'x' })).toEqual({ directory: 'global', payload: { type: 'x', properties: {} } })
    expect(globalEvent({ seq: 1, oc: 'x', p: 'texto' })).toEqual({ directory: 'global', payload: { type: 'x', properties: {} } })
  })
})
