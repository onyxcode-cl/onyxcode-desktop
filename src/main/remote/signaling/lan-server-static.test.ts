/** Estáticos de la PWA completa (F8-B56): `.gz` precomprimido, caché inmutable con huella, CSP estricta y tipos MIME. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LanSignalingServer } from './lan-server'

let dir: string
let server: LanSignalingServer
let origin = ''

const JS = 'export const x = "hola"\n'.repeat(200)

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pwa-static-'))
  mkdirSync(join(dir, 'assets'))
  mkdirSync(join(dir, 'app', 'assets'), { recursive: true })
  const put = (rel: string, data: string | Buffer, gz = false): void => {
    writeFileSync(join(dir, rel), data)
    if (gz) writeFileSync(join(dir, `${rel}.gz`), gzipSync(data))
  }
  put('index.html', '<!doctype html><title>pwa</title>', true)
  put('assets/index-D4z46Da7.js', JS, true)
  put('assets/style-_9jcHID4.css', 'body{margin:0}', true)
  put('app/entry.json', '{"v":1,"js":"assets/main-BaDQdc5Q.js","css":[]}', true)
  put('app/assets/main-BaDQdc5Q.js', JS, true)
  put('app/assets/sin-gz-AbCdEf12.js', 'console.log(1)') // sin precomprimir
  put('app/assets/logo-Zx9Qw3Lm.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', true)
  put('app/assets/fuente-Qw3Er5Ty.woff2', Buffer.from([0, 1, 2, 3]))
  put('app/assets/main-BaDQdc5Q.js.map', '{"version":3}', true)
  put('app/assets/foto-Aa1Bb2Cc.png', Buffer.from([137, 80, 78, 71]))
  put('assets/sin-huella.js', 'console.log(2)')
  put('app/assets/en-dict-VfD2r35a.js', 'x', true)
  server = new LanSignalingServer({ ip: '127.0.0.1', pwaDir: dir })
  origin = (await server.start({ authorize: () => false })).origin
})
afterEach(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

function get(
  path: string,
  headers: Record<string, string> = {},
  method = 'GET'
): Promise<{ status: number; body: Buffer; headers: Record<string, string | string[] | undefined> }> {
  const u = new URL(origin)
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

const GZ = { 'accept-encoding': 'gzip, deflate, br' }

describe('LanSignalingServer: estáticos de la PWA completa', () => {
  it('sirve el `.gz` precomprimido con Content-Encoding y el tipo del original', async () => {
    const r = await get('/app/assets/main-BaDQdc5Q.js', GZ)
    expect(r.status).toBe(200)
    expect(r.headers['content-encoding']).toBe('gzip')
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(r.headers.vary).toBe('Accept-Encoding')
    expect(Number(r.headers['content-length'])).toBe(r.body.length)
    expect(gunzipSync(r.body).toString()).toBe(JS)
  })

  it('sin Accept-Encoding gzip, o sin `.gz` junto al archivo, sirve el original sin comprimir', async () => {
    const plain = await get('/app/assets/main-BaDQdc5Q.js')
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.body.toString()).toBe(JS)
    const none = await get('/app/assets/sin-gz-AbCdEf12.js', GZ)
    expect(none.headers['content-encoding']).toBeUndefined()
    expect(none.body.toString()).toBe('console.log(1)')
  })

  it('los binarios (png, woff2) no se comprimen; HEAD lleva las mismas cabeceras sin cuerpo', async () => {
    expect((await get('/app/assets/foto-Aa1Bb2Cc.png', GZ)).headers['content-encoding']).toBeUndefined()
    const woff = await get('/app/assets/fuente-Qw3Er5Ty.woff2', GZ)
    expect(woff.headers['content-type']).toBe('font/woff2')
    expect(woff.headers['content-encoding']).toBeUndefined()
    const head = await get('/app/assets/main-BaDQdc5Q.js', GZ, 'HEAD')
    expect(head.body.length).toBe(0)
    expect(head.headers['content-encoding']).toBe('gzip')
  })

  it('recursos con huella: inmutables un año; index.html, entry.json y lo demás: no-store', async () => {
    const immutable = 'public, max-age=31536000, immutable'
    expect((await get('/app/assets/main-BaDQdc5Q.js', GZ)).headers['cache-control']).toBe(immutable)
    expect((await get('/assets/index-D4z46Da7.js', GZ)).headers['cache-control']).toBe(immutable)
    expect((await get('/assets/style-_9jcHID4.css', GZ)).headers['cache-control']).toBe(immutable)
    expect((await get('/app/assets/logo-Zx9Qw3Lm.svg', GZ)).headers['cache-control']).toBe(immutable)
    expect((await get('/', GZ)).headers['cache-control']).toBe('no-store')
    expect((await get('/index.html', GZ)).headers['cache-control']).toBe('no-store')
    expect((await get('/app/entry.json', GZ)).headers['cache-control']).toBe('no-store')
    expect((await get('/assets/sin-huella.js', GZ)).headers['cache-control']).toBe('no-store')
    expect((await get('/app/assets/en-dict-VfD2r35a.js', GZ)).headers['cache-control']).toBe(immutable)
  })

  it('tipos MIME correctos: js, css, svg, woff2, map y json', async () => {
    const ct = async (p: string): Promise<unknown> => (await get(p)).headers['content-type']
    expect(await ct('/assets/index-D4z46Da7.js')).toBe('text/javascript; charset=utf-8')
    expect(await ct('/assets/style-_9jcHID4.css')).toBe('text/css; charset=utf-8')
    expect(await ct('/app/assets/logo-Zx9Qw3Lm.svg')).toBe('image/svg+xml')
    expect(await ct('/app/assets/fuente-Qw3Er5Ty.woff2')).toBe('font/woff2')
    expect(await ct('/app/assets/main-BaDQdc5Q.js.map')).toBe('application/json; charset=utf-8')
    expect(await ct('/app/entry.json')).toBe('application/json; charset=utf-8')
  })

  it('el `.gz` no se pide directamente y no hay forma de salir de la carpeta', async () => {
    expect((await get('/app/assets/main-BaDQdc5Q.js.gz', GZ)).status).toBe(404)
    expect((await get('/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404)
    expect((await get('/app/..%2f..%2findex.html.gz')).status).toBeGreaterThanOrEqual(400)
  })

  it('CSP estricta: scripts solo del origen (sin inline ni eval), blob: en imágenes, sin service worker ni worker', async () => {
    const csp = String((await get('/app/assets/main-BaDQdc5Q.js')).headers['content-security-policy'])
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toMatch(/script-src[^;]*unsafe/)
    expect(csp).toMatch(/img-src 'self' data: blob:/)
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toMatch(/worker-src/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect((await get('/sw.js')).status).toBe(404)
  })

  it('Host ajeno (rebinding) y métodos no GET/HEAD se rechazan también para los estáticos', async () => {
    expect((await get('/app/assets/main-BaDQdc5Q.js', { host: 'evil.example:80' })).status).toBe(421)
    expect((await get('/app/assets/main-BaDQdc5Q.js', {}, 'POST')).status).toBe(405)
  })
})
