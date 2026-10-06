/**
 * Autocomprobación al abrir el túnel (antes de enseñar el QR): el Mac pide por INTERNET su propia página a través del túnel y la
 * compara con la suya. Así sabe que (1) el nombre ya resuelve y llega (no se enseña un QR que todavía no funciona), (2) el túnel
 * apunta a NUESTRO servidor (`/__lazunox/probe/<nonce>`, un solo uso) y (3) lo que llega es lo que sirve él (`index.html` y los scripts
 * que referencia), lo que detecta alteraciones NO dirigidas (p. ej. una inyección de Cloudflare bajo `/cdn-cgi/`).
 *
 * Reintentos 1 s → 30 s (el nombre puede tardar en resolver): un fallo de red o un 5xx/52x/530 se reintentan; cualquier otra
 * respuesta distinta de la esperada es `mismatch` al instante.
 */
import { createHash } from 'node:crypto'
import { request } from 'node:https'
import { TRAVEL_GATE_COOKIE, TRAVEL_PROBE_PREFIX, TRAVEL_PROCESS } from '@shared/remote/travel'
import { makeTunnelLookup } from './tunnel-dns'

export type SelfCheckResult = 'ok' | 'unreachable' | 'mismatch'
export interface HttpGetResult {
  status: number
  body: Buffer
}
/** GET sin cuerpo; `headers` ya trae `Cookie`/`Accept-Encoding`. Inyectable (las pruebas apuntan al proxy del falso). */
export type HttpGet = (url: string, headers: Record<string, string>) => Promise<HttpGetResult>

const MAX_BODY = 4 * 1024 * 1024

const tunnelLookup = makeTunnelLookup()

/**
 * GET real por HTTPS (sin seguir redirecciones, con plazo y tope de bytes). El nombre se resuelve con `tunnelLookup`: el nombre de un
 * túnel recién creado aún no existe en el DNS y una consulta temprana al resolvedor del sistema quedaría en su caché negativa (60 s).
 */
export const realHttpGet: HttpGet = (url, headers) =>
  new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request(
      { host: u.hostname, port: 443, path: `${u.pathname}${u.search}`, method: 'GET', headers, timeout: 10_000, lookup: tunnelLookup },
      (res) => {
        const chunks: Buffer[] = []
        let n = 0
        res.on('data', (c: Buffer) => {
          n += c.length
          if (n > MAX_BODY) {
            req.destroy(new Error('too-big'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })

export interface SelfCheckDeps {
  get: HttpGet
  /** Bytes que sirve el propio Mac para una ruta de la PWA (`/` = index). `null` = no existe. */
  expected: (pathname: string) => Buffer | null
  /** Un `nonce` nuevo registrado en el servidor (un solo uso). */
  issueNonce: () => string
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  maxMs?: number
  /** `true` = se paró el túnel mientras se comprobaba: se abandona al instante (`unreachable`). */
  cancelled?: () => boolean
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const transient = (status: number): boolean => status >= 500 || status === 429 || status === 0

/** Rutas de scripts que referencia el HTML (solo del mismo origen, hasta 3). */
export function scriptPaths(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="(\/[^"?#]*)"/gi)) if (!out.includes(m[1]) && out.length < 3) out.push(m[1])
  return out
}

export async function runSelfCheck(origin: string, token: string, d: SelfCheckDeps): Promise<SelfCheckResult> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = d.now ?? Date.now
  const end = now() + (d.maxMs ?? TRAVEL_PROCESS.selfCheckMaxMs)
  const cookie = { Cookie: `${TRAVEL_GATE_COOKIE}=${token}`, 'Accept-Encoding': 'identity' }
  let delay = 1000
  for (;;) {
    let verdict: SelfCheckResult | null = null
    try {
      const probe = await d.get(`${origin}${TRAVEL_PROBE_PREFIX}${d.issueNonce()}`, { 'Accept-Encoding': 'identity' })
      if (transient(probe.status)) verdict = null
      else if (probe.status !== 200 || probe.body.toString('utf8') !== 'lazunox-probe-ok') verdict = 'mismatch'
      else verdict = await compare(origin, d, cookie)
    } catch {
      verdict = null // sin red / no resuelve todavía
    }
    if (verdict === 'ok' || verdict === 'mismatch') return verdict
    if (d.cancelled?.() || now() + delay > end) return 'unreachable'
    await sleep(delay)
    delay = Math.min(30_000, delay * 2)
  }
}

/** `null` = transitorio (reintentar). */
async function compare(origin: string, d: SelfCheckDeps, headers: Record<string, string>): Promise<SelfCheckResult | null> {
  const index = await d.get(`${origin}/`, headers)
  if (transient(index.status)) return null
  const mine = d.expected('/')
  if (index.status !== 200 || !mine || sha(index.body) !== sha(mine)) return 'mismatch'
  for (const p of scriptPaths(mine.toString('utf8'))) {
    const r = await d.get(`${origin}${p}`, headers)
    if (transient(r.status)) return null
    const local = d.expected(p)
    if (r.status !== 200 || !local || sha(r.body) !== sha(local)) return 'mismatch'
  }
  return 'ok'
}
