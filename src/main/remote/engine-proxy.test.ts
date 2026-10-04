import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MuxError, type DispatchCtx } from '@shared/remote/mux'
import type { AuditInput } from './audit'
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

function make(opts: { confirm?: ConfirmQueue; audit?: (e: AuditInput) => void } = {}): Harness {
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
    audit: opts.audit,
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

  it('prompt: el catálogo de proveedores de ~7 MB (más que el tope de respuestas) sí permite conocer el modelo', async () => {
    const h = make()
    const pad = 'x'.repeat(7 * 1024 * 1024)
    h.engine.handler = async (u) => {
      if (u.pathname === '/provider') return { json: { all: [{ id: 'p', models: { m: {} }, pad }], connected: ['p'], default: {} } }
      if (u.pathname === '/session/ses_1') return { json: { id: 'ses_1', directory: proj } }
      return { status: 204, text: '' }
    }
    const ok = await http(
      h,
      'POST',
      '/session/ses_1/prompt_async',
      { directory: proj },
      { agent: 'build', parts: [{ type: 'text', text: 'hola' }], model: { providerID: 'p', modelID: 'm' } }
    )
    expect(ok.status).toBe(204)
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
    ).toBe('model-unknown:q/z')
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

describe('hallazgo 1: archivos sensibles fuera de /file/content', () => {
  const diffRaw = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-export {}',
    '+export const a = 1',
    'diff --git a/.env b/.env',
    '--- a/.env',
    '+++ b/.env',
    '@@ -1 +1 @@',
    '-TOKEN=viejo',
    '+TOKEN=SECRETO',
    'diff --git a/config/prod.tfvars b/config/prod.tfvars',
    'new file mode 100644',
    '+db_password = "SECRETO"',
    ''
  ].join('\n')

  it('tasks:previewFile rechaza .env, .envrc y un enlace a .env; un archivo normal pasa', async () => {
    const h = make()
    writeFileSync(join(proj, '.envrc'), 'export K=1')
    h.ipc.results['tasks:previewFile'] = { path: 'x', size: 1, kind: 'text', content: 'SECRETO' }
    for (const p of ['.env', '.envrc', 'notas.txt']) {
      const r = await code(h.proxy.call({ ch: 'tasks:previewFile', p: { path: join(proj, p) } }, ctx()))
      expect(r).toEqual({ code: 'forbidden', detail: 'sensitive-file' })
    }
    expect(h.invoked).toHaveLength(0)
    await expect(h.proxy.call({ ch: 'tasks:previewFile', p: { path: join(proj, 'src', 'a.ts') } }, ctx())).resolves.toBeTruthy()
  })

  it('git:diff con path sensible se rechaza (también con ruta absoluta o enlace)', async () => {
    const h = make()
    h.ipc.results['git:diff'] = '+TOKEN=SECRETO'
    for (const p of ['.env', join(proj, '.env'), 'notas.txt']) {
      const r = await code(h.proxy.call({ ch: 'git:diff', p: { cwd: proj, path: p, staged: true } }, ctx()))
      expect(r.detail).toBe('sensitive-file')
    }
    expect(h.invoked).toHaveLength(0)
  })

  it('git:diff sin path quita de la respuesta los bloques de archivos sensibles', async () => {
    const h = make()
    h.ipc.results['git:diff'] = diffRaw
    const out = (await h.proxy.call({ ch: 'git:diff', p: { cwd: proj } }, ctx())) as string
    expect(out).toContain('src/a.ts')
    expect(out).not.toContain('SECRETO')
    expect(out).not.toContain('.env')
    expect(out).not.toContain('tfvars')
  })

  it('GET /vcs/diff, /session/{id}/diff y /file/status filtran por nombre de archivo', async () => {
    const h = make()
    h.engine.handler = async (u) => {
      if (u.pathname === '/session/ses_1') return { json: { id: 'ses_1', directory: proj } }
      if (u.pathname === '/file/status')
        return {
          json: [
            { path: '.env', added: 1, removed: 0, status: 'modified' },
            { path: 'src/a.ts', added: 1, removed: 0, status: 'modified' }
          ]
        }
      return {
        json: [
          { file: '.env', patch: '+TOKEN=SECRETO', additions: 1, deletions: 0 },
          { file: 'infra/prod.tfvars', patch: '+x=SECRETO', additions: 1, deletions: 0 },
          { file: 'src/a.ts', patch: '+ok', additions: 1, deletions: 0 }
        ]
      }
    }
    const names = (b: string): string[] => (JSON.parse(b) as Array<{ file?: string; path?: string }>).map((x) => x.file ?? x.path ?? '')
    expect(names((await http(h, 'GET', '/vcs/diff', { directory: proj, mode: 'git' })).body)).toEqual(['src/a.ts'])
    expect(names((await http(h, 'GET', '/session/ses_1/diff', { directory: proj })).body)).toEqual(['src/a.ts'])
    expect(names((await http(h, 'GET', '/file/status', { directory: proj })).body)).toEqual(['src/a.ts'])
  })

  it('GET /vcs/diff/raw (texto) quita los bloques sensibles', async () => {
    const h = make()
    h.engine.handler = async () => ({ text: diffRaw, type: 'text/plain' })
    const r = await http(h, 'GET', '/vcs/diff/raw', { directory: proj })
    expect(r.body).toContain('src/a.ts')
    expect(r.body).not.toContain('SECRETO')
    expect(r.body).not.toContain('.env')
    h.engine.handler = async () => ({ json: diffRaw })
    const j = await http(h, 'GET', '/vcs/diff/raw', { directory: proj })
    expect(JSON.parse(j.body)).not.toContain('SECRETO')
  })
})

describe('hallazgo 5: el diálogo del permiso muestra qué pide el motor', () => {
  it('POST /permission/.../reply (external_directory) enseña patrones y comando', async () => {
    const shown: string[][] = []
    const q: ConfirmQueue = new ConfirmQueue({
      ui: {
        present: (i) => {
          shown.push(i.detail)
          queueMicrotask(() => q.resolve(i.requestId, false))
        },
        dismiss: () => undefined
      }
    })
    const h = make({ confirm: q })
    h.engine.handler = async (u) => {
      if (u.pathname === '/permission')
        return {
          json: [
            { id: 'per_9', permission: 'external_directory', patterns: ['/Users/x/.ssh/*'], metadata: { command: 'cat ~/.ssh/id_rsa' } }
          ]
        }
      return { json: true }
    }
    await code(http(h, 'POST', '/permission/per_9/reply', { directory: proj }, { reply: 'once' }))
    expect(shown[0]?.join('\n')).toContain('/Users/x/.ssh/*')
    expect(shown[0]?.join('\n')).toContain('cat ~/.ssh/id_rsa')
  })
})

describe('hallazgo 9: canales R sin rutas fuera del ámbito', () => {
  it('settings:get, tasks:trusted:list y tasks:policy salen recortados', async () => {
    const h = make()
    h.ipc.results['settings:get'] = { theme: 'dark', opencodeBin: '/Users/x/bin/opencode', recentFolders: [proj, outside] }
    h.ipc.results['tasks:trusted:list'] = [
      { path: proj, name: 'p', mode: 'full', addedAt: 1 },
      { path: outside, name: 'o', mode: 'full', addedAt: 1 }
    ]
    h.ipc.results['tasks:policy'] = { source: '/Library/Application Support/OnyxCode/managed.json', disableBrowser: true }
    const s = (await h.proxy.call({ ch: 'settings:get', p: undefined }, ctx())) as Record<string, unknown>
    expect(s).toEqual({ theme: 'dark', recentFolders: [proj] })
    expect(await h.proxy.call({ ch: 'tasks:trusted:list', p: undefined }, ctx())).toEqual([
      { path: proj, name: 'p', mode: 'full', addedAt: 1 }
    ])
    expect(await h.proxy.call({ ch: 'tasks:policy', p: undefined }, ctx())).toEqual({ disableBrowser: true })
  })
})

describe('hallazgo 10: acciones M acotadas al ámbito y con rastro', () => {
  it('routines:delete solo de rutinas cuya carpeta está en el ámbito', async () => {
    const h = make()
    h.ipc.results['routines:list'] = [
      { id: 'r_in', folder: proj },
      { id: 'r_out', folder: outside },
      { id: 'r_link', folder: join(proj, 'link') },
      { id: 'r_chat', folder: null }
    ]
    expect((await code(h.proxy.call({ ch: 'routines:delete', p: { id: 'r_out' } }, ctx()))).detail).toBe('out-of-scope')
    expect((await code(h.proxy.call({ ch: 'routines:delete', p: { id: 'r_link' } }, ctx()))).detail).toBe('out-of-scope')
    expect((await code(h.proxy.call({ ch: 'routines:delete', p: { id: 'r_nada' } }, ctx()))).detail).toBe('scope-unknown')
    expect(h.invoked.some((i) => i.ch === 'routines:delete')).toBe(false)
    await h.proxy.call({ ch: 'routines:delete', p: { id: 'r_in' } }, ctx())
    await h.proxy.call({ ch: 'routines:delete', p: { id: 'r_chat' } }, ctx())
    expect(h.invoked.filter((i) => i.ch === 'routines:delete')).toHaveLength(2)
  })

  it('tasks:tasks:forget y tasks:restore:forget solo de tareas de carpetas del ámbito', async () => {
    const h = make()
    h.ipc.results['tasks:tasks:list'] = [
      { sessionId: 's_in', folder: proj },
      { sessionId: 's_out', folder: outside }
    ]
    for (const ch of ['tasks:tasks:forget', 'tasks:restore:forget']) {
      expect((await code(h.proxy.call({ ch, p: { sessionId: 's_out' } }, ctx()))).detail).toBe('out-of-scope')
      expect((await code(h.proxy.call({ ch, p: { sessionId: 's_x' } }, ctx()))).detail).toBe('scope-unknown')
      await h.proxy.call({ ch, p: { sessionId: 's_in' } }, ctx())
    }
    expect(h.invoked.filter((i) => /forget$/.test(i.ch))).toHaveLength(2)
  })

  it('git:createWorktree no se ejecuta', async () => {
    const h = make()
    expect((await code(h.proxy.call({ ch: 'git:createWorktree', p: { cwd: proj, branch: 'b' } }, ctx()))).code).toBe('forbidden')
    expect(h.invoked).toHaveLength(0)
  })

  it('toda acción M ejecutada (IPC y HTTP) queda en la auditoría solo con canal y clase; las R no', async () => {
    const log: AuditInput[] = []
    const h = make({ audit: (e) => log.push(e) })
    h.engine.handler = async (u) => (u.pathname === '/session/ses_1' ? { json: { id: 'ses_1', directory: proj } } : { json: true })
    await h.proxy.call({ ch: 'tasks:removeFolder', p: { folder: proj } }, ctx())
    await h.proxy.call({ ch: 'git:status', p: { cwd: proj } }, ctx())
    await http(h, 'POST', '/session/ses_1/abort', { directory: proj })
    await http(h, 'GET', '/session/ses_1', { directory: proj })
    expect(log.map((e) => [e.kind, e.ch, e.cls])).toEqual([
      ['action-run', 'tasks:removeFolder', 'M'],
      ['action-run', 'POST /session/{sessionID}/abort', 'M']
    ])
    expect(JSON.stringify(log)).not.toContain(proj)
    // Una acción rechazada no se anota como ejecutada.
    await code(h.proxy.call({ ch: 'tasks:removeFolder', p: { folder: outside } }, ctx()))
    expect(log).toHaveLength(2)
  })
})

describe('hallazgo 7: una aprobación, una ejecución, y lo ejecutado es lo aprobado', () => {
  it('dos llamadas D idénticas simultáneas: una sola aprobación ejecuta UNA vez; la otra recibe busy', async () => {
    const h = make({ confirm: approvingConfirm(true) })
    const a = code(h.proxy.call({ ch: 'tasks:grantFullAccess', p: { folder: proj } }, ctx()).then(() => 'ok'))
    const b = h.proxy.call({ ch: 'tasks:grantFullAccess', p: { folder: proj } }, ctx())
    const rb = await code(b)
    expect(rb).toEqual({ code: 'forbidden', detail: 'busy' })
    await a.catch(() => undefined)
    expect(h.invoked.filter((i) => i.ch === 'tasks:grantFullAccess')).toHaveLength(1)
  })

  it('HTTP: dos respuestas de permiso D idénticas simultáneas ejecutan una sola', async () => {
    const h = make({ confirm: approvingConfirm(true) })
    h.engine.handler = async (u) =>
      u.pathname === '/permission' ? { json: [{ id: 'per_7', permission: 'external_directory' }] } : { json: true }
    const mk = () => http(h, 'POST', '/permission/per_7/reply', { directory: proj }, { reply: 'once' })
    const r = await Promise.allSettled([mk(), mk()])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(h.fetched.filter((f) => f.method === 'POST')).toHaveLength(1)
  })

  it('el payload que valida el esquema debe ser el aprobado: si difiere, no se ejecuta', async () => {
    const invoked: string[] = []
    const swap: InvokeFn = async (caller, ch, args) => {
      // Un payload «validado» distinto del enviado (también D y dentro del ámbito): antes la aprobación valía para cualquiera.
      const validated = { ...(args[0] as object), folder: join(proj, 'src') }
      if (!(await caller.authorize(ch, validated))) return { ok: false, code: 'FORBIDDEN', error: 'no' }
      invoked.push(ch)
      return { ok: true, data: null }
    }
    const host = createEngineHost({
      getMain: async () => ({ baseUrl: 'http://127.0.0.1:4999', authorization: AUTH, username: 'opencode', chatDirectory: chat }),
      loadScope: async () => ({ allowedDirs: [proj], chatDirs: [], fullAccessDirs: [] }),
      invoke: swap,
      open: async () => (async function* () {})(),
      confirm: approvingConfirm(true)
    })
    const r = await code(host.createDispatch(DEVICE).call({ ch: 'tasks:grantFullAccess', p: { folder: proj } }, ctx()))
    expect(r.code).toBe('forbidden')
    expect(invoked).toHaveLength(0)
  })
})
