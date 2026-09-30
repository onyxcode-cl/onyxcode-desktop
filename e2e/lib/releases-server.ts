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

export interface ReleasesServer {
  /** `http://127.0.0.1:<puerto>` */
  url: string
  port: number
  requests: RecordedRequest[]
  setResponse(r: ReleaseResponse): void
  /** Respuesta estándar de release publicada (`tag_name`, `html_url` de github.com). */
  setRelease(tag: string, extra?: Record<string, unknown>): void
  close(): Promise<void>
}

export async function startReleasesServer(repo = 'test-owner/test-repo'): Promise<ReleasesServer> {
  const requests: RecordedRequest[] = []
  let response: ReleaseResponse = { status: 404, body: { message: 'Not Found' } }
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
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
