import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appAuthFile } from '../opencode/data-dir'
import {
  PROBES,
  KeyProbeBusyError,
  KeyProber,
  classifyHttp,
  genericProbe,
  resolveE2eKeyProbeBase,
  type KeyProbeDeps,
  type ProbeResponse
} from './key-probe'

let userData = ''
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'key-probe-'))
})
afterEach(() => rmSync(userData, { recursive: true, force: true }))

function seedAuth(auth: Record<string, unknown>): void {
  mkdirSync(join(appAuthFile(userData), '..'), { recursive: true })
  writeFileSync(appAuthFile(userData), JSON.stringify(auth))
}

type FetchArgs = Parameters<KeyProbeDeps['fetch']>
function make(fetchImpl: (...a: FetchArgs) => Promise<ProbeResponse>, extra: Partial<KeyProbeDeps> = {}) {
  const calls: FetchArgs[] = []
  let t = 1000
  const prober = new KeyProber({
    userData,
    fetch: (...a) => {
      calls.push(a)
      return fetchImpl(...a)
    },
    isOnline: () => true,
    now: () => (t += 7),
    minIntervalMs: 0,
    ...extra
  })
  return { prober, calls }
}
const respond = (status: number) => async (): Promise<ProbeResponse> => ({ status })

describe('classifyHttp', () => {
  it.each([
    [200, 'ok'],
    [204, 'ok'],
    [401, 'invalid'],
    [403, 'forbidden'],
    [402, 'no-credit'],
    [429, 'rate-limited'],
    [408, 'timeout'],
    [504, 'timeout'],
    [500, 'provider-down'],
    [502, 'provider-down'],
    [529, 'provider-down'],
    [301, 'unexpected'],
    [404, 'unexpected'],
    [418, 'unexpected'],
    [0, 'unexpected']
  ])('HTTP %i → %s', (code, expected) => {
    expect(classifyHttp(code)).toBe(expected)
  })
  it('un 400 solo es «inválida» si el proveedor lo declara', () => {
    expect(classifyHttp(400)).toBe('unexpected')
    expect(classifyHttp(400, [400])).toBe('invalid')
  })
})

describe('KeyProber', () => {
  it('ok: GET con redirect manual, sin cuerpo y con la clave en cabecera', async () => {
    seedAuth({ openai: { type: 'api', key: 'sk-test-abc123' } })
    const { prober, calls } = make(respond(200))
    const r = await prober.test('openai')
    expect(r).toMatchObject({ providerID: 'openai', status: 'ok', httpStatus: 200 })
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]
    expect(url).toBe('https://api.openai.com/v1/models')
    expect(init.method).toBe('GET')
    expect(init.redirect).toBe('manual')
    expect(init.headers.authorization).toBe('Bearer sk-test-abc123')
  })

  it('anthropic usa x-api-key y la versión de la API', async () => {
    seedAuth({ anthropic: { type: 'api', key: 'sk-ant-zzz' } })
    const { prober, calls } = make(respond(200))
    await prober.test('anthropic')
    expect(calls[0][1].headers).toEqual({ 'x-api-key': 'sk-ant-zzz', 'anthropic-version': '2023-06-01' })
  })

  it('la clave de Google va en cabecera y NUNCA en la URL', async () => {
    seedAuth({ google: { type: 'api', key: 'AIzaSyFAKEKEY1234567890' } })
    const { prober, calls } = make(respond(200))
    await prober.test('google')
    const [url, init] = calls[0]
    expect(url).not.toContain('AIza')
    expect(url).not.toContain('key=')
    expect(init.headers['x-goog-api-key']).toBe('AIzaSyFAKEKEY1234567890')
  })

  it('matriz de estados HTTP', async () => {
    seedAuth({ openai: { type: 'api', key: 'sk-x1234567' }, google: { type: 'api', key: 'AIzaxxxx' } })
    const matrix: [string, number, string][] = [
      ['openai', 401, 'invalid'],
      ['openai', 403, 'forbidden'],
      ['openai', 402, 'no-credit'],
      ['openai', 429, 'rate-limited'],
      ['openai', 504, 'timeout'],
      ['openai', 503, 'provider-down'],
      ['openai', 302, 'unexpected'],
      ['openai', 404, 'unexpected'],
      ['google', 400, 'invalid']
    ]
    for (const [id, code, expected] of matrix) {
      const { prober } = make(respond(code))
      expect((await prober.test(id)).status, `${id} ${code}`).toBe(expected)
    }
  })

  it('errores de red de Node y de Chromium: offline sin conexión, unreachable con ella', async () => {
    seedAuth({ openai: { type: 'api', key: 'sk-x1234567' } })
    const nodeErr = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) })
    const errs: unknown[] = [
      nodeErr,
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('x'), { code: 'EAI_AGAIN' }),
      new TypeError('net::ERR_INTERNET_DISCONNECTED'),
      new TypeError('net::ERR_NAME_NOT_RESOLVED'),
      new TypeError('net::ERR_CONNECTION_REFUSED'),
      new TypeError('net::ERR_TIMED_OUT'),
      new TypeError('net::ERR_PROXY_CONNECTION_FAILED'),
      new TypeError('net::ERR_CERT_AUTHORITY_INVALID')
    ]
    for (const e of errs) {
      const online = make(() => Promise.reject(e))
      expect((await online.prober.test('openai')).status, String(e)).toBe('unreachable')
      const off = make(() => Promise.reject(e), { isOnline: () => false })
      expect((await off.prober.test('openai')).status, String(e)).toBe('offline')
    }
    expect((await make(() => Promise.reject(new Error('algo raro'))).prober.test('openai')).status).toBe('unexpected')
  })

  it('timeout: aborta la petición que no responde', async () => {
    seedAuth({ openai: { type: 'api', key: 'sk-x1234567' } })
    const { prober } = make(
      (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError')))),
      { timeoutMs: 20 }
    )
    expect((await prober.test('openai')).status).toBe('timeout')
  })

  it('not-stored, oauth y unsupported no hacen ninguna petición', async () => {
    seedAuth({ anthropic: { type: 'oauth', access: 'a', refresh: 'b', expires: 1 }, 'opencode-go': { type: 'api', key: 'sk-go-123456' } })
    const { prober, calls } = make(respond(200))
    expect((await prober.test('openai')).status).toBe('not-stored')
    expect((await prober.test('anthropic')).status).toBe('oauth')
    // opencode-go: su listado es público, daría un falso «funciona».
    expect((await prober.test('opencode-go')).status).toBe('unsupported')
    expect(calls).toHaveLength(0)
    expect(PROBES['opencode-go']).toBeUndefined()
    expect(PROBES.opencode).toBeUndefined()
  })

  it('sin auth.json: not-stored', async () => {
    const { prober } = make(respond(200))
    expect((await prober.test('openai')).status).toBe('not-stored')
  })

  it('una clave con saltos de línea ni se envía', async () => {
    seedAuth({ openai: { type: 'api', key: 'sk-abc\r\nX-Evil: 1' } })
    const { prober, calls } = make(respond(200))
    expect((await prober.test('openai')).status).toBe('invalid')
    expect(calls).toHaveLength(0)
  })

  it('genérico: openai-compatible con api https → GET {api}/models con Bearer', async () => {
    seedAuth({ acme: { type: 'api', key: 'acme-key-123456' } })
    const { prober, calls } = make(respond(200), {
      providerMeta: async () => ({ url: 'https://api.acme.example/v1/', npm: '@ai-sdk/openai-compatible' })
    })
    expect((await prober.test('acme')).status).toBe('ok')
    expect(calls[0][0]).toBe('https://api.acme.example/v1/models')
    expect(calls[0][1].headers.authorization).toBe('Bearer acme-key-123456')
  })

  it('genérico: rechaza http, otros paquetes y URLs con credenciales', () => {
    expect(genericProbe({ url: 'http://x.example/v1', npm: '@ai-sdk/openai-compatible' })).toBeNull()
    expect(genericProbe({ url: 'https://x.example/v1', npm: '@ai-sdk/anthropic' })).toBeNull()
    expect(genericProbe({ url: 'https://u:p@x.example/v1', npm: '@ai-sdk/openai-compatible' })).toBeNull()
    expect(genericProbe({ url: 'no es url', npm: '@ai-sdk/openai-compatible' })).toBeNull()
    expect(genericProbe(null)).toBeNull()
  })

  it('un intento por proveedor a la vez y 5 s mínimos entre pruebas', async () => {
    seedAuth({ openai: { type: 'api', key: 'sk-x1234567' }, groq: { type: 'api', key: 'gsk_x1234567' } })
    let release: (r: ProbeResponse) => void = () => undefined
    let now = 1000
    const prober = new KeyProber({
      userData,
      fetch: () => new Promise((res) => (release = res)),
      isOnline: () => true,
      now: () => now
    })
    const first = prober.test('openai')
    await expect(prober.test('openai')).rejects.toBeInstanceOf(KeyProbeBusyError)
    release({ status: 200 })
    await first
    now += 4000
    await expect(prober.test('openai')).rejects.toBeInstanceOf(KeyProbeBusyError)
    now += 1500
    const again = prober.test('openai')
    release({ status: 200 })
    expect((await again).status).toBe('ok')
    // Otro proveedor no se ve afectado.
    const other = prober.test('groq')
    release({ status: 200 })
    expect((await other).status).toBe('ok')
  })

  it('baseOverride (solo E2E) sustituye el origen y conserva la ruta', async () => {
    seedAuth({ openai: { type: 'api', key: 'sk-x1234567' } })
    const { prober, calls } = make(respond(200), { baseOverride: 'http://127.0.0.1:4444' })
    await prober.test('openai')
    expect(calls[0][0]).toBe('http://127.0.0.1:4444/v1/models')
  })

  it('propiedad: con claves aleatorias, ni el resultado ni console.* contienen la clave', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
    try {
      for (let i = 0; i < 60; i++) {
        const key = `sk-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
        seedAuth({ openai: { type: 'api', key }, google: { type: 'api', key: `AIza${key}` } })
        const codes = [200, 401, 403, 429, 503]
        for (const id of ['openai', 'google']) {
          const k = id === 'openai' ? key : `AIza${key}`
          const hostile = i % 2 === 0
          // El error ajeno lleva la clave a propósito: el resultado no puede arrastrarla.
          const { prober } = make(
            hostile
              ? () => Promise.reject(new TypeError(`net::ERR_FAILED https://x/?key=${k} Bearer ${k}`))
              : respond(codes[i % codes.length])
          )
          const r = await prober.test(id)
          expect(JSON.stringify(r)).not.toContain(k)
          expect(JSON.stringify(r)).not.toContain(key)
        }
      }
      for (const s of spies) expect(s).not.toHaveBeenCalled()
    } finally {
      for (const s of spies) s.mockRestore()
    }
  })
})

describe('ONYXCODE_E2E_KEY_PROBE_BASE (solo pruebas)', () => {
  it('se honra sin empaquetar y solo con http://127.0.0.1:<puerto>', () => {
    const env = (v: string): Record<string, string> => ({ ONYXCODE_E2E_KEY_PROBE_BASE: v })
    expect(resolveE2eKeyProbeBase({ isPackaged: false, env: env('http://127.0.0.1:5555') })).toBe('http://127.0.0.1:5555')
    for (const bad of [
      'http://localhost:5555',
      'https://127.0.0.1:5555',
      'http://127.0.0.1',
      'http://127.0.0.1:5555/x',
      'http://evil.example:80',
      'http://127.0.0.1.evil.com:80'
    ])
      expect(resolveE2eKeyProbeBase({ isPackaged: false, env: env(bad) }), bad).toBeNull()
    expect(resolveE2eKeyProbeBase({ isPackaged: false, env: {} })).toBeNull()
  })
  it('empaquetada: se ignora siempre', () => {
    expect(resolveE2eKeyProbeBase({ isPackaged: true, env: { ONYXCODE_E2E_KEY_PROBE_BASE: 'http://127.0.0.1:5555' } })).toBeNull()
  })
  it('guardia estática: solo key-probe.ts la lee y lo hace bajo !isPackaged', () => {
    const root = resolve(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const f = join(d, n)
        if (statSync(f).isDirectory()) walk(f)
        else if (/\.(ts|tsx)$/.test(n) && !n.endsWith('.test.ts') && readFileSync(f, 'utf8').includes('ONYXCODE_E2E_KEY_PROBE_BASE'))
          hits.push(f)
      }
    }
    walk(root)
    expect(hits.map((h) => h.slice(root.length).replace(/\\/g, '/'))).toEqual(['/main/providers/key-probe.ts'])
    expect(readFileSync(hits[0], 'utf8')).toMatch(/const base = !i\.isPackaged \? i\.env\.ONYXCODE_E2E_KEY_PROBE_BASE : undefined/)
  })
})
