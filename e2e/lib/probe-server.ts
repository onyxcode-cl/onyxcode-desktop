// Servidor de «proveedor» para «Probar clave»: corre en el proceso del test (127.0.0.1, puerto libre) y la app lo usa
// en lugar de https://api.openai.com… vía ONYXCODE_E2E_KEY_PROBE_BASE (solo sin empaquetar). Responde según la clave:
// `sk-e2e-valid…` 200, `…invalid…` 401, `…limit…` 429, `…down…` 503. Guarda lo recibido para comprobar que la clave llegó
// (y solo aquí).
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface ProbeHit {
  method: string
  path: string
  headers: http.IncomingHttpHeaders
}

export interface ProbeServer {
  /** `http://127.0.0.1:<puerto>` */
  base: string
  port: number
  hits: ProbeHit[]
  close(): Promise<void>
}

/** Clave que llegó en la petición (Bearer, x-api-key o x-goog-api-key). */
export function receivedKey(hit: ProbeHit): string {
  const auth = hit.headers.authorization
  if (typeof auth === 'string') return auth.replace(/^Bearer\s+/i, '')
  for (const h of ['x-api-key', 'x-goog-api-key']) {
    const v = hit.headers[h]
    if (typeof v === 'string') return v
  }
  return ''
}

export function statusForKey(key: string): number {
  if (key.includes('invalid')) return 401
  if (key.includes('limit')) return 429
  if (key.includes('down')) return 503
  if (key.startsWith('sk-e2e-valid')) return 200
  return 401
}

export async function startProbeServer(port = 0): Promise<ProbeServer> {
  const hits: ProbeHit[] = []
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers })
    const status = statusForKey(receivedKey(hits[hits.length - 1]))
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(status === 200 ? { data: [{ id: 'fake-model' }] } : { error: { message: 'e2e' } }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const actual = (server.address() as AddressInfo).port
  return {
    base: `http://127.0.0.1:${actual}`,
    port: actual,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
