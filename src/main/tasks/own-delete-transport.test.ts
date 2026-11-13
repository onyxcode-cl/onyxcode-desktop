/** Transporte sin abrir sockets (el sandbox de Codex no permite listen). Ejecuta el handler HTTP real del proxy. */
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { McpProxy, knownMcpProxyTokens } from './mcp-proxy'

type Internals = { server: unknown; handle: (req: IncomingMessage, res: ServerResponse) => void }
function harness() {
  const proxy = new McpProxy()
  const core = proxy as unknown as Internals
  core.server = {}
  proxy.port = 1234
  const cleanup = vi.fn(async () => ({ deleted: true }))
  const mutation = proxy.setLocalPostHandler('/cleanup', cleanup)
  const read = proxy.setLocalHandler('/guard', async () => ({ status: 200, body: { id: 'ses_read' } }))
  const request = async (
    opts: { token?: string; method?: string; url?: string; headers?: Record<string, string | undefined>; body?: string } = {}
  ) => {
    const req = Object.assign(Readable.from([Buffer.from(opts.body ?? '{"command":"rm a"}')]), {
      method: opts.method ?? 'POST',
      url: opts.url ?? '/cleanup',
      headers: { host: '127.0.0.1:1234', authorization: `Bearer ${opts.token ?? mutation.token}`, ...opts.headers },
      setTimeout: () => {}
    }) as unknown as IncomingMessage
    const res = new EventEmitter() as EventEmitter & {
      destroyed: boolean
      headersSent: boolean
      status: number
      body: string
      writeHead: (status: number) => unknown
      end: (body: string) => void
    }
    res.destroyed = false
    res.headersSent = false
    const done = new Promise<{ status: number; body: string }>((resolve) => {
      res.writeHead = (status) => {
        res.status = status
        res.headersSent = true
        return res
      }
      res.end = (body) => {
        res.body = body
        resolve({ status: res.status, body })
        res.emit('close')
      }
    })
    core.handle(req, res as unknown as ServerResponse)
    return done
  }
  return { proxy, cleanup, mutation, read, request }
}

describe('canal de limpieza separado del guardián', () => {
  it('POST autenticado solo entrega JSON al handler y redacta su token en diagnóstico', async () => {
    const h = harness()
    expect(await h.request()).toEqual({ status: 200, body: '{"deleted":true}' })
    expect(h.cleanup).toHaveBeenCalledExactlyOnceWith({ command: 'rm a' }, expect.any(AbortSignal))
    expect(knownMcpProxyTokens()).toContain(h.mutation.token)
  })
  it('un token de lectura o inválido no autoriza mutación', async () => {
    const h = harness()
    expect((await h.request({ token: h.read.token })).status).toBe(405)
    expect((await h.request({ token: 'wrong' })).status).toBe(401)
    expect(h.cleanup).not.toHaveBeenCalled()
  })
  it.each([
    { method: 'GET' },
    { url: '/cleanup?command=rm' },
    { headers: { origin: 'https://otro.test' } },
    { headers: { host: 'otro.test' } }
  ])('no amplía métodos, rutas, Host ni Origin: %j', async (opts) => {
    const h = harness()
    expect((await h.request(opts)).status).toBeGreaterThanOrEqual(400)
    expect(h.cleanup).not.toHaveBeenCalled()
  })
  it('cuerpo grande y JSON ambiguo no llegan al handler', async () => {
    const h = harness()
    expect((await h.request({ body: 'x'.repeat(20001) })).status).toBe(413)
    expect((await h.request({ body: '{"command":"a","command":"b"}' })).status).toBe(502)
    expect(h.cleanup).not.toHaveBeenCalled()
  })
  it('fallo de limpieza no filtra datos y no devuelve éxito', async () => {
    const h = harness()
    h.cleanup.mockRejectedValueOnce(new Error('secreto'))
    expect(await h.request()).toEqual({ status: 502, body: 'cleanup failed' })
  })
})
