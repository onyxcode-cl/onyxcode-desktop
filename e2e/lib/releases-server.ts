// Servidor local que imita `GET /repos/{owner}/{repo}/releases/latest` de GitHub. Las pruebas NUNCA hablan con api.github.com.
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
}

export interface ReleaseResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

/** Archivo servido bajo una ruta exacta (p. ej. `/o/r/releases/download/v99.9.9/update.json`). */
export interface AssetSpec {
  status?: number
  body?: Buffer
  headers?: Record<string, string>
  /** Redirección 302 a esa ruta (mismo servidor) o URL absoluta: imita a GitHub → release-assets.githubusercontent.com. */
  redirectTo?: string
  /** Envía estos bytes y retiene el resto hasta `release()` (descarga «a medias» para capturas y cancelación). */
  holdAfter?: number
}

export interface ReleasesServer {
  /** `http://127.0.0.1:<puerto>` */
  url: string
  port: number
  requests: RecordedRequest[]
  setResponse(r: ReleaseResponse): void
  /** Respuesta estándar de release publicada (`tag_name`, `html_url` de github.com). */
  setRelease(tag: string, extra?: Record<string, unknown>): void
  /** Sirve un archivo en una ruta exacta (manifiesto, firma, ZIP, «CDN»); `null` lo quita. */
  setAsset(path: string, spec: AssetSpec | null): void
  /** Libera las descargas retenidas por `holdAfter`. */
  release(): void
  /** Peticiones de archivos (no de la API de releases). */
  assetRequests(): RecordedRequest[]
  close(): Promise<void>
}

export async function startReleasesServer(repo = 'test-owner/test-repo'): Promise<ReleasesServer> {
  const requests: RecordedRequest[] = []
  let response: ReleaseResponse = { status: 404, body: { message: 'Not Found' } }
  const assets = new Map<string, AssetSpec>()
  const holds: Array<() => void> = []
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    const asset = assets.get((req.url ?? '').split('?')[0])
    if (asset) {
      if (asset.redirectTo) {
        res.writeHead(302, { location: asset.redirectTo })
        res.end()
        return
      }
      const body = asset.body ?? Buffer.alloc(0)
      res.writeHead(asset.status ?? 200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
        ...asset.headers
      })
      if (asset.holdAfter !== undefined && asset.holdAfter < body.length) {
        res.write(body.subarray(0, asset.holdAfter))
        holds.push(() => res.end(body.subarray(asset.holdAfter)))
        res.on('close', () => undefined)
      } else res.end(body)
      return
    }
    res.writeHead(response.status, { 'content-type': 'application/json', ...response.headers })
    res.end(typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {}))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const api: ReleasesServer = {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    setResponse: (r) => {
      response = r
    },
    setRelease: (tag, extra = {}) =>
      api.setResponse({
        status: 200,
        body: { tag_name: tag, html_url: `https://github.com/${repo}/releases/tag/${tag}`, draft: false, prerelease: false, ...extra }
      }),
    setAsset: (path, spec) => {
      if (spec) assets.set(path, spec)
      else assets.delete(path)
    },
    release: () => {
      for (const h of holds.splice(0)) {
        try {
          h()
        } catch {
          /* la conexión ya se cerró (descarga cancelada) */
        }
      }
    },
    assetRequests: () => requests.filter((r) => assets.has(r.url.split('?')[0])),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
  return api
}

/** Puerto local que ya no escucha nadie (error de conexión). */
export async function closedPortUrl(): Promise<string> {
  const s = await startReleasesServer()
  const url = s.url
  await s.close()
  return url
}
