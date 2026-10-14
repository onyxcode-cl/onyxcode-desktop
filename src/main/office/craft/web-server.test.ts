import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inlineScriptHashes, startWebServer, webCsp, type WebServer } from './web-server'
import { dropScript } from './web-view'

const INLINE = "import init from './app.js'; await init()"
const HTML = `<!doctype html><html><head><script type="module">${INLINE}</script></head><body><canvas id="c"></canvas></body></html>`

let dir: string
let outside: string
let server: WebServer | null = null

interface Res {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}
const get = (path: string, o: { method?: string; host?: string } = {}): Promise<Res> =>
  new Promise((ok, fail) => {
    const req = request(
      { host: '127.0.0.1', port: server!.port, path, method: o.method ?? 'GET', headers: { host: o.host ?? `127.0.0.1:${server!.port}` } },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }))
      }
    )
    req.on('error', fail)
    req.end()
  })

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'web-srv-'))
  outside = mkdtempSync(join(tmpdir(), 'web-out-'))
  writeFileSync(join(dir, 'index.html'), HTML)
  writeFileSync(join(dir, 'app.js'), 'export default async () => {}')
  writeFileSync(join(dir, 'app_bg.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]))
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'a.txt'), 'hola')
  writeFileSync(join(outside, 'secreto.txt'), 'NO DEBE SALIR')
  symlinkSync(join(outside, 'secreto.txt'), join(dir, 'enlace.txt'))
  server = await startWebServer(dir)
})
afterEach(async () => {
  await server?.close()
  server = null
  rmSync(dir, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('web-server (prueba Craft)', () => {
  it('escucha solo en loopback y sirve index.html con los tipos correctos y sin caché', async () => {
    expect(server!.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const r = await get('/')
    expect(r.status).toBe(200)
    expect(r.body).toContain('<canvas')
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect((await get('/app_bg.wasm')).headers['content-type']).toBe('application/wasm')
    expect((await get('/app.js')).headers['content-type']).toContain('text/javascript')
  })

  it('la CSP deja solo el script en línea de la página (por su hash) y prohíbe conexiones externas', async () => {
    const csp = String((await get('/')).headers['content-security-policy'])
    const [hash] = inlineScriptHashes(HTML)
    expect(csp).toContain(hash)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'self' data: blob:")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(webCsp([])).toContain("script-src 'self' 'wasm-unsafe-eval'")
  })

  it.each([
    '/../secreto.txt',
    '/%2e%2e/secreto.txt',
    '/sub/../../secreto.txt',
    '//etc/passwd',
    '/%00index.html',
    '/enlace.txt',
    '/no-existe.js',
    '/sub'
  ])('no sirve nada fuera de la carpeta ni enlaces: %s', async (p) => {
    const r = await get(p)
    expect([400, 404]).toContain(r.status)
    expect(r.body).not.toContain('NO DEBE SALIR')
  })

  it('rechaza otro Host (contra DNS rebinding) y métodos que no son de lectura', async () => {
    expect((await get('/', { host: 'evil.example' })).status).toBe(421)
    expect((await get('/', { host: `localhost:${server!.port}` })).status).toBe(421)
    expect((await get('/', { method: 'POST' })).status).toBe(405)
    expect((await get('/', { method: 'PUT' })).status).toBe(405)
    expect((await get('/', { method: 'HEAD' })).status).toBe(200)
  })

  it('sin index.html no arranca', async () => {
    const vacio = mkdtempSync(join(tmpdir(), 'web-vacio-'))
    await expect(startWebServer(vacio)).rejects.toThrow('index.html')
    rmSync(vacio, { recursive: true, force: true })
  })
})

describe('dropScript', () => {
  it('mete el archivo como datos JSON (no como código) y espera al motor', () => {
    const evil = "');alert(1);('"
    const s = dropScript('QUJD', evil, 'application/x-test')
    expect(s).toContain(JSON.stringify(evil))
    expect(s).toContain('TrunkApplicationStarted')
    expect(s).toContain('new DragEvent(t, o)')
    expect(s).toContain('"QUJD"')
  })

  /** Ejecuta el script en un contexto falso (sin Electron) y devuelve lo que responde. */
  const run = async (script: string, wasmReady: boolean): Promise<unknown> => {
    const { runInNewContext } = await import('node:vm')
    const ctx = {
      window: wasmReady ? { wasmBindings: {} } : {},
      addEventListener: () => undefined,
      setTimeout,
      clearTimeout,
      document: { querySelector: () => null },
      innerWidth: 1,
      innerHeight: 1
    }
    return runInNewContext(script, ctx) as Promise<unknown>
  }

  it('si el motor wasm nunca arranca, se rinde y devuelve false (no espera para siempre)', async () => {
    expect(await run(dropScript('QUJD', 'a.docx', 'application/x-test', 30), false)).toBe(false)
  })

  it('con el motor listo no se queda colgado (sin lienzo devuelve false)', async () => {
    expect(await run(dropScript('QUJD', 'a.docx', 'application/x-test', 30), true)).toBe(false)
  })
})
