import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MuxError, type DispatchCtx } from '@shared/remote/mux'
import { ConfirmQueue } from './confirm-queue'
import { createEngineHost, createRejectingConfirm, type DeviceDispatch, type RemoteEngineHost } from './engine-host'
import { canonPayload, stripSecretKeys, type InvokeFn } from './engine-proxy'

const DEVICE = { id: 'a'.repeat(32), name: 'iPhone' }

let root: string
let proj: string
let outside: string
let chat: string
let PASS: string
let AUTH: string

interface Harness {
  host: RemoteEngineHost
  proxy: DeviceDispatch
  invoked: Array<{ ch: string; args: unknown[]; senderId: number }>
  fetched: Array<{ url: URL; headers: Record<string, string>; method: string; body?: string }>
  engine: { handler: (u: URL, init: RequestInit) => Promise<{ status?: number; json?: unknown; text?: string; type?: string }> }
  ipc: { results: Record<string, unknown> }
}

function ctx(signal?: AbortSignal): DispatchCtx {
  return { id: 1, signal: signal ?? new AbortController().signal }
}

function approvingConfirm(approve: boolean): ConfirmQueue {
  const q: ConfirmQueue = new ConfirmQueue({
    ui: { present: (i) => queueMicrotask(() => q.resolve(i.requestId, approve)), dismiss: () => undefined }
  })
  return q
}

function make(opts: { confirm?: ConfirmQueue } = {}): Harness {
  const h: Harness = {
    invoked: [],
    fetched: [],
    engine: { handler: async () => ({ status: 200, json: [] }) },
    ipc: { results: {} },
    host: undefined as never,
    proxy: undefined as never
  }
  const invoke: InvokeFn = async (caller, ch, args) => {
    // Como invokeAs: la política se aplica tras validar (aquí el payload ya es el enviado).
    const ok = await caller.authorize(ch, args[0])
    if (!ok) return { ok: false, code: 'FORBIDDEN', error: `Llamada IPC no permitida (${ch})` }
    h.invoked.push({ ch, args, senderId: caller.sender.id })
    if (ch in h.ipc.results) return { ok: true, data: h.ipc.results[ch] }
    return { ok: true, data: null }
  }
  const fetchImpl = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input))
    h.fetched.push({
      url,
      headers: init.headers as Record<string, string>,
      method: String(init.method),
      body: init.body as string | undefined
    })
    const signal = init.signal as AbortSignal | undefined
    const r = await Promise.race([
      h.engine.handler(url, init),
      new Promise<never>((_, rej) => signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
    ])
    const type = r.type ?? 'application/json'
    return new Response(r.text === '' ? null : (r.text ?? JSON.stringify(r.json ?? null)), {
      status: r.status ?? 200,
      headers: { 'content-type': type }
    })
  }) as typeof fetch
  h.host = createEngineHost({
    getMain: async () => ({ baseUrl: 'http://127.0.0.1:4999', authorization: AUTH, username: 'opencode', chatDirectory: chat }),
    loadScope: async () => ({ allowedDirs: [proj], chatDirs: [chat], fullAccessDirs: [] }),
    invoke,
    open: async () => (async function* () {})(),
    confirm: opts.confirm ?? createRejectingConfirm(),
    fetch: fetchImpl
  })
  h.proxy = h.host.createDispatch(DEVICE)
  return h
}

async function code(p: Promise<unknown>): Promise<{ code: string; detail?: string }> {
  try {
    await p
  } catch (e) {
    if (e instanceof MuxError) return { code: e.code, detail: e.detail }
    throw e
  }
  throw new Error('no falló')
}

const http = (h: Harness, method: string, path: string, query: Record<string, string> = {}, body?: unknown, signal?: AbortSignal) =>
  h.proxy.http(
    {
      eng: 'main',
      method: method as 'GET',
      path,
      query,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    },
    ctx(signal)
  ) as Promise<{ status: number; body: string; contentType?: string; encoding?: string }>

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-proxy-')))
  proj = join(root, 'proj')
  outside = join(root, 'outside')
  chat = join(root, 'chat')
  for (const d of [proj, outside, chat, join(proj, 'src')]) mkdirSync(d, { recursive: true })
  writeFileSync(join(proj, '.env'), 'TOKEN=abc')
  writeFileSync(join(proj, 'src', 'a.ts'), 'export {}')
  writeFileSync(join(outside, 'secret.txt'), 'x')
  symlinkSync(outside, join(proj, 'link'))
  symlinkSync(join(proj, '.env'), join(proj, 'notas.txt'))
  PASS = randomBytes(18).toString('base64url')
  AUTH = `Basic ${Buffer.from(`opencode:${PASS}`).toString('base64')}`
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('call (IPC)', () => {
  it('deniega por defecto: canal desconocido, remote:* y X', async () => {
    const h = make()
    expect((await code(h.proxy.call({ ch: 'x:desconocido', p: {} }, ctx()))).code).toBe('forbidden')
    expect((await code(h.proxy.call({ ch: 'remote:stop', p: undefined }, ctx()))).code).toBe('forbidden')
    expect((await code(h.proxy.call({ ch: 'pty:create', p: { cwd: proj } }, ctx()))).code).toBe('forbidden')
    expect((await code(h.proxy.call({ ch: 'mcp:getConfig', p: undefined }, ctx()))).code).toBe('forbidden')
    expect(h.invoked).toHaveLength(0)
  })

  it('una lectura permitida se ejecuta con el remitente virtual (id negativo)', async () => {
    const h = make()
    h.ipc.results['settings:get'] = { theme: 'dark' }
    await expect(h.proxy.call({ ch: 'settings:get', p: undefined }, ctx())).resolves.toEqual({ theme: 'dark' })
    expect(h.invoked[0]?.senderId).toBeLessThan(0)
  })

  it('una carpeta fuera del ámbito se rechaza; dentro se ejecuta', async () => {
    const h = make()
    expect((await code(h.proxy.call({ ch: 'git:status', p: { cwd: outside } }, ctx()))).detail).toBe('out-of-scope')
    await expect(h.proxy.call({ ch: 'git:status', p: { cwd: proj } }, ctx())).resolves.toBeNull()
    expect(h.invoked.map((i) => i.ch)).toEqual(['git:status'])
  })

  it('un enlace simbólico dentro del ámbito que escapa se rechaza', async () => {
    const h = make()
    const r = await code(h.proxy.call({ ch: 'git:status', p: { cwd: join(proj, 'link') } }, ctx()))
    expect(r).toEqual({ code: 'forbidden', detail: 'out-of-scope' })
    expect(h.invoked).toHaveLength(0)
  })

  it('canonPayload: ruta relativa que escapa por un enlace no pasa', () => {
    expect(canonPayload({ cwd: proj, path: 'src/a.ts' }).ok).toBe(true)
    expect(canonPayload({ cwd: proj, path: 'link/secret.txt' }).ok).toBe(false)
    expect(canonPayload({ cwd: proj, paths: ['src/a.ts', 'link'] }).ok).toBe(false)
    expect(canonPayload({ cwd: proj, path: '../outside/secret.txt' }).ok).toBe(false)
    expect((canonPayload({ cwd: join(proj, 'link') }).value as { cwd: string }).cwd).toBe(outside)
  })

  it('una acción D sin interfaz de confirmación se rechaza y NO se ejecuta', async () => {
    const h = make() // respaldo que rechaza
    const r = await code(h.proxy.call({ ch: 'tasks:grantFullAccess', p: { folder: proj } }, ctx()))
    expect(r).toEqual({ code: 'forbidden', detail: 'rejected' })
    expect(h.invoked).toHaveLength(0)
  })

  it('una acción D aprobada en el Mac se ejecuta', async () => {
    const h = make({ confirm: approvingConfirm(true) })
    await h.proxy.call({ ch: 'tasks:grantFullAccess', p: { folder: proj } }, ctx())
    expect(h.invoked.map((i) => i.ch)).toEqual(['tasks:grantFullAccess'])
  })

  it('aprobada pero cancelada mientras esperaba: no se ejecuta', async () => {
    const ctl = new AbortController()
    const q: ConfirmQueue = new ConfirmQueue({
      ui: {
        present: (i) =>
          queueMicrotask(() => {
            ctl.abort()
            q.resolve(i.requestId, true)
          }),
        dismiss: () => undefined
      }
    })
    const h = make({ confirm: q })
    expect((await code(h.proxy.call({ ch: 'tasks:grantFullAccess', p: { folder: proj } }, ctx(ctl.signal)))).code).toBe('cancelled')
    expect(h.invoked).toHaveLength(0)
  })

  it('el payload validado se vuelve a decidir (authorize): un cambio de clase tras validar se rechaza', async () => {
    const h = make()
    // `tasks:start` con fullAccess es D: la llamada original (M) no puede colarse si el validado fuese D.
    const r = await code(h.proxy.call({ ch: 'tasks:start', p: { folder: proj, fullAccess: true } }, ctx()))
    expect(r.code).toBe('forbidden')
  })

  it('reescribe las credenciales de opencode:connection, opencode:restart y tasks:start', async () => {
    const h = make({ confirm: approvingConfirm(true) })
    const conn = { baseUrl: 'http://127.0.0.1:4999', authorization: AUTH, username: 'opencode', chatDirectory: chat, version: '1' }
    h.ipc.results['opencode:connection'] = conn
    h.ipc.results['opencode:restart'] = conn
    h.ipc.results['tasks:start'] = {
      folder: proj,
      baseUrl: 'http://127.0.0.1:5001',
      authorization: AUTH,
      sandboxed: true,
      fullAccess: false,
      computerUse: {}
    }
    const a = (await h.proxy.call({ ch: 'opencode:connection', p: undefined }, ctx())) as typeof conn
    expect(a.baseUrl).toBe('onyx://engine/main')
    expect(a.authorization).toBe('')
    const b = (await h.proxy.call({ ch: 'opencode:restart', p: undefined }, ctx())) as typeof conn
    expect(b).toMatchObject({ baseUrl: 'onyx://engine/main', authorization: '' })
    const t = (await h.proxy.call({ ch: 'tasks:start', p: { folder: proj } }, ctx())) as { baseUrl: string; authorization: string }
    expect(t.baseUrl).toMatch(/^onyx:\/\/engine\/task\/[A-Za-z0-9_-]{16}$/)
    expect(t.authorization).toBe('')
    // El token es estable por carpeta y existe como motor suscribible.
    const eng = t.baseUrl.slice('onyx://engine/'.length)
    expect(h.proxy.allowSub?.(eng)).toBe(true)
    expect(h.proxy.allowSub?.('task/inventado1234')).toBe(false)
    const t2 = (await h.proxy.call({ ch: 'tasks:start', p: { folder: proj } }, ctx())) as { baseUrl: string }
    expect(t2.baseUrl).toBe(t.baseUrl)
  })

  it('app:info sale sin userDataPath', async () => {
    const h = make()
    h.ipc.results['app:info'] = { name: 'OnyxCode', userDataPath: '/Users/x/Library' }
    await expect(h.proxy.call({ ch: 'app:info', p: undefined }, ctx())).resolves.toEqual({ name: 'OnyxCode' })
  })

  it('un error del handler no filtra la contraseña', async () => {
    const h = make()
    const bad: InvokeFn = async () => ({ ok: false, code: 'ERROR', error: `falló con ${PASS}` })
    h.host = createEngineHost({
      getMain: async () => ({ baseUrl: 'http://127.0.0.1:4999', authorization: AUTH, username: 'opencode', chatDirectory: chat }),
      loadScope: async () => ({ allowedDirs: [proj], chatDirs: [], fullAccessDirs: [] }),
      invoke: bad,
      open: async () => (async function* () {})()
    })
    await h.host.registry.resolve('main') // la contraseña ya es conocida
    const r = await code(h.host.createDispatch(DEVICE).call({ ch: 'settings:get', p: undefined }, ctx()))
    expect(r.code).toBe('failed')
    expect(r.detail).not.toContain(PASS)
  })
})

describe('http (motor)', () => {
  const sessions = (): unknown => [
    { id: 'ses_1', directory: proj, title: 'a' },
    { id: 'ses_x', directory: outside, title: 'b' },
    { id: 'ses_c', directory: chat, title: 'c' }
  ]

  it('la contraseña la pone el Mac y no vuelve en la respuesta', async () => {
    const h = make()
    h.engine.handler = async () => ({ json: [{ id: 'ses_1', directory: proj, leak: AUTH, leak2: `pass=${PASS}` }] })
    const r = await http(h, 'GET', '/session', { directory: proj })
    expect(h.fetched[0]?.headers.authorization).toBe(AUTH)
    expect(r.body).not.toContain(PASS)
    expect(r.body).not.toContain(AUTH)
    expect(r.body).not.toContain(Buffer.from(`opencode:${PASS}`).toString('base64'))
  })

  it('deniega por defecto rutas desconocidas y X (config, auth, pty, tui, session.shell)', async () => {
    const h = make()
    for (const [m, p] of [
      ['GET', '/nueva/ruta'],
      ['PATCH', '/config'],
      ['PUT', '/auth/anthropic'],
      ['POST', '/pty'],
      ['POST', '/tui/append-prompt'],
      ['POST', '/session/ses_1/shell'],
      ['POST', '/global/dispose']
    ] as const) {
      expect((await code(http(h, m, p, { directory: proj }, {}))).code).toBe('forbidden')
    }
    expect(h.fetched).toHaveLength(0)
  })

  it('directory fuera del ámbito → forbidden; ausente donde es obligatorio → forbidden', async () => {
    const h = make()
    expect(await code(http(h, 'GET', '/session', { directory: outside }))).toEqual({ code: 'forbidden', detail: 'out-of-scope' })
    expect((await code(http(h, 'GET', '/session'))).code).toBe('forbidden')
    expect((await code(http(h, 'GET', '/session', { directory: 'relativo' }))).code).toBe('forbidden')
    expect(h.fetched).toHaveLength(0)
  })

  it('directory que escapa por un enlace simbólico → forbidden', async () => {
    const h = make()
    expect(await code(http(h, 'GET', '/session', { directory: join(proj, 'link') }))).toEqual({
      code: 'forbidden',
      detail: 'out-of-scope'
    })
    expect(h.fetched).toHaveLength(0)
  })

  it('permission.reply: always rechazado; once de un tipo seguro permitido', async () => {
    const h = make()
    h.engine.handler = async (u) => {
      if (u.pathname === '/session/ses_1') return { json: { id: 'ses_1', directory: proj } }
      if (u.pathname === '/permission') return { json: [{ id: 'per_1', permission: 'edit', sessionID: 'ses_1' }] }
      return { json: true }
    }
    expect(await code(http(h, 'POST', '/permission/per_1/reply', { directory: proj }, { reply: 'always' }))).toEqual({
      code: 'forbidden',
      detail: 'permission-always'
    })
    const ok = await http(h, 'POST', '/permission/per_1/reply', { directory: proj }, { reply: 'once' })
    expect(ok.status).toBe(200)
    expect(h.fetched.at(-1)?.method).toBe('POST')
  })

  it('permission.reply once de external_directory pide confirmar en el Mac y, sin UI, se rechaza', async () => {
    const h = make()
    h.engine.handler = async (u) => {
      if (u.pathname === '/permission') return { json: [{ id: 'per_2', permission: 'external_directory' }] }
      return { json: true }
    }
    const r = await code(http(h, 'POST', '/permission/per_2/reply', { directory: proj }, { reply: 'once' }))
    expect(r).toEqual({ code: 'forbidden', detail: 'rejected' })
    expect(h.fetched.filter((f) => f.method === 'POST')).toHaveLength(0)
  })

  it('sesión desconocida → rechazada', async () => {
    const h = make()
    h.engine.handler = async () => ({ status: 404, json: { error: 'x' } })
    expect(await code(http(h, 'POST', '/session/ses_zzz/abort', { directory: proj }))).toEqual({
      code: 'forbidden',
      detail: 'session-unknown'
    })
  })

  it('una sesión de otro directorio no se puede tocar pasando el directory permitido', async () => {
    const h = make()
    h.engine.handler = async (u) => (u.pathname === '/session/ses_x' ? { json: { id: 'ses_x', directory: outside } } : { json: null })
    // El motor la ve en `outside`: no se aprende (fuera del ámbito) → desconocida.
    expect((await code(http(h, 'POST', '/session/ses_x/abort', { directory: proj }))).code).toBe('forbidden')
  })

  it('GET /experimental/session y /session se filtran por ámbito', async () => {
    const h = make()
    h.engine.handler = async () => ({ json: sessions() })
    const a = await http(h, 'GET', '/experimental/session')
    expect((JSON.parse(a.body) as Array<{ id: string }>).map((s) => s.id).sort()).toEqual(['ses_1', 'ses_c'])
    const b = await http(h, 'GET', '/session', { directory: proj })
    expect((JSON.parse(b.body) as Array<{ id: string }>).map((s) => s.id).sort()).toEqual(['ses_1', 'ses_c'])
  })

  it('GET /file/content rechaza archivos sensibles aunque la política lo permita', async () => {
    const h = make()
    h.engine.handler = async () => ({ json: { type: 'text', content: 'x' } })
    for (const p of ['.env', 'notas.txt' /* enlace a .env */]) {
      expect((await code(http(h, 'GET', '/file/content', { directory: proj, path: p }))).detail).toMatch(/sensitive-file|path-escape/)
    }
    expect(h.fetched).toHaveLength(0)
    const ok = await http(h, 'GET', '/file/content', { directory: proj, path: 'src/a.ts' })
    expect(ok.status).toBe(200)
  })

  it('GET /file/content por un enlace que escapa del directorio → rechazado', async () => {
    const h = make()
    expect((await code(http(h, 'GET', '/file/content', { directory: proj, path: 'link/secret.txt' }))).detail).toBe('path-escape')
    expect((await code(http(h, 'GET', '/file', { directory: proj, path: '../outside' }))).code).toBe('forbidden')
  })

  it('los listados quitan archivos sensibles', async () => {
    const h = make()
    h.engine.handler = async (u) =>
      u.pathname === '/file'
        ? {
            json: [
              { name: '.env', path: '.env', type: 'file' },
              { name: 'a.ts', path: 'src/a.ts', type: 'file' }
            ]
          }
        : u.pathname === '/find/file'
          ? { json: ['.env', 'src/a.ts', 'id_rsa'] }
          : { json: [{ path: { text: '.env' } }, { path: { text: 'src/a.ts' } }] }
    const l = JSON.parse((await http(h, 'GET', '/file', { directory: proj, path: '' })).body) as Array<{ name: string }>
    expect(l.map((x) => x.name)).toEqual(['a.ts'])
    expect(JSON.parse((await http(h, 'GET', '/find/file', { directory: proj, query: 'a' })).body)).toEqual(['src/a.ts'])
    expect(JSON.parse((await http(h, 'GET', '/find', { directory: proj, pattern: 'a' })).body)).toEqual([{ path: { text: 'src/a.ts' } }])
  })

  it('prompt: el model debe estar en provider.list y un file:// por un enlace se rechaza', async () => {
    const h = make()
    h.engine.handler = async (u) => {
      if (u.pathname === '/provider') return { json: { all: [{ id: 'p', models: { m: {} } }], connected: ['p'], default: {} } }
      if (u.pathname === '/session/ses_1') return { json: { id: 'ses_1', directory: proj } }
      return { status: 204, text: '' }
    }
    const base = { agent: 'build', parts: [{ type: 'text', text: 'hola' }] }
    expect(
      (
        await code(
          http(h, 'POST', '/session/ses_1/prompt_async', { directory: proj }, { ...base, model: { providerID: 'q', modelID: 'z' } })
        )
      ).detail
    ).toBe('model-unknown')
    const ok = await http(
      h,
      'POST',
      '/session/ses_1/prompt_async',
      { directory: proj },
      { ...base, model: { providerID: 'p', modelID: 'm' } }
    )
    expect(ok.status).toBe(204)
    const file = (p: string): unknown => ({ ...base, parts: [{ type: 'file', mime: 'text/plain', url: `file://${p}` }] })
    expect(
      (await code(http(h, 'POST', '/session/ses_1/prompt_async', { directory: proj }, file(join(proj, 'link', 'secret.txt'))))).detail
    ).toBe('out-of-scope')
    expect((await code(http(h, 'POST', '/session/ses_1/prompt_async', { directory: proj }, file(join(proj, '.env'))))).detail).toBe(
      'out-of-scope'
    )
    expect((await http(h, 'POST', '/session/ses_1/prompt_async', { directory: proj }, file(join(proj, 'src', 'a.ts')))).status).toBe(204)
  })

  it('/event y /global/event no se sirven por http (el celular usa sub)', async () => {
    const h = make()
    expect((await code(http(h, 'GET', '/global/event'))).code).toBe('unsupported')
    expect((await code(http(h, 'GET', '/event', { directory: proj }))).code).toBe('unsupported')
  })

  it('motor desconocido y cuerpos/respuestas fuera de límite', async () => {
    const h = make()
    expect(
      (await code(h.proxy.http({ eng: 'task/noexiste1234', method: 'GET', path: '/session', query: { directory: proj } }, ctx()))).code
    ).toBe('forbidden')
    const big = 'x'.repeat(13 * 1024 * 1024)
    expect(
      (
        await code(
          h.proxy.http(
            {
              eng: 'main',
              method: 'POST',
              path: '/session',
              query: { directory: proj },
              body: JSON.stringify({ title: big }),
              headers: { 'content-type': 'application/json' }
            },
            ctx()
          )
        )
      ).code
    ).toBe('too-large')
    h.engine.handler = async () => ({ text: JSON.stringify({ a: 'y'.repeat(7 * 1024 * 1024) }) })
    expect((await code(http(h, 'GET', '/session/status', { directory: proj }))).code).toBe('too-large')
  })

  it('cuerpo que no es JSON válido → bad-request', async () => {
    const h = make()
    expect(
      (
        await code(
          h.proxy.http(
            {
              eng: 'main',
              method: 'POST',
              path: '/session',
              query: { directory: proj },
              body: '{no',
              headers: { 'content-type': 'application/json' }
            },
            ctx()
          )
        )
      ).code
    ).toBe('bad-request')
  })

  it('cancelación: el AbortSignal aborta el fetch', async () => {
    const h = make()
    h.engine.handler = () => new Promise(() => undefined)
    const ctl = new AbortController()
    const p = code(http(h, 'GET', '/session/status', { directory: proj }, undefined, ctl.signal))
    await new Promise((r) => setTimeout(r, 20))
    ctl.abort()
    expect((await p).code).toBe('cancelled')
  })

  it('provider.list y config.providers salen sin claves', async () => {
    const h = make()
    h.engine.handler = async () => ({
      json: {
        all: [{ id: 'p', key: 'sk-abc', options: { apiKey: 'sk-zzz', baseURL: 'x', headers: { a: 'b' } }, models: {} }],
        connected: ['p']
      }
    })
    const r = JSON.parse((await http(h, 'GET', '/provider')).body) as { all: Array<Record<string, unknown>> }
    expect(JSON.stringify(r)).not.toMatch(/sk-abc|sk-zzz/)
    expect(stripSecretKeys({ token: 1, ok: 2 })).toEqual({ ok: 2 })
  })

  it('propiedad: con una contraseña aleatoria, nada de lo que sale la contiene (respuestas, errores, conexión)', async () => {
    for (let i = 0; i < 5; i++) {
      PASS = randomBytes(24).toString('base64url')
      AUTH = `Basic ${Buffer.from(`opencode:${PASS}`).toString('base64')}`
      const h = make({ confirm: approvingConfirm(true) })
      const b64 = Buffer.from(`opencode:${PASS}`).toString('base64')
      const out: unknown[] = []
      h.engine.handler = async (u) => ({
        json: { id: 'ses_1', directory: proj, echo: [AUTH, PASS, b64, `opencode:${PASS}`], url: u.href, nested: { deep: `x ${PASS} y` } }
      })
      h.ipc.results['opencode:connection'] = {
        baseUrl: 'http://127.0.0.1:4999',
        authorization: AUTH,
        username: 'opencode',
        chatDirectory: chat
      }
      h.ipc.results['opencode:restart'] = h.ipc.results['opencode:connection']
      h.ipc.results['settings:get'] = { leak: `Authorization: ${AUTH}` }
      for (const ch of ['opencode:connection', 'opencode:restart', 'settings:get'])
        out.push(await h.proxy.call({ ch, p: undefined }, ctx()))
      out.push(await http(h, 'GET', '/session/ses_1', { directory: proj }))
      out.push(await http(h, 'GET', '/session', { directory: proj }))
      for (const o of out) {
        const s = JSON.stringify(o)
        expect(s).not.toContain(PASS)
        expect(s).not.toContain(b64)
        expect(s).not.toContain(AUTH)
      }
    }
  })
})
