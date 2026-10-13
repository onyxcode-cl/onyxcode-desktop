/**
 * PRUEBA (rama `exp/craft-office-pruebas`): servidor HTTP local, SOLO en loopback, para servir una versión WEB de un programa Craft
 * (sitio estático: `index.html` + glue `.js` + motor `.wasm`, instalado y verificado por `craft-install.ts`). La vista del panel
 * (`web-view.ts`) lo abre como cualquier página; el servidor no tiene más función que entregar esos archivos.
 *
 * Defensas: solo `GET`/`HEAD`; la ruta se resuelve y se comprueba que queda DENTRO de la raíz (sin `..`, sin enlaces fuera); se exige
 * la cabecera `Host` exacta `127.0.0.1:<puerto>` (contra DNS rebinding); CSP estricta que solo deja ejecutar los scripts propios y el
 * script en línea de `index.html` (por su hash SHA-256, calculado al arrancar) y que prohíbe cualquier conexión externa; sin caché.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
}

/** Hashes CSP (`'sha256-…'`) de los scripts en línea de un `index.html`. */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((t) => t.trim().length > 0)
    .map((t) => `'sha256-${createHash('sha256').update(t).digest('base64')}'`)
}

export function webCsp(hashes: string[]): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

export interface WebServer {
  port: number
  origin: string
  close: () => Promise<void>
}

/** Arranca el servidor para `rootDir` (debe contener `index.html`). Escucha en 127.0.0.1 con puerto libre. */
export async function startWebServer(rootDir: string): Promise<WebServer> {
  const root = realpathSync(resolve(rootDir))
  const indexPath = join(root, 'index.html')
  if (!existsSync(indexPath)) throw new Error('La versión web no tiene index.html')
  const csp = webCsp(inlineScriptHashes(readFileSync(indexPath, 'utf8')))
  let port = 0
  const server: Server = createServer((req, res) => {
    const deny = (code: number): void => {
      res.writeHead(code, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      res.end()
    }
    if (req.headers.host !== `127.0.0.1:${port}`) return deny(421)
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405)
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
    } catch {
      return deny(400)
    }
    if (pathname.includes('\0')) return deny(400)
    const wanted = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    let real: string
    try {
      real = realpathSync(wanted)
    } catch {
      return deny(404)
    }
    if ((real !== root && !real.startsWith(root + sep)) || !statSync(real).isFile()) return deny(404)
    res.writeHead(200, {
      'content-type': MIME[extname(real).toLowerCase()] ?? 'application/octet-stream',
      'content-security-policy': csp,
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store'
    })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(real).pipe(res)
  })
  await new Promise<void>((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', ok)
  })
  port = (server.address() as AddressInfo).port
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((ok) => server.close(() => ok()))
  }
}
