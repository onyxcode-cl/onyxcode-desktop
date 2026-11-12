import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { runInNewContext } from 'node:vm'

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

describe('arranque PDF en lectura', () => {
  let script: string
  beforeEach(async () => {
    server = await startWebServer(dir, { pdfReadingDefaults: true })
    script = (await get('/')).body.match(/<script>([\s\S]*?)<\/script>/)![1]
  })

  const storage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial))
    return {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value))
    }
  }
  const defaults = { default_mode: 'read', default_zoom: 'fit-width', default_layout: 'continuous' }

  it('sirve el inicializador antes del motor y autoriza solo su hash exacto junto a los originales', async () => {
    const r = await get('/?_r=123')
    const hash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`
    expect(r.status).toBe(200)
    expect(r.body).toBe(HTML.replace('<head>', `<head><script>${script}</script>`))
    expect(String(r.headers['content-security-policy'])).toBe(webCsp([hash, ...inlineScriptHashes(HTML)]))
    const scriptSrc = String(r.headers['content-security-policy'])
      .split('; ')
      .find((s) => s.startsWith('script-src '))!
    expect(scriptSrc).toContain(hash)
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(script).not.toMatch(/reload|location|fetch/)
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(HTML)
    expect((await get('/index.html')).body).toBe(r.body)
    const head = await get('/', { method: 'HEAD' })
    expect(head.body).toBe('')
    expect(head.headers['content-security-policy']).toBe(r.headers['content-security-policy'])
    expect((await get('/app.js')).body).toBe('export default async () => {}')
  })

  it('mantiene HTML y hashes sincronizados aunque el index en disco cambie tras arrancar', async () => {
    const first = await get('/')
    writeFileSync(join(dir, 'index.html'), HTML.replace(INLINE, 'alert(1)'))
    const next = await get('/index.html')
    expect(next.body).toBe(first.body)
    expect(next.headers['content-security-policy']).toBe(first.headers['content-security-policy'])
  })

  it('sin la opción PDF conserva el HTML y la CSP originales para los otros formatos', async () => {
    await server!.close()
    server = await startWebServer(dir, { pdfReadingDefaults: false })
    const r = await get('/')
    expect(r.body).toBe(HTML)
    expect(r.headers['content-security-policy']).toBe(webCsp(inlineScriptHashes(HTML)))
  })

  it('conserva las restricciones de Host, método y ruta al servir el HTML PDF', async () => {
    expect((await get('/', { host: 'evil.example' })).status).toBe(421)
    expect((await get('/', { method: 'POST' })).status).toBe(405)
    expect((await get('/no-existe.html')).status).toBe(404)
  })

  it('establece los valores antes del arranque y no los reescribe al repetir', () => {
    const localStorage = storage()
    runInNewContext(script, { localStorage })
    expect(JSON.parse(localStorage.getItem('pdfcraft')!)).toEqual(defaults)
    runInNewContext(script, { localStorage })
    expect(localStorage.setItem).toHaveBeenCalledTimes(1)
  })

  it.each([{ default_mode: 'edit' }, { default_zoom: '150%' }, { default_layout: 'single' }])(
    'conserva cada preferencia elegida y completa solo las ausentes: %j',
    (chosen) => {
      const localStorage = storage({ pdfcraft: JSON.stringify({ ...chosen, language: 'es', theme: 'dark' }) })
      runInNewContext(script, { localStorage })
      expect(JSON.parse(localStorage.getItem('pdfcraft')!)).toEqual({ ...defaults, ...chosen, language: 'es', theme: 'dark' })
    }
  )

  it('no escribe si la persona ya eligió todos los valores', () => {
    const saved = JSON.stringify({ default_mode: 'all', default_zoom: 'fit-page', default_layout: 'two-up' }, null, 2)
    const localStorage = storage({ pdfcraft: saved })
    runInNewContext(script, { localStorage })
    expect(localStorage.getItem('pdfcraft')).toBe(saved)
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('respeta también las preferencias de la clave anterior que PdfCraft restaura', () => {
    const saved = JSON.stringify({ default_mode: 'sign', author: 'Prueba' })
    const localStorage = storage({ printcraft: saved })
    runInNewContext(script, { localStorage })
    expect(JSON.parse(localStorage.getItem('pdfcraft')!)).toEqual({ ...defaults, default_mode: 'sign', author: 'Prueba' })
    expect(localStorage.getItem('printcraft')).toBe(saved)
  })

  it.each(['{', 'null', '[]', 'true', '"texto"'])('no destruye preferencias ilegibles o de otro tipo: %s', (saved) => {
    const localStorage = storage({ pdfcraft: saved })
    expect(() => runInNewContext(script, { localStorage })).not.toThrow()
    expect(localStorage.getItem('pdfcraft')).toBe(saved)
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it.each(['getItem', 'setItem'] as const)('un fallo de storage en %s no impide arrancar el motor', (method) => {
    const localStorage = storage()
    localStorage[method].mockImplementation(() => {
      throw new Error('storage no disponible')
    })
    expect(() => runInNewContext(script, { localStorage })).not.toThrow()
  })
})
