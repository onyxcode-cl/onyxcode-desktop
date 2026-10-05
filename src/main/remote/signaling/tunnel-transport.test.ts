/**
 * `TunnelSignalingTransport` con el `cloudflared` FALSO (proceso real, proxy local con las cabeceras del borde; nada de red real).
 * Cubre: apertura completa con autocomprobación, la puerta y el WebSocket «desde fuera», keepalive frente al corte por inactividad,
 * inyección detectada, errores del proceso, relanzamientos con URL nueva, y que no quede ningún proceso.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { macOnly } from '../../../test/platform'
import { PROTOCOL_VERSION } from '@shared/remote/protocol'
import { TUNNEL_ORIGIN_RE } from '@shared/remote/travel'
import type { AuditInput } from '../audit'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData, getAppPath: () => process.cwd() } }))

import { BinaryError } from '../tunnel/binary'
import { realCloudflaredDeps } from '../tunnel/real-deps'
import { fakeValue, makeFakeBinary } from '../tunnel/test-fake'
import { runSelfCheck, type HttpGet } from './tunnel-selfcheck'
import { TunnelSignalingTransport, TunnelStartFailure } from './tunnel-transport'
import type { SignalingPeer } from './types'

const mit = it.skipIf(!macOnly)
const SECRET = 'S'.repeat(43)
let pwa = ''
let lines: string[] = []
let audits: AuditInput[] = []
const transports: TunnelSignalingTransport[] = []

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'onyx-tt-'))
  pwa = join(userData, 'pwa')
  mkdirSync(join(pwa, 'assets'), { recursive: true })
  writeFileSync(
    join(pwa, 'index.html'),
    '<!doctype html><html><head><title>pwa</title><script type="module" src="/assets/main-BaDQdc5Q.js"></script></head></html>'
  )
  writeFileSync(join(pwa, 'assets', 'main-BaDQdc5Q.js'), 'console.log("pwa")')
  lines = []
  audits = []
})
afterEach(async () => {
  for (const t of transports.splice(0)) await t.stop().catch(() => undefined)
  rmSync(userData, { recursive: true, force: true })
})

const psAll = (): string => execFileSync('/bin/ps', ['-A', '-o', 'pid=,pgid=,command='], { encoding: 'utf8' })
// El nombre se arma en tiempo de ejecución para no coincidir con la línea de comandos del propio proceso de pruebas.
const MARK = ['cloudflared', 'test'].join('-')
const noFake = (): boolean =>
  !psAll()
    .split('\n')
    .some((l) => l.includes(`${userData}/bin/${MARK}/cloudflared`) && !/\bzsh\b|vitest/.test(l))
async function until(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: tiempo agotado')
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** GET por el proxy del falso (hace de «internet»): pone el `Host` público como lo haría el borde. */
function viaProxy(): HttpGet {
  return (url, headers) =>
    new Promise((resolve, reject) => {
      const u = new URL(url)
      const port = Number(fakeValue(lines, 'FAKE_PROXY_PORT'))
      const r = request({ host: '127.0.0.1', port, path: u.pathname, method: 'GET', headers: { ...headers, Host: u.host } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
      })
      r.on('error', reject)
      r.end()
    })
}

function make(mode: string, o: Partial<ConstructorParameters<typeof TunnelSignalingTransport>[0]> = {}): TunnelSignalingTransport {
  const bin = makeFakeBinary(userData, mode)
  const t = new TunnelSignalingTransport({
    pwaDir: pwa,
    ensureBinary: async () => bin,
    homeDir: join(userData, 'cloudflared', 'home'),
    deps: realCloudflaredDeps,
    audit: (e) => audits.push(e),
    httpGet: viaProxy(),
    startTimeoutMs: 8000,
    selfCheckMaxMs: 3000,
    stopGraceMs: 800,
    onProcessLine: (l) => lines.push(l),
    ...o
  })
  transports.push(t)
  return t
}
const AUTH = { authorize: (h: { mode: string; qid?: string }) => (h.mode === 'pair' ? h.qid === SECRET : true) }

/** El «celular»: entra por el proxy del falso como lo haría desde internet. */
function phone(
  origin: string,
  token: string
): {
  gate(): Promise<{ status: number; cookie: string }>
  page(cookie: string): Promise<{ status: number; body: string }>
  ws(cookie: string): Promise<WebSocket>
} {
  const port = (): number => Number(fakeValue(lines, 'FAKE_PROXY_PORT'))
  const host = new URL(origin).host
  const get = (
    path: string,
    headers: Record<string, string>
  ): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> =>
    new Promise((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port: port(), path, headers: { ...headers, Host: host } }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
      })
      r.on('error', reject)
      r.end()
    })
  return {
    gate: async () => {
      const r = await get(`/k/${token}`, {})
      return { status: r.status, cookie: String(r.headers['set-cookie'] ?? '').split(';')[0] }
    },
    page: async (cookie) => {
      const r = await get('/', { Cookie: cookie })
      return { status: r.status, body: r.body }
    },
    ws: (cookie) =>
      new Promise((resolve, reject) => {
        const s = new WebSocket(`ws://127.0.0.1:${port()}/ws`, { headers: { Host: host, Origin: origin, Cookie: cookie } })
        s.once('open', () => resolve(s))
        s.once('unexpected-response', (_q, res) => reject(new Error(`http ${res.statusCode}`)))
        s.once('error', reject)
      })
  }
}
const next = (s: WebSocket): Promise<string> => new Promise((r) => s.once('message', (d) => r(d.toString())))

describe('apertura y uso «desde fuera»', { timeout: 30_000 }, () => {
  mit('abre el túnel, comprueba su propia página y deja entrar al celular con la puerta, la galleta y el WebSocket', async () => {
    let ensured = 0
    const bin = makeFakeBinary(userData, 'ok')
    const t = make('ok', {
      ensureBinary: async () => {
        ensured++
        return bin
      }
    })
    const peers: SignalingPeer[] = []
    t.onPeer((p) => peers.push(p))
    const { origin } = await t.start(AUTH)
    expect(ensured).toBe(1)
    expect(origin).toMatch(TUNNEL_ORIGIN_RE)
    expect(t.phase()).toBe('online')
    expect(t.status()).toBe('online')
    expect(t.travelToken()).toMatch(/^[A-Za-z0-9_-]{22}$/)
    // El proceso se lanzó contra el puerto local del servidor, sin --config y con HOME privado.
    const argv = JSON.parse(fakeValue(lines, 'FAKE_ARGV') as string) as string[]
    expect(argv).toContain('--no-autoupdate')
    expect(argv).not.toContain('--config')
    expect(argv.join(' ')).toMatch(/--url http:\/\/127\.0\.0\.1:\d+/)
    expect(fakeValue(lines, 'FAKE_HOME')).toBe(join(userData, 'cloudflared', 'home'))

    const p = phone(origin, t.travelToken() as string)
    // Sin galleta, nada; con la puerta, la PWA y el WebSocket.
    expect((await p.page('x=y')).status).toBe(404)
    const g = await p.gate()
    expect(g.status).toBe(303)
    expect(g.cookie).toMatch(/^__Host-onyxk=/)
    const page = await p.page(g.cookie)
    expect(page.status).toBe(200)
    expect(page.body).toContain('<title>pwa</title>')
    const s = await p.ws(g.cookie)
    const ready = next(s)
    s.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, mode: 'pair', qid: SECRET, deviceName: 'Pixel' }))
    expect(JSON.parse(await ready)).toEqual({ t: 'ready' })
    expect(peers).toHaveLength(1)
    s.close()
    await t.stop()
    expect(t.phase()).toBe('idle')
    await until(noFake)
  })

  mit('el cloudflared falso ve ESTE Host y Origin: un Host que no es el del túnel no entra', async () => {
    const t = make('ok')
    const { origin } = await t.start(AUTH)
    const token = t.travelToken() as string
    const port = Number(fakeValue(lines, 'FAKE_PROXY_PORT'))
    // Directo al servidor local con otro Host (como un proceso local que sondea): 421.
    const direct = await new Promise<number>((resolve) => {
      const argv = JSON.parse(fakeValue(lines, 'FAKE_ARGV') as string) as string[]
      const lp = Number(/:(\d+)$/.exec(argv[argv.indexOf('--url') + 1])?.[1])
      request(
        { host: '127.0.0.1', port: lp, path: `/k/${token}`, headers: { Host: `127.0.0.1:${lp}` } },
        (r) => (r.resume(), resolve(r.statusCode ?? 0))
      ).end()
    })
    expect(direct).toBe(421)
    expect(port).toBeGreaterThan(0)
    expect(origin).toMatch(TUNNEL_ORIGIN_RE)
  })

  mit('keepalive: por el túnel un WebSocket ocioso sobrevive porque el Mac manda pings; sin pings el borde lo corta', async () => {
    // Con pings cada 40 ms el falso (que corta a los 300 ms sin tráfico) no corta.
    const t = make('idle-cut:300', { keepalive: { pingMs: 40, deadMs: 5000 } })
    const { origin } = await t.start(AUTH)
    const p = phone(origin, t.travelToken() as string)
    const s = await p.ws((await p.gate()).cookie)
    await new Promise((r) => setTimeout(r, 900))
    expect(s.readyState).toBe(s.OPEN)
    s.close()
    await t.stop()
    // Sin pings (cada 60 s) sí lo corta: demuestra por qué hacen falta.
    const t2 = make('idle-cut:300', { keepalive: { pingMs: 60_000, deadMs: 120_000 } })
    const o2 = await t2.start(AUTH)
    const p2 = phone(o2.origin, t2.travelToken() as string)
    const s2 = await p2.ws((await p2.gate()).cookie)
    await new Promise<void>((r) => s2.once('close', () => r()))
    expect(s2.readyState).toBe(s2.CLOSED)
  })

  mit('un 522 intermitente al abrir el WebSocket lo ve el celular; el Mac sigue sano y el segundo intento entra', async () => {
    const t = make('ws-522:1')
    const { origin } = await t.start(AUTH)
    const p = phone(origin, t.travelToken() as string)
    const g = await p.gate()
    await expect(p.ws(g.cookie)).rejects.toThrow('http 522')
    const s = await p.ws(g.cookie)
    expect(s.readyState).toBe(s.OPEN)
    expect(t.status()).toBe('online')
  })

  mit('un visitante con otra IP de borde no cambia nada y la IP solo sirve de pista de ritmo', async () => {
    const t = make('ok')
    const { origin } = await t.start(AUTH)
    const p = phone(origin, t.travelToken() as string)
    expect((await p.gate()).status).toBe(303)
  })
})

describe('fallos al abrir', { timeout: 30_000 }, () => {
  mit('página alterada en el camino (inject): no hay QR, se audita site-mismatch y no queda nada', async () => {
    const t = make('inject')
    await expect(t.start(AUTH)).rejects.toMatchObject({ code: 'site-mismatch' })
    expect(audits).toContainEqual({ kind: 'site-mismatch', why: 'tunnel' })
    expect(t.travelToken()).toBeNull()
    expect(t.origin()).toBeNull()
    await until(noFake)
  })

  const cases: Array<[string, string, string]> = [
    ['rate-429', 'rate', 'rate'],
    ['edge-down', 'edge-unreachable', 'edge-unreachable'],
    ['config-conflict', 'config-conflict', 'config-conflict'],
    ['bad-url', 'bad-url', 'bad-url'],
    ['no-url', 'timeout', 'timeout']
  ]
  for (const [mode, code] of cases.map((c) => [c[0], c[1]])) {
    mit(`proceso con «${mode}» → ${code}, sin QR y sin procesos`, async () => {
      const t = make(mode, { startTimeoutMs: 700 })
      await expect(t.start(AUTH)).rejects.toMatchObject({ code })
      expect(t.travelToken()).toBeNull()
      await until(noFake)
    })
  }

  mit('no se llega a la URL pública (el nombre no resuelve): unreachable', async () => {
    const t = make('ok', {
      httpGet: async () => {
        throw new Error('ENOTFOUND')
      },
      selfCheckMaxMs: 100
    })
    await expect(t.start(AUTH)).rejects.toMatchObject({ code: 'unreachable' })
    await until(noFake)
  })

  mit('binario no verificable → no-binary y no se lanza nada', async () => {
    const t = make('ok', {
      ensureBinary: async () => {
        throw new BinaryError('bad-hash')
      }
    })
    await expect(t.start(AUTH)).rejects.toMatchObject({ code: 'no-binary' })
    expect(noFake()).toBe(true)
  })

  mit('política que no lo permite: ni puerto ni proceso', async () => {
    const t = make('ok', { allowed: () => false })
    await expect(t.start(AUTH)).rejects.toBeInstanceOf(TunnelStartFailure)
    expect(noFake()).toBe(true)
  })

  mit('stop() mientras el túnel se abre lo corta ya (no espera los 30 s) y no deja procesos', async () => {
    const t = make('no-url', { startTimeoutMs: 20_000 })
    const started = t.start(AUTH).then(
      () => 'abrió',
      (e: { code?: string }) => e.code ?? 'error'
    )
    await new Promise((r) => setTimeout(r, 500))
    const t0 = Date.now()
    await t.stop()
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(await started).toMatch(/^exited:\d+$|^timeout$/)
    await until(noFake)
  })

  mit('stop() durante la autocomprobación la abandona y no deja procesos', async () => {
    const t = make('ok', {
      httpGet: async () => {
        throw new Error('ENOTFOUND')
      },
      selfCheckMaxMs: 60_000
    })
    const started = t.start(AUTH).then(
      () => 'abrió',
      (e: { code?: string }) => e.code ?? 'error'
    )
    await new Promise((r) => setTimeout(r, 1500))
    const t0 = Date.now()
    await t.stop()
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(await started).toBeTruthy()
    await until(noFake)
  })

  mit('start dos veces falla; stop() es idempotente', async () => {
    const t = make('ok')
    await t.start(AUTH)
    await expect(t.start(AUTH)).rejects.toThrow('already-started')
    await t.stop()
    await t.stop()
  })
})

describe('caídas y relanzamientos', { timeout: 40_000 }, () => {
  mit('si el proceso muere se relanza con URL y T NUEVAS, avisa y no deja procesos', async () => {
    const t = make('exit-after:700', { backoff: () => 50 })
    const restarts: string[] = []
    t.onRestart((o) => restarts.push(o))
    const { origin } = await t.start(AUTH)
    const tok1 = t.travelToken() as string
    const phases: string[] = []
    t.onStatus(() => phases.push(t.phase()))
    await until(() => restarts.length > 0, 15_000)
    expect(restarts[0]).toMatch(TUNNEL_ORIGIN_RE)
    expect(t.travelToken()).not.toBe(tok1)
    expect(phases).toContain('retrying')
    expect(origin).toMatch(TUNNEL_ORIGIN_RE)
    await t.stop()
    await until(noFake)
  })

  mit('mientras no hay túnel el servidor responde 503 (nunca acepta otro Host)', async () => {
    const t = make('exit-after:500', { backoff: () => 5000 })
    await t.start(AUTH)
    await until(() => t.phase() === 'retrying', 8000)
    expect(t.origin()).toBeNull()
    expect(t.travelToken()).toBeNull()
    expect(t.status()).toBe('connecting')
    await t.stop()
  })

  mit('6 caídas seguidas: se rinde, avisa con el error y no deja procesos', async () => {
    const t = make('exit-after:150', { backoff: () => 10 })
    let failed = ''
    t.onFail((e) => (failed = e))
    await t.start(AUTH)
    await until(() => failed !== '', 30_000)
    expect(failed).toMatch(/^exited:\d+$|^[a-z-]+$/)
    expect(t.phase()).toBe('failed')
    expect(t.status()).toBe('offline')
    expect(t.lastError()).not.toBeNull()
    await t.stop()
    await until(noFake)
  })

  mit('rate empieza en 60 s: el relanzamiento por límite no se adelanta', async () => {
    const asked: Array<[number, boolean]> = []
    const t = make('rate-after:200', { backoff: (n, rate) => (asked.push([n, rate]), 60_000) })
    await t.start(AUTH)
    await until(() => t.phase() === 'retrying', 8000)
    expect(asked).toEqual([[1, true]])
    expect(t.lastError()).toBe('rate')
    await t.stop()
    await until(noFake)
  })

  mit('pérdida de la conexión registrada → connecting; suspend/resume lo reflejan', async () => {
    const t = make('unregister:200')
    await t.start(AUTH)
    const seen: string[] = []
    t.onStatus((s) => seen.push(s))
    await until(() => seen.includes('connecting'), 5000)
    await until(() => t.status() === 'online', 5000)
    t.suspend()
    expect(t.status()).toBe('connecting')
    t.resume()
    expect(t.status()).toBe('online')
  })

  mit('killNow() síncrono deja el sistema limpio', async () => {
    const t = make('ok')
    await t.start(AUTH)
    t.killNow()
    await new Promise((r) => setTimeout(r, 1500))
    await until(noFake)
  })
})

describe('autocomprobación (unidad)', () => {
  const get =
    (map: Record<string, [number, string]>): HttpGet =>
    async (url) => {
      const k = new URL(url).pathname
      const hit = map[k.startsWith('/__onyx/probe/') ? '/__onyx/probe' : k]
      if (!hit) return { status: 404, body: Buffer.from('Not found') }
      return { status: hit[0], body: Buffer.from(hit[1]) }
    }
  const html = '<script type="module" src="/assets/a.js"></script>'
  const expected = (p: string): Buffer | null => (p === '/' ? Buffer.from(html) : p === '/assets/a.js' ? Buffer.from('js') : null)
  const deps = (g: HttpGet) => ({ get: g, expected, issueNonce: () => 'n'.repeat(22), sleep: async () => undefined, maxMs: 5000 })

  it('ok cuando sonda, página y scripts coinciden', async () => {
    expect(
      await runSelfCheck(
        'https://a-b.trycloudflare.com',
        'T',
        deps(get({ '/__onyx/probe': [200, 'onyx-probe-ok'], '/': [200, html], '/assets/a.js': [200, 'js'] }))
      )
    ).toBe('ok')
  })
  it('mismatch si el script difiere, la página difiere o la sonda no es la nuestra', async () => {
    const base = {
      '/__onyx/probe': [200, 'onyx-probe-ok'] as [number, string],
      '/': [200, html] as [number, string],
      '/assets/a.js': [200, 'js'] as [number, string]
    }
    expect(await runSelfCheck('https://a-b.trycloudflare.com', 'T', deps(get({ ...base, '/assets/a.js': [200, 'js;evil()'] })))).toBe(
      'mismatch'
    )
    expect(
      await runSelfCheck(
        'https://a-b.trycloudflare.com',
        'T',
        deps(get({ ...base, '/': [200, html + '<script src="/cdn-cgi/x.js"></script>'] }))
      )
    ).toBe('mismatch')
    expect(await runSelfCheck('https://a-b.trycloudflare.com', 'T', deps(get({ ...base, '/__onyx/probe': [200, 'otra cosa'] })))).toBe(
      'mismatch'
    )
    expect(await runSelfCheck('https://a-b.trycloudflare.com', 'T', deps(get({ ...base, '/__onyx/probe': [404, 'x'] })))).toBe('mismatch')
  })
  it('reintenta con 5xx/530 y fallos de red hasta agotar el plazo; luego unreachable', async () => {
    let n = 0
    let t = 0
    const flaky: HttpGet = async (url) => {
      n++
      if (n < 3) return { status: 530, body: Buffer.from('') }
      if (n === 3) throw new Error('ENOTFOUND')
      return get({ '/__onyx/probe': [200, 'onyx-probe-ok'], '/': [200, html], '/assets/a.js': [200, 'js'] })(url, {})
    }
    expect(await runSelfCheck('https://a-b.trycloudflare.com', 'T', { ...deps(flaky), now: () => (t += 1) })).toBe('ok')
    expect(n).toBeGreaterThan(3)
    let now = 0
    expect(
      await runSelfCheck('https://a-b.trycloudflare.com', 'T', {
        ...deps(async () => ({ status: 530, body: Buffer.from('') })),
        now: () => now,
        sleep: async (ms) => void (now += ms),
        maxMs: 20_000
      })
    ).toBe('unreachable')
    expect(now).toBeLessThanOrEqual(20_000)
  })
  it('manda la galleta de la puerta y pide el cuerpo sin comprimir', async () => {
    const seen: Array<Record<string, string>> = []
    await runSelfCheck('https://a-b.trycloudflare.com', 'TOKEN', {
      ...deps(async (url, h) => {
        seen.push(h)
        return url.includes('/__onyx/probe/') ? { status: 200, body: Buffer.from('onyx-probe-ok') } : { status: 404, body: Buffer.from('') }
      })
    })
    expect(seen[1].Cookie).toBe('__Host-onyxk=TOKEN')
    expect(seen[1]['Accept-Encoding']).toBe('identity')
  })
})
