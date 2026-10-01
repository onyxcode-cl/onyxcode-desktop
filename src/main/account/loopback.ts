/**
 * Receptor del redireccionamiento de Google (RFC 8252 §7.3, «loopback»): servidor HTTP en
 * 127.0.0.1 con puerto aleatorio que acepta UNA sola petición válida `GET /callback`, con `state`
 * correcto, dentro de un plazo (5 min). Cualquier otra ruta/método/`state` se rechaza sin gastar
 * el turno (para que una página ajena no pueda romper el inicio de sesión). Tras la petición buena
 * se cierra: una segunda petición ya no encuentra a nadie escuchando.
 */
import { getLang, t } from '@shared/i18n'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { safeEqual } from './pkce'

export const LOOPBACK_TIMEOUT_MS = 5 * 60 * 1000
/** Peticiones rechazadas que se toleran antes de abandonar el intento (evita inundar el puerto). */
const MAX_REJECTED = 20

export type LoopbackResult = { ok: true; code: string } | { ok: false; reason: 'denied' | 'timeout' | 'cancelled' | 'invalid' }

export interface LoopbackHandle {
  port: number
  /** `http://127.0.0.1:<puerto>/callback` */
  redirectUri: string
  /** Se resuelve una sola vez (nunca rechaza). */
  result: Promise<LoopbackResult>
  /** Cancela el intento y libera el puerto (idempotente). */
  cancel(): void
}

export interface LoopbackOptions {
  state: string
  timeoutMs?: number
}

const CODE_RE = /^[A-Za-z0-9._~/+=-]{1,2048}$/

function page(title: string, detail: string): string {
  return (
    '<!doctype html><html lang="' +
    getLang() +
    '"><head><meta charset="utf-8"><title>' +
    title +
    '</title><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px -apple-system,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f7f8fb;color:#11131a}' +
    'main{text-align:center;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#555}' +
    '@media(prefers-color-scheme:dark){body{background:#11131a;color:#f3f4f8}p{color:#aab}}</style></head><body><main><h1>' +
    title +
    '</h1><p>' +
    detail +
    '</p></main></body></html>'
  )
}

const okPage = (): string => page(t('merr.acct.pageOkTitle'), t('merr.acct.pageOkBody'))
const failPage = (): string => page(t('merr.acct.pageFailTitle'), t('merr.acct.pageFailBody'))

function send(res: ServerResponse, status: number, body: string, html = false): void {
  res.writeHead(status, {
    'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close'
  })
  res.end(body)
}

/** Abre el receptor. Falla (rechaza) solo si no se puede abrir el puerto. */
export function startLoopback(opts: LoopbackOptions): Promise<LoopbackHandle> {
  const timeoutMs = opts.timeoutMs ?? LOOPBACK_TIMEOUT_MS
  return new Promise((resolveStart, rejectStart) => {
    let finish: (r: LoopbackResult) => void = () => undefined
    const result = new Promise<LoopbackResult>((r) => {
      finish = r
    })
    let done = false
    let rejected = 0
    let port = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const server: Server = createServer()

    const close = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      // Deja salir la respuesta en curso y luego corta cualquier conexión abierta.
      server.close()
      setImmediate(() => server.closeAllConnections())
    }
    const conclude = (r: LoopbackResult): void => {
      if (done) return
      done = true
      finish(r)
      close()
    }

    const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
      if (done) return send(res, 410, 'Gone')
      const reject = (status: number, msg: string): void => {
        send(res, status, msg)
        if (++rejected >= MAX_REJECTED) conclude({ ok: false, reason: 'invalid' })
      }
      // Defensa contra DNS rebinding: el Host debe ser exactamente el literal de loopback con nuestro puerto.
      if (req.headers.host !== `127.0.0.1:${port}`) return reject(400, 'Bad Request')
      if (req.method !== 'GET') return reject(405, 'Method Not Allowed')
      let url: URL
      try {
        url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      } catch {
        return reject(400, 'Bad Request')
      }
      if (url.pathname !== '/callback') return reject(404, 'Not Found')
      const state = url.searchParams.get('state')
      if (!state || !safeEqual(state, opts.state)) return reject(400, 'Bad Request')
      // Desde aquí la petición es la legítima: se gasta el turno pase lo que pase.
      if (url.searchParams.get('error')) {
        send(res, 200, failPage(), true)
        return conclude({ ok: false, reason: 'denied' })
      }
      const code = url.searchParams.get('code')
      if (!code || !CODE_RE.test(code)) {
        send(res, 400, failPage(), true)
        return conclude({ ok: false, reason: 'invalid' })
      }
      send(res, 200, okPage(), true)
      conclude({ ok: true, code })
    }

    server.on('request', onRequest)
    server.on('error', (err) => {
      if (port === 0) rejectStart(err)
      else conclude({ ok: false, reason: 'invalid' })
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      timer = setTimeout(() => conclude({ ok: false, reason: 'timeout' }), timeoutMs)
      timer.unref?.()
      resolveStart({
        port,
        redirectUri: `http://127.0.0.1:${port}/callback`,
        result,
        cancel: () => conclude({ ok: false, reason: 'cancelled' })
      })
    })
  })
}
