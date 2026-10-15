import { createServer, request as httpRequest, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialProxy } from './proxy'

/** F8-B69 (hallazgo 9): el proxy de credenciales no deja salir del prefijo de la API con `..` y variantes. */
describe('CredentialProxy: ruta contenida en el prefijo de la API', () => {
  const open: Array<{ stop: () => Promise<void> }> = []
  const upstreams: Server[] = []
  afterEach(async () => {
    for (const o of open.splice(0)) await o.stop()
    for (const s of upstreams.splice(0)) await new Promise<void>((r) => s.close(() => r()))
  })

  async function setup(): Promise<{ proxy: CredentialProxy; seen: string[] }> {
    const seen: string[] = []
    const up = createServer((req, res) => {
      seen.push(req.url ?? '')
      res.end('ok')
    })
    upstreams.push(up)
    await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()))
    const port = (up.address() as { port: number }).port
    const proxy = new CredentialProxy({
      token: 'tok123',
      targetOrigin: `http://127.0.0.1:${port}`,
      targetPathPrefix: '/zen/go/v1',
      key: 'real'
    })
    await proxy.start()
    open.push(proxy)
    return { proxy, seen }
  }

  function get(port: number, path: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const r = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      r.on('error', reject)
      r.end()
    })
  }

  it('reenvía rutas normales bajo el prefijo', async () => {
    const { proxy, seen } = await setup()
    expect(await get(proxy.port, '/tok123/chat/completions?x=1')).toBe(200)
    expect(seen).toEqual(['/zen/go/v1/chat/completions?x=1'])
  })

  it.each([
    '/tok123/../../admin',
    '/tok123/%2e%2e/%2e%2e/admin',
    '/tok123/%2E%2E/admin',
    '/tok123/.%2e/admin',
    '/tok123/a/..%2f..%2fadmin',
    '/tok123/a%5c..%5cadmin',
    '/tok123/a\\..\\admin',
    '/tok123//evil.example/x',
    '/tok123/%252e%252e/admin',
    '/tok123/a%2fb',
    '/tok123/./x',
    '/tok123x/chat',
    '/tok123%2f..%2fadmin'
  ])('rechaza %s', async (p) => {
    const { proxy, seen } = await setup()
    expect(await get(proxy.port, p)).toBeGreaterThanOrEqual(400)
    expect(seen).toEqual([])
  })
})
