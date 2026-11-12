import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

// Ejecuta el manejador HTTP real sin sockets, Electron ni red. El servidor real conserva su suite HTTP.
const http = vi.hoisted(() => ({ handler: null as unknown as (req: unknown, res: unknown) => void }))
vi.mock('node:http', () => ({
  createServer: vi.fn((handler) => {
    http.handler = handler
    return {
      once: vi.fn(),
      listen: vi.fn((_port, _host, ready) => ready()),
      address: () => ({ port: 12345 }),
      close: (closed: () => void) => closed()
    }
  })
}))
import { inlineScriptHashes, startWebServer, webCsp, type WebServer } from './web-server'

const INLINE = "import init from './app.js'; await init()"
const HTML = `<!doctype html><html><head><script type="module">${INLINE}</script></head><body><canvas id="c"></canvas></body></html>`
let dir: string
let server: WebServer | null = null
const get = (url: string, options: { method?: string; host?: string } = {}) =>
  new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
    let status = 0
    let headers: Record<string, string> = {}
    const chunks: Buffer[] = []
    const res = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          chunks.push(Buffer.from(chunk))
          done()
        }
      }),
      {
        writeHead(code: number, values: Record<string, string>) {
          status = code
          headers = values
        }
      }
    )
    res.on('error', reject)
    res.on('finish', () => resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') }))
    http.handler({ url, method: options.method ?? 'GET', headers: { host: options.host ?? `127.0.0.1:${server!.port}` } }, res)
  })
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'web-pdf-defaults-'))
  writeFileSync(join(dir, 'index.html'), HTML)
  writeFileSync(join(dir, 'app.js'), 'export default async () => {}')
  mkdirSync(join(dir, 'sub'))
})
afterEach(async () => {
  await server?.close()
  server = null
  rmSync(dir, { recursive: true, force: true })
})

describe('HTML Craft sin inicializador PDF', () => {
  beforeEach(async () => {
    server = await startWebServer(dir)
  })

  it('sirve el HTML original y autoriza exclusivamente los hashes de sus scripts', async () => {
    const r = await get('/?_r=123')
    const hash = `'sha256-${createHash('sha256').update(INLINE).digest('base64')}'`
    expect(r.status).toBe(200)
    expect(r.body).toBe(HTML)
    expect(r.body).not.toContain('localStorage')
    expect(r.headers['content-security-policy']).toBe(webCsp([hash]))
    const scriptSrc = r.headers['content-security-policy'].split('; ').find((s) => s.startsWith('script-src '))!
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(inlineScriptHashes(r.body)).toEqual([hash])
    expect((await get('/index.html')).body).toBe(HTML)
    const head = await get('/', { method: 'HEAD' })
    expect(head.body).toBe('')
    expect(head.headers['content-security-policy']).toBe(r.headers['content-security-policy'])
    expect((await get('/app.js')).body).toBe('export default async () => {}')
  })

  it('conserva las restricciones de Host, método y ruta', async () => {
    expect((await get('/', { host: 'evil.example' })).status).toBe(421)
    expect((await get('/', { method: 'POST' })).status).toBe(405)
    expect((await get('/no-existe.html')).status).toBe(404)
  })
})
