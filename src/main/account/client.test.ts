import { describe, expect, it } from 'vitest'
import { AccountApiError, createAccountClient, type FetchLike } from './client'

interface Call {
  url: string
  init: RequestInit
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function setup(respond: (c: Call) => Response | Promise<Response>, baseUrl: string | null = 'https://api.test') {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    const c = { url, init }
    calls.push(c)
    return respond(c)
  }
  return { calls, client: createAccountClient({ baseUrl, fetch, userAgent: 'OnyxCode/1.2.3', timeoutMs: 500 }) }
}

const headers = (c: Call): Record<string, string> => c.init.headers as Record<string, string>

describe('cliente de cuentas', () => {
  it('emailStart: POST /v1/auth/email/start, sin cookies ni redirecciones, sin Authorization ni Origin', async () => {
    const { calls, client } = setup(() => json(202, { ok: true }))
    await client.emailStart('a@b.cl')
    expect(calls[0].url).toBe('https://api.test/v1/auth/email/start')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'a@b.cl' })
    expect(calls[0].init.credentials).toBe('omit')
    expect(calls[0].init.redirect).toBe('error')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    const h = headers(calls[0])
    expect(h['User-Agent']).toBe('OnyxCode/1.2.3')
    expect(h.Authorization).toBeUndefined()
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('origin')
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('cookie')
  })

  it('emailStart: 429 con Retry-After y 400 se informan con estado y código', async () => {
    const r429 = setup(() => json(429, { error: 'rate_limited' }, { 'retry-after': '120' }))
    const e = (await r429.client.emailStart('a@b.cl').catch((x: unknown) => x)) as AccountApiError
    expect(e).toBeInstanceOf(AccountApiError)
    expect([e.kind, e.status, e.code, e.retryAfterSec]).toEqual(['http', 429, 'rate_limited', 120])
    const r400 = setup(() => json(400, { error: 'invalid_email' }))
    const e2 = (await r400.client.emailStart('x').catch((x: unknown) => x)) as AccountApiError
    expect([e2.status, e2.code]).toEqual([400, 'invalid_email'])
  })

  it('emailVerify: devuelve sesión validada', async () => {
    const { calls, client } = setup(() => json(200, { token: 'T', email: 'a@b.cl', provider: 'email', expires_at: 1 }))
    expect(await client.emailVerify('a@b.cl', '123456')).toEqual({ token: 'T', email: 'a@b.cl', provider: 'email' })
    expect(calls[0].url).toBe('https://api.test/v1/auth/email/verify')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'a@b.cl', code: '123456' })
  })

  it('emailVerify: respuesta incompleta o con proveedor raro → invalid', async () => {
    for (const body of [
      {},
      { token: 'T', email: 'a@b.cl' },
      { token: 'T', email: 'a@b.cl', provider: 'x' },
      { token: '', email: 'a@b.cl', provider: 'email' },
      null
    ]) {
      const { client } = setup(() => json(200, body))
      const e = (await client.emailVerify('a@b.cl', '123456').catch((x: unknown) => x)) as AccountApiError
      expect(e.kind).toBe('invalid')
    }
  })

  it('emailVerify: 401 = código incorrecto', async () => {
    const { client } = setup(() => json(401, { error: 'invalid_code' }))
    const e = (await client.emailVerify('a@b.cl', '000000').catch((x: unknown) => x)) as AccountApiError
    expect([e.kind, e.status, e.code]).toEqual(['http', 401, 'invalid_code'])
  })

  it('googleStart: envía redirect_uri, state y challenge S256; devuelve auth_url', async () => {
    const { calls, client } = setup(() => json(200, { auth_url: 'https://accounts.example/auth?x=1' }))
    const r = await client.googleStart({ redirectUri: 'http://127.0.0.1:5000/callback', state: 'S', challenge: 'C' })
    expect(r).toEqual({ authUrl: 'https://accounts.example/auth?x=1' })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      redirect_uri: 'http://127.0.0.1:5000/callback',
      state: 'S',
      code_challenge: 'C',
      code_challenge_method: 'S256'
    })
  })

  it('googleStart sin auth_url → invalid', async () => {
    const { client } = setup(() => json(200, {}))
    const e = (await client.googleStart({ redirectUri: 'r', state: 's', challenge: 'c' }).catch((x: unknown) => x)) as AccountApiError
    expect(e.kind).toBe('invalid')
  })

  it('exchange: envía code, code_verifier y redirect_uri', async () => {
    const { calls, client } = setup(() => json(200, { token: 'T', email: 'a@b.cl', provider: 'google' }))
    expect((await client.exchange({ code: 'K', verifier: 'V', redirectUri: 'R' })).provider).toBe('google')
    expect(calls[0].url).toBe('https://api.test/v1/auth/exchange')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ code: 'K', code_verifier: 'V', redirect_uri: 'R' })
  })

  it('me: Bearer solo aquí; 200 → ok con datos y token rotado', async () => {
    const { calls, client } = setup(() => json(200, { email: 'a@b.cl', provider: 'google', session_token: 'NUEVO' }))
    const r = await client.me('TOK')
    expect(r).toMatchObject({ result: { kind: 'ok' }, rotatedToken: 'NUEVO', email: 'a@b.cl', provider: 'google' })
    expect(calls[0].init.method).toBe('GET')
    expect(headers(calls[0]).Authorization).toBe('Bearer TOK')
    expect(calls[0].init.body).toBeUndefined()
  })

  it.each([401, 404, 410, 500, 503, 429])('me: %i → http con ese estado', async (status) => {
    const { client } = setup(() => json(status, { error: 'x' }))
    expect((await client.me('TOK')).result).toEqual({ kind: 'http', status })
  })

  it('me: fallo de red o tiempo agotado → unreachable (no lanza)', async () => {
    const down = setup(() => Promise.reject(new TypeError('fetch failed')))
    expect((await down.client.me('T')).result).toEqual({ kind: 'unreachable' })
    const slow = createAccountClient({
      baseUrl: 'https://api.test',
      userAgent: 'x',
      timeoutMs: 20,
      fetch: (_u, init) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new Error('abort')))
        })
    })
    expect((await slow.me('T')).result).toEqual({ kind: 'unreachable' })
  })

  it('me: 200 con cuerpo ilegible NO cuenta como sesión válida', async () => {
    const { client } = setup(() => new Response('<html>', { status: 200 }))
    expect((await client.me('T')).result).toEqual({ kind: 'http', status: 502 })
  })

  it('me: cuerpo enorme se rechaza', async () => {
    const { client } = setup(() => new Response('x'.repeat(300 * 1024), { status: 200 }))
    expect((await client.me('T')).result).toEqual({ kind: 'http', status: 502 })
  })

  it('redirecciones: redirect=error (un 3xx nunca se sigue)', async () => {
    const { calls, client } = setup(() => json(200, {}))
    await client.me('T')
    expect(calls[0].init.redirect).toBe('error')
  })

  it('logout: POST /v1/logout con Bearer; 204 y 401 valen', async () => {
    for (const status of [204, 401]) {
      const { calls, client } = setup(() => new Response(null, { status }))
      await client.logout('TOK')
      expect(calls[0].url).toBe('https://api.test/v1/logout')
      expect(calls[0].init.method).toBe('POST')
      expect(headers(calls[0]).Authorization).toBe('Bearer TOK')
    }
    const bad = setup(() => new Response(null, { status: 500 }))
    await expect(bad.client.logout('T')).rejects.toBeInstanceOf(AccountApiError)
  })

  it('deleteMe: DELETE /v1/me con Bearer', async () => {
    const { calls, client } = setup(() => new Response(null, { status: 204 }))
    await client.deleteMe('TOK')
    expect(calls[0].init.method).toBe('DELETE')
    expect(calls[0].url).toBe('https://api.test/v1/me')
    expect(headers(calls[0]).Authorization).toBe('Bearer TOK')
  })

  it('exportMe: devuelve el JSON tal cual', async () => {
    const { client } = setup(() => json(200, { email: 'a@b.cl', created_at: '2026-01-01' }))
    expect(await client.exportMe('T')).toEqual({ email: 'a@b.cl', created_at: '2026-01-01' })
  })

  it('sin baseUrl: todo falla como «unreachable» y no llama a fetch', async () => {
    const { calls, client } = setup(() => json(200, {}), null)
    const e = (await client.emailStart('a@b.cl').catch((x: unknown) => x)) as AccountApiError
    expect(e.kind).toBe('unreachable')
    expect((await client.me('T')).result).toEqual({ kind: 'unreachable' })
    expect(calls).toHaveLength(0)
  })

  it('el token no aparece en la URL ni en el cuerpo', async () => {
    const { calls, client } = setup(() => json(200, { email: 'a@b.cl', provider: 'email' }))
    await client.me('TOKEN-SECRETO')
    await client.logout('TOKEN-SECRETO').catch(() => undefined)
    for (const c of calls) {
      expect(c.url).not.toContain('TOKEN-SECRETO')
      expect(String(c.init.body ?? '')).not.toContain('TOKEN-SECRETO')
    }
  })
})
