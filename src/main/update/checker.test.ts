import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_INTERVAL_MS, type UpdateState } from '@shared/update-check'
import { IDLE_INSTALL } from '@shared/update-install'
import { UpdateChecker, type UpdateCheckerDeps } from './checker'

const T0 = 1_800_000_000_000
const CONFIG = { configured: true, repo: 'o/r', apiBase: 'https://api.github.com', startDelayMs: 8000 }

function release(tag: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ tag_name: tag, html_url: `https://github.com/o/r/releases/tag/${tag}`, draft: false, prerelease: false, ...extra }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

let dir: string
let clock: number
let enabled: boolean
let states: UpdateState[]
let timers: Array<{ fn: () => void; ms: number }>
let fetchMock: ReturnType<typeof vi.fn>

function make(over: Partial<UpdateCheckerDeps> = {}): UpdateChecker {
  return new UpdateChecker({
    fetch: fetchMock as unknown as UpdateCheckerDeps['fetch'],
    now: () => clock,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    currentVersion: '1.0.0',
    config: CONFIG,
    isEnabled: () => enabled,
    stateFile: join(dir, 'update-check.json'),
    onState: (s) => states.push(s),
    ...over
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'upd-'))
  clock = T0
  enabled = true
  states = []
  timers = []
  fetchMock = vi.fn(async () => release('v1.1.0'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('UpdateChecker: instalador', () => {
  it('sin instalador: installable=false e install inactivo', async () => {
    const c = make()
    await c.check(false)
    expect(c.getState()).toMatchObject({ installable: false, install: IDLE_INSTALL })
    expect(c.latestTag()).toBe('v1.1.0')
  })
  it('con instalador: refleja installable y el estado de la descarga; latestTag es null si no hay versión nueva', async () => {
    let ok = true
    const install = { ...IDLE_INSTALL, phase: 'downloading' as const, version: '1.1.0', received: 1, total: 4 }
    const c = make({ installer: { installable: () => ok, install: () => install } })
    expect(c.latestTag()).toBeNull()
    await c.check(false)
    expect(c.getState()).toMatchObject({ installable: true, install })
    ok = false
    expect(c.getState().installable).toBe(false)
    fetchMock.mockResolvedValueOnce(release('v1.0.0'))
    await c.check(true)
    expect(c.latestTag()).toBeNull()
  })
})

describe('UpdateChecker', () => {
  it('sin configurar: 0 llamadas y start no programa nada', async () => {
    const c = make({ config: { ...CONFIG, configured: false } })
    c.start()
    expect(timers).toHaveLength(0)
    const s = await c.check(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s).toMatchObject({ configured: false, available: false })
  })

  it('start programa la comprobación tras startDelayMs', async () => {
    const c = make()
    c.start()
    expect(timers).toEqual([{ fn: expect.any(Function), ms: 8000 }])
    timers[0].fn()
    await vi.waitFor(() => expect(c.getState().available).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ajuste apagado: 0 llamadas', async () => {
    enabled = false
    const s = await make().check(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s).toMatchObject({ enabled: false, available: false })
  })

  it('versión nueva: disponible con URL y lastCheck', async () => {
    const s = await make().check(false)
    expect(s).toMatchObject({
      available: true,
      current: '1.0.0',
      latest: { version: '1.1.0', url: 'https://github.com/o/r/releases/tag/v1.1.0' },
      lastCheck: T0,
      checking: false
    })
    expect(states.at(-1)?.checking).toBe(false)
  })

  it('misma versión o prerelease: sin aviso pero con lastCheck', async () => {
    fetchMock.mockResolvedValueOnce(release('v1.0.0'))
    expect(await make().check(false)).toMatchObject({ available: false, latest: null, lastCheck: T0 })
    clock += CHECK_INTERVAL_MS
    fetchMock.mockResolvedValueOnce(release('v2.0.0', { prerelease: true }))
    const c = make()
    expect(await c.check(false)).toMatchObject({ available: false, latest: null })
  })

  it('menos de 24 h: 0 llamadas; pasadas 24 h, vuelve a consultar', async () => {
    await make().check(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock += CHECK_INTERVAL_MS - 1
    await make().check(false) // nueva instancia = reinicio de la app
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock += 1
    await make().check(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('manual ignora las 24 h', async () => {
    const c = make()
    await c.check(false)
    clock += 1000
    await c.check(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cabeceras y opciones exactas, sin Authorization ni Cookie', async () => {
    await make().check(false)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/o/r/releases/latest')
    expect(init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'OnyxCode/1.0.0'
    })
    const names = Object.keys(init.headers as object).map((k) => k.toLowerCase())
    expect(names).not.toContain('authorization')
    expect(names).not.toContain('cookie')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('429 con retry-after: espera incluso en manual y se persiste', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '7200' } }))
    const c = make()
    const s = await c.check(false)
    expect(s).toMatchObject({ available: false, lastCheck: null })
    expect(JSON.parse(readFileSync(join(dir, 'update-check.json'), 'utf8')).retryAfter).toBe(T0 + 7_200_000)
    clock += 3_600_000
    await c.check(true)
    await make().check(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock += 3_600_000
    await c.check(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('403 sin cabeceras: 1 h', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
    await make().check(false)
    expect(JSON.parse(readFileSync(join(dir, 'update-check.json'), 'utf8')).retryAfter).toBe(T0 + 3_600_000)
  })

  it('404: lastCheck sin aviso', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    expect(await make().check(false)).toMatchObject({ available: false, lastCheck: T0 })
  })

  it('500, red y JSON inválido: retryAfter = ahora + 1 h, sin lastCheck, sin console.error', async () => {
    const err = vi.spyOn(console, 'error')
    for (const r of [
      () => Promise.resolve(new Response('', { status: 500 })),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(new Response('no json', { status: 200 })),
      () => Promise.resolve(new Response('{"x":1}', { status: 200 }))
    ]) {
      fetchMock.mockImplementationOnce(r)
      const c = make({ stateFile: join(dir, `${Math.random()}.json`) })
      const s = await c.check(false)
      expect(s).toMatchObject({ available: false, lastCheck: null })
    }
    expect(err).not.toHaveBeenCalled()
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('', { status: 500 })))
    const c = make()
    await c.check(false)
    expect(JSON.parse(readFileSync(join(dir, 'update-check.json'), 'utf8')).retryAfter).toBe(T0 + 3_600_000)
    await c.check(false)
    expect(fetchMock).toHaveBeenCalledTimes(5) // sin reintento inmediato
  })

  it('rechaza respuestas de más de 256 KB', async () => {
    fetchMock.mockResolvedValueOnce(release('v9.0.0', { body: 'x'.repeat(300 * 1024) }))
    expect(await make().check(false)).toMatchObject({ available: false, latest: null, lastCheck: null })
  })

  it('html_url maliciosa: usa la URL de reserva de github.com', async () => {
    fetchMock.mockResolvedValueOnce(release('v1.1.0', { html_url: 'https://evil.example/x' }))
    const s = await make().check(false)
    expect(s.latest?.url).toBe('https://github.com/o/r/releases/tag/v1.1.0')
  })

  it('reutiliza la comprobación en curso', async () => {
    let resolve!: (r: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)))
    const c = make()
    const a = c.check(false)
    const b = c.check(true)
    expect(a).toBe(b)
    expect(c.getState().checking).toBe(true)
    resolve(release('v1.1.0'))
    await a
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ajuste apagado durante la petición: el resultado se descarta', async () => {
    let resolve!: (r: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)))
    const c = make()
    const p = c.check(false)
    enabled = false
    resolve(release('v9.0.0'))
    await p
    enabled = true
    expect(c.getState()).toMatchObject({ latest: null, available: false, lastCheck: null })
  })

  it('descartada: available=false; una versión mayor la vuelve a mostrar; persiste al reiniciar', async () => {
    const c = make()
    await c.check(false)
    expect(c.dismiss('1.1.0')).toMatchObject({ available: false, dismissed: '1.1.0' })
    clock += CHECK_INTERVAL_MS
    fetchMock.mockResolvedValueOnce(release('v1.1.0'))
    expect(await c.check(false)).toMatchObject({ available: false, latest: { version: '1.1.0' } })
    clock += CHECK_INTERVAL_MS
    fetchMock.mockResolvedValueOnce(release('v1.2.0'))
    expect(await make().check(false)).toMatchObject({ available: true, latest: { version: '1.2.0' }, dismissed: '1.1.0' })
  })

  it('dismiss ignora versiones ilegibles', () => {
    expect(make().dismiss('basura').dismissed).toBeNull()
  })

  it('tolera JSON corrupto o con tipos raros en el fichero de estado', async () => {
    writeFileSync(join(dir, 'update-check.json'), '{no json')
    expect(make().getState()).toMatchObject({ lastCheck: null, dismissed: null })
    writeFileSync(join(dir, 'update-check.json'), JSON.stringify({ lastCheck: 'x', retryAfter: {}, dismissed: '../../x' }))
    expect(make().getState()).toMatchObject({ lastCheck: null, dismissed: null })
    await make().check(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
