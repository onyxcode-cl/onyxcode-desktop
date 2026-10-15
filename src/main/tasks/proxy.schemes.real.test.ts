/**
 * CredentialProxy real contra una «API upstream» falsa (HTTP local): por cada esquema de autenticación la clave REAL llega
 * por la cabecera correcta, el centinela del sandbox nunca llega y las credenciales extra/duplicadas se descartan.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { getFreePort } from '../util/net'
import { CredentialProxy, randomToken } from './proxy'

interface Seen {
  url: string
  headers: IncomingHttpHeaders
  rawHeaders: string[]
}
const REAL = 'REAL-KEY-0123456789'
const SENTINEL = 'sandboxed-placeholder-deadbeefdeadbeef'

let upstream: Server | null = null
let proxy: CredentialProxy | null = null

async function teardown(): Promise<void> {
  await proxy?.stop()
  const up = upstream
  if (up) await new Promise<void>((r) => up.close(() => r()))
  upstream = null
  proxy = null
}
afterEach(teardown)

async function setup(prefix = '/v1'): Promise<{ seen: Seen[]; token: string }> {
  const seen: Seen[] = []
  const up = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers, rawHeaders: req.rawHeaders })
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
  })
  upstream = up
  const port = await getFreePort()
  await new Promise<void>((r) => up.listen(port, '127.0.0.1', () => r()))
  const token = randomToken()
  proxy = new CredentialProxy({ token, targetOrigin: `http://127.0.0.1:${port}`, targetPathPrefix: prefix, key: REAL })
  await proxy.start()
  return { seen, token }
}

/** Petición con cabeceras (admite repetidas) al proxy. */
function call(path: string, headers: Array<[string, string]>, method = 'POST'): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: proxy!.port, path, method }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
    })
    req.on('error', reject)
    const grouped = new Map<string, string[]>()
    for (const [k, v] of headers) grouped.set(k, [...(grouped.get(k) ?? []), v])
    for (const [k, v] of grouped) req.setHeader(k, v)
    if (method === 'POST') req.end('{}')
    else req.end()
  })
}

const noSentinel = (s: Seen): void => {
  expect(JSON.stringify(s.rawHeaders)).not.toContain('placeholder')
  expect(s.url).not.toContain('placeholder')
}
const credHeaders = (s: Seen): string[] =>
  Object.keys(s.headers).filter((h) => ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key', 'proxy-authorization'].includes(h))

describe('CredentialProxy: cliente con Authorization Bearer (openai-compatible)', () => {
  it('inyecta Authorization: Bearer real y descarta centinela y otras credenciales', async () => {
    const { seen, token } = await setup()
    const r = await call(`/${token}/chat/completions`, [
      ['authorization', `Bearer ${SENTINEL}`],
      ['accept', 'application/json']
    ])
    expect(r.status).toBe(200)
    expect(seen[0].url).toBe('/v1/chat/completions')
    expect(seen[0].headers.authorization).toBe(`Bearer ${REAL}`)
    expect(credHeaders(seen[0])).toEqual(['authorization'])
    expect(seen[0].headers.accept).toBe('application/json')
    noSentinel(seen[0])
  })
  it('si el cliente manda Authorization y x-api-key, la real va en ambas', async () => {
    const { seen, token } = await setup()
    await call(`/${token}/messages`, [
      ['x-api-key', SENTINEL],
      ['authorization', `Bearer ${SENTINEL}`],
      ['anthropic-version', '2023-06-01']
    ])
    expect(seen[0].headers.authorization).toBe(`Bearer ${REAL}`)
    expect(seen[0].headers['x-api-key']).toBe(REAL)
    expect(seen[0].headers['anthropic-version']).toBe('2023-06-01')
    noSentinel(seen[0])
  })
})

describe('CredentialProxy: cliente con x-api-key (SDK anthropic)', () => {
  it('manda x-api-key real, deja pasar anthropic-version y no manda Authorization', async () => {
    const { seen, token } = await setup()
    await call(`/${token}/messages`, [
      ['x-api-key', SENTINEL],
      ['anthropic-version', '2023-06-01'],
      ['anthropic-beta', 'tools-2024']
    ])
    const s = seen[0]
    expect(s.headers['x-api-key']).toBe(REAL)
    expect(s.headers.authorization).toBeUndefined()
    expect(s.headers['anthropic-version']).toBe('2023-06-01')
    expect(s.headers['anthropic-beta']).toBe('tools-2024')
    expect(credHeaders(s)).toEqual(['x-api-key'])
    noSentinel(s)
  })
  it('credenciales duplicadas (cabecera repetida y mayúsculas) no se filtran', async () => {
    const { seen, token } = await setup()
    await call(`/${token}/messages`, [
      ['x-api-key', SENTINEL],
      ['X-Api-Key', `${SENTINEL}-2`],
      ['Proxy-Authorization', `Basic ${SENTINEL}`]
    ])
    const s = seen[0]
    expect(s.headers['x-api-key']).toBe(REAL)
    expect(s.rawHeaders.filter((h) => h.toLowerCase() === 'x-api-key')).toHaveLength(1)
    expect(s.headers.authorization).toBeUndefined()
    expect(s.headers['proxy-authorization']).toBeUndefined()
    noSentinel(s)
  })
  it('Authorization duplicada: una sola, la real', async () => {
    const { seen, token } = await setup()
    await call(`/${token}/chat/completions`, [
      ['Authorization', `Bearer ${SENTINEL}`],
      ['authorization', `Bearer ${SENTINEL}-2`]
    ])
    expect(seen[0].headers.authorization).toBe(`Bearer ${REAL}`)
    expect(seen[0].rawHeaders.filter((h) => h.toLowerCase() === 'authorization')).toHaveLength(1)
    noSentinel(seen[0])
  })
})

describe('CredentialProxy: cliente con x-goog-api-key o ?key= (SDK google)', () => {
  it('manda x-goog-api-key real y elimina key= del query (centinela incluido)', async () => {
    const { seen, token } = await setup('/v1beta')
    await call(`/${token}/models/gemini:streamGenerateContent?alt=sse&key=${SENTINEL}&api_key=${SENTINEL}&key=${SENTINEL}2`, [
      ['x-goog-api-key', SENTINEL]
    ])
    const s = seen[0]
    expect(s.headers['x-goog-api-key']).toBe(REAL)
    expect(s.headers.authorization).toBeUndefined()
    expect(s.url).toBe('/v1beta/models/gemini:streamGenerateContent?alt=sse')
    expect(credHeaders(s)).toEqual(['x-goog-api-key'])
    noSentinel(s)
  })
  it('clave solo en el query (?key=centinela): se quita y la real va en x-goog-api-key', async () => {
    const { seen, token } = await setup('/v1beta')
    await call(`/${token}/models/gemini:generateContent?key=${SENTINEL}`, [])
    expect(seen[0].url).toBe('/v1beta/models/gemini:generateContent')
    expect(seen[0].headers['x-goog-api-key']).toBe(REAL)
    expect(seen[0].headers.authorization).toBeUndefined()
    noSentinel(seen[0])
  })
  it('sin credenciales en el query se conserva tal cual (cliente sin cabecera → Bearer)', async () => {
    const { seen, token } = await setup('/v1beta')
    await call(`/${token}/models?pageSize=5`, [])
    expect(seen[0].url).toBe('/v1beta/models?pageSize=5')
    expect(seen[0].headers.authorization).toBe(`Bearer ${REAL}`)
  })
})

describe('CredentialProxy: acceso y path traversal', () => {
  it('token incorrecto → 403 sin llegar al upstream', async () => {
    const { seen } = await setup()
    const r = await call('/otro-token/x', [])
    expect(r.status).toBe(403)
    expect(seen).toHaveLength(0)
  })
  it.each(['/../admin', '/%2e%2e/admin', '/a/%2e%2E/b', '//x', '/a%2f..%2fb', '/a%5c..', '/%252e%252e/x'])(
    'traversal %s → 400 sin llegar al upstream',
    async (p) => {
      const { seen, token } = await setup()
      const r = await call(`/${token}${p}`, [['x-api-key', SENTINEL]])
      expect(r.status).toBe(400)
      expect(seen).toHaveLength(0)
    }
  )
})

describe('CredentialProxy: prefijo de opencode-go del catálogo', () => {
  it('reenvía bajo /inference/go/v1', async () => {
    const { seen, token } = await setup('/inference/go/v1')
    await call(`/${token}/chat/completions`, [['authorization', `Bearer ${SENTINEL}`]])
    expect(seen[0].url).toBe('/inference/go/v1/chat/completions')
    expect(seen[0].headers.authorization).toBe(`Bearer ${REAL}`)
  })
})

describe('CredentialProxy: api-key, métodos, rutas y path', () => {
  it('cliente con api-key: la real va en api-key y no en Authorization', async () => {
    const { seen, token } = await setup()
    await call(`/${token}/chat/completions`, [['api-key', SENTINEL]])
    expect(seen[0].headers['api-key']).toBe(REAL)
    expect(seen[0].headers.authorization).toBeUndefined()
    noSentinel(seen[0])
  })
  it('DELETE/PUT/PATCH → 405 sin llegar al upstream', async () => {
    const { seen, token } = await setup()
    for (const m of ['DELETE', 'PUT', 'PATCH']) expect((await call(`/${token}/models/x`, [], m)).status).toBe(405)
    expect(seen).toHaveLength(0)
  })
  it('GET y HEAD sí pasan', async () => {
    const { seen, token } = await setup()
    expect((await call(`/${token}/models`, [], 'GET')).status).toBe(200)
    expect((await call(`/${token}/models`, [], 'HEAD')).status).toBe(200)
    expect(seen).toHaveLength(2)
  })
  it.each([
    '/files',
    '/FILES/abc',
    '/v1/files',
    '/fine_tuning/jobs',
    '/organization/users',
    '/a/Batches',
    '/vector_stores/x/files',
    '/threads'
  ])('ruta denegada %s → 403', async (p) => {
    const { seen, token } = await setup()
    expect((await call(`/${token}${p}`, [])).status).toBe(403)
    expect(seen).toHaveLength(0)
  })
  it('`;` en el path → 400', async () => {
    const { seen, token } = await setup()
    expect((await call(`/${token}/models;x=1`, [])).status).toBe(400)
    expect(seen).toHaveLength(0)
  })
  it('el query se reenvía sin re-serializar', async () => {
    const { seen, token } = await setup('/v1beta')
    await call(`/${token}/models?a=1%20b&key=${SENTINEL}&c=x+y`, [])
    expect(seen[0].url).toBe('/v1beta/models?a=1%20b&c=x+y')
  })
})

describe('CredentialProxy: respuesta del upstream', () => {
  async function withReply(reply: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ token: string; port: number }> {
    const up = createServer(reply)
    upstream = up
    const uport = await getFreePort()
    await new Promise<void>((r) => up.listen(uport, '127.0.0.1', () => r()))
    const token = randomToken()
    proxy = new CredentialProxy({ token, targetOrigin: `http://127.0.0.1:${uport}`, targetPathPrefix: '/v1', key: REAL })
    await proxy.start()
    return { token, port: proxy.port }
  }
  function get(port: number, path: string): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      })
        .on('error', reject)
        .end()
    })
  }

  it('redirect 307 a otro host → 502 y no se reenvía location', async () => {
    const { token, port } = await withReply((_q, res) => res.writeHead(307, { location: 'https://evil.example/steal' }).end())
    const r = await get(port, `/${token}/models`)
    expect(r.status).toBe(502)
    expect(r.headers.location).toBeUndefined()
    expect(r.body).not.toContain('evil')
  })
  it('redirect al mismo origen se conserva', async () => {
    const { token, port } = await withReply((_q, res) => res.writeHead(307, { location: '/v1/other' }).end())
    const r = await get(port, `/${token}/models`)
    expect(r.status).toBe(307)
    expect(r.headers.location).toBe('/v1/other')
  })
  it('set-cookie, www-authenticate y cabeceras que contienen la clave se descartan', async () => {
    const { token, port } = await withReply((_q, res) =>
      res
        .writeHead(200, {
          'set-cookie': 'a=b',
          'www-authenticate': 'Bearer',
          'x-echo': `Bearer ${REAL}`,
          'x-ok': 'si',
          'content-type': 'text/plain'
        })
        .end('ok')
    )
    const r = await get(port, `/${token}/models`)
    expect(r.headers['set-cookie']).toBeUndefined()
    expect(r.headers['www-authenticate']).toBeUndefined()
    expect(r.headers['x-echo']).toBeUndefined()
    expect(r.headers['x-ok']).toBe('si')
  })
  it('upstream que refleja la cabecera de autenticación: la clave real no llega al cliente', async () => {
    const { token, port } = await withReply((q, res) => {
      const echo = JSON.stringify({ auth: q.headers.authorization })
      res.writeHead(401, { 'content-type': 'application/json', 'x-seen': String(q.headers.authorization) }).end(echo)
    })
    const r = await get(port, `/${token}/models`)
    expect(r.status).toBe(401)
    expect(JSON.stringify(r)).not.toContain(REAL)
    expect(r.body).toContain('[clave oculta]')
  })
  it('cuerpo grande y SSE no se tocan (streaming)', async () => {
    const big = 'x'.repeat(70 * 1024) + REAL
    const { token, port } = await withReply((q, res) => {
      if (q.url?.endsWith('/sse')) res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${REAL}\n\n`)
      else res.writeHead(200, { 'content-type': 'application/json' }).end(big)
    })
    expect((await get(port, `/${token}/big`)).body).toBe(big)
    expect((await get(port, `/${token}/sse`)).body).toContain(REAL)
  })
})
