// Tests del OpenCode falso: `node --test e2e/fake-opencode/server.test.mjs`
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createFakeServer } from './server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const AUTH = 'Basic ' + Buffer.from('user:secret').toString('base64')
const DIR = '/work/proj'

const fake = createFakeServer({
  env: { OPENCODE_SERVER_USERNAME: 'user', OPENCODE_SERVER_PASSWORD: 'secret', OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { browser: { type: 'remote', url: 'http://127.0.0.1:1/mcp' } } }), FAKE_OPENCODE_HEARTBEAT_MS: '0' },
  cors: ['onyxcode://app']
})
const addr = await fake.listen(0, '127.0.0.1')
const base = `http://127.0.0.1:${addr.port}`
after(() => fake.close())

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: AUTH, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers }
}
const ctl = (method, path, body) => call(method, `/__e2e/${path}`, body)
const q = (d = DIR) => `directory=${encodeURIComponent(d)}`

/** Lector SSE: acumula sobres `{directory,payload}`. */
async function openSse(path = '/global/event') {
  const ac = new AbortController()
  const res = await fetch(base + path, { headers: { authorization: AUTH }, signal: ac.signal })
  const events = []
  let ended = false
  let waiter = null
  const pump = (async () => {
    const dec = new TextDecoder()
    let buf = ''
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const line = frame.split('\n').find((l) => l.startsWith('data: '))
          if (line) events.push(JSON.parse(line.slice(6)))
          waiter?.()
        }
      }
    } catch {
      /* cortado */
    }
    ended = true
    waiter?.()
  })()
  const until = async (pred, ms = 3000) => {
    const deadline = Date.now() + ms
    while (!pred(events)) {
      if (Date.now() > deadline) throw new Error('timeout esperando eventos: ' + JSON.stringify(events.map((e) => e.payload.type)))
      await new Promise((r) => { waiter = r; setTimeout(r, 50) })
    }
  }
  return { res, events, until, isEnded: () => ended, pump, close: () => ac.abort() }
}
const types = (events) => events.map((e) => e.payload.type).filter((t) => !t.startsWith('server.'))

test('health con auth correcta y 401 sin credenciales o con clave mala', async () => {
  const ok = await call('GET', '/global/health')
  assert.equal(ok.status, 200)
  assert.equal(ok.data.healthy, true)
  assert.match(ok.data.version, /^\d+\.\d+\.\d+/)
  const none = await fetch(base + '/global/health')
  assert.equal(none.status, 401)
  const bad = await fetch(base + '/global/health', { headers: { authorization: 'Basic ' + Buffer.from('user:nope').toString('base64') } })
  assert.equal(bad.status, 401)
  const control = await fetch(base + '/__e2e/status')
  assert.equal(control.status, 401)
})

test('CORS solo para los orígenes de --cors', async () => {
  const pre = await fetch(base + '/session', { method: 'OPTIONS', headers: { origin: 'onyxcode://app', 'access-control-request-method': 'GET' } })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'onyxcode://app')
  const evil = await fetch(base + '/global/health', { headers: { authorization: AUTH, origin: 'http://evil.example' } })
  assert.equal(evil.headers.get('access-control-allow-origin'), null)
})

test('SSE entrega lo inyectado con POST emit (forma {directory,payload})', async () => {
  const s = await openSse()
  await s.until((e) => e.some((x) => x.payload.type === 'server.connected'))
  const r = await ctl('POST', 'emit', { type: 'file.watcher.updated', properties: { file: 'a.ts', event: 'change' }, directory: DIR })
  assert.equal(r.status, 200)
  await s.until((e) => e.some((x) => x.payload.type === 'file.watcher.updated'))
  const ev = s.events.find((x) => x.payload.type === 'file.watcher.updated')
  assert.equal(ev.directory, DIR)
  assert.deepEqual(ev.payload.properties, { file: 'a.ts', event: 'change' })
  assert.match(ev.payload.id, /^evt_\d+$/)
  s.close()
})

test('promptAsync emite la secuencia por defecto en orden, con directory e id incremental', async () => {
  await ctl('POST', 'reset', {})
  const s = await openSse()
  const created = await call('POST', `/session?${q()}`, { title: 'T' })
  assert.equal(created.status, 200)
  const sid = created.data.id
  assert.equal(created.data.directory, DIR)
  const r = await call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'hola mundo' }], model: { providerID: 'fake', modelID: 'fake-model' } })
  assert.equal(r.status, 204)
  await s.until((e) => e.some((x) => x.payload.type === 'session.idle'))
  const seq = types(s.events)
  const idx = (t, from = 0) => seq.indexOf(t, from)
  const iUser = idx('message.updated')
  const iBusy = idx('session.status')
  const iAsst = idx('message.updated', iUser + 1)
  const iDelta = idx('message.part.delta')
  const iIdle = seq.lastIndexOf('session.status')
  assert.ok(seq[0] === 'session.created')
  assert.ok(iUser < iBusy && iBusy < iAsst && iAsst < iDelta && iDelta < iIdle, seq.join(','))
  assert.ok(seq.filter((t) => t === 'message.part.delta').length >= 2)
  const mine = s.events.filter((x) => !x.payload.type.startsWith('server.'))
  assert.ok(mine.every((x) => x.directory === DIR))
  const ids = mine.map((x) => Number(x.payload.id.slice(4)))
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b))
  assert.equal(new Set(ids).size, ids.length)
  const first = s.events.find((x) => x.payload.type === 'message.updated').payload.properties.info
  assert.equal(first.role, 'user')
  const msgs = await call('GET', `/session/${sid}/message?${q()}`)
  assert.equal(msgs.data.length, 2)
  assert.equal(msgs.data[1].info.role, 'assistant')
  assert.equal(msgs.data[1].info.finish, 'stop')
  assert.equal(msgs.data[1].parts[0].text, 'Respuesta simulada: hola mundo')
  const st = await call('GET', `/session/status?${q()}`)
  assert.deepEqual(st.data, {})
  s.close()
})

test('ruta desconocida: 404 y queda en unknownRoutes', async () => {
  await ctl('POST', 'reset', {})
  const r = await call('GET', '/no/existe')
  assert.equal(r.status, 404)
  await call('GET', '/no/existe')
  const u = await ctl('GET', 'unknown-routes')
  assert.equal(u.data.length, 1)
  assert.equal(u.data[0].path, '/no/existe')
  assert.equal(u.data[0].count, 2)
})

test('drop-sse corta el stream y se puede reconectar', async () => {
  const s = await openSse()
  await s.until((e) => e.length > 0)
  const r = await ctl('POST', 'drop-sse', {})
  assert.ok(r.data.dropped >= 1)
  const deadline = Date.now() + 3000
  while (!s.isEnded() && Date.now() < deadline) await new Promise((x) => setTimeout(x, 25))
  assert.ok(s.isEnded(), 'el stream debía terminar')
  const again = await openSse()
  await again.until((e) => e.some((x) => x.payload.type === 'server.connected'))
  again.close()
})

test('script personalizado: modelo, texto, herramienta, permiso, pregunta y error', async () => {
  await ctl('POST', 'reset', {})
  const s = await openSse()
  const sid = (await call('POST', `/session?${q()}`, {})).data.id
  await ctl('POST', 'script', {
    model: { providerID: 'anthropic', modelID: 'fake-claude' },
    steps: [
      { type: 'reasoning', text: 'pienso' },
      { type: 'tool', tool: 'bash', input: { command: 'ls' }, output: 'a\nb' },
      { type: 'permission', permission: 'bash', patterns: ['rm x'], input: { command: 'rm x' } },
      { type: 'question', questions: [{ question: '¿Sigo?', header: 'Sigo', options: [{ label: 'Sí', description: '' }] }] },
      { type: 'text', deltas: ['uno ', 'dos'] }
    ]
  })
  await call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'x' }] })
  await s.until((e) => e.some((x) => x.payload.type === 'permission.asked'))
  const perms = await call('GET', `/permission?${q()}`)
  assert.equal(perms.data.length, 1)
  assert.equal(perms.data[0].permission, 'bash')
  const st = await call('GET', `/session/status?${q()}`)
  assert.equal(st.data[sid].type, 'busy')
  assert.equal((await call('POST', `/permission/${perms.data[0].id}/reply?${q()}`, { reply: 'once' })).data, true)
  await s.until((e) => e.some((x) => x.payload.type === 'question.asked'))
  const qs = await call('GET', `/question?${q()}`)
  assert.equal(qs.data.length, 1)
  await call('POST', `/question/${qs.data[0].id}/reply?${q()}`, { answers: [['Sí']] })
  await s.until((e) => e.some((x) => x.payload.type === 'session.idle'))
  const msgs = (await call('GET', `/session/${sid}/message?${q()}`)).data
  const asst = msgs[1]
  assert.equal(asst.info.providerID, 'anthropic')
  assert.equal(asst.info.modelID, 'fake-claude')
  assert.deepEqual(asst.parts.map((p) => p.type), ['reasoning', 'tool', 'tool', 'tool', 'text'])
  assert.ok(asst.parts.filter((p) => p.type === 'tool').every((p) => p.state.status === 'completed'))
  assert.equal(asst.parts[4].text, 'uno dos')

  // error
  await ctl('POST', 'script', { steps: [{ type: 'error', message: 'boom' }] })
  await call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'y' }] })
  await s.until((e) => e.some((x) => x.payload.type === 'session.error'))
  await s.until((e) => e.filter((x) => x.payload.type === 'session.idle').length === 2)
  const err = s.events.find((x) => x.payload.type === 'session.error')
  assert.equal(err.payload.properties.error.data.message, 'boom')
  s.close()
})

test('modelo de un proveedor no conectado: session.error con ProviderModelNotFoundError y vuelve a idle', async () => {
  await ctl('POST', 'reset', {})
  const s = await openSse()
  const sid = (await call('POST', `/session?${q()}`, { title: 'T' })).data.id
  // `opencode` (gratuito, origen custom) no está conectado por defecto.
  assert.equal((await call('GET', '/config/providers')).data.providers.some((p) => p.id === 'opencode'), false)
  const r = await call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'hola' }], model: { providerID: 'opencode', modelID: 'fake-free-model' } })
  assert.equal(r.status, 204)
  await s.until((e) => e.some((x) => x.payload.type === 'session.idle'))
  const err = s.events.find((x) => x.payload.type === 'session.error').payload.properties.error
  assert.equal(err.name, 'UnknownError')
  assert.match(err.data.message, /^ProviderModelNotFoundError: Model not found: opencode\/fake-free-model\. Did you mean: fake-free-model\?\n\s+at <anonymous>/)
  // Conectado con /__e2e/set, el mismo modelo responde normal.
  await ctl('POST', 'set', { connectedProviders: ['opencode'] })
  assert.ok((await call('GET', '/config/providers')).data.providers.some((p) => p.id === 'opencode' && p.source === 'custom'))
  const ok = await call('POST', `/session/${sid}/message?${q()}`, { parts: [{ type: 'text', text: 'hola' }], model: { providerID: 'opencode', modelID: 'fake-free-model' } })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.parts[0].text, 'Respuesta simulada: hola')
  s.close()
})

test('abort durante un retraso termina la ejecución con MessageAbortedError', async () => {
  await ctl('POST', 'reset', {})
  const s = await openSse()
  const sid = (await call('POST', `/session?${q()}`, {})).data.id
  await ctl('POST', 'script', { steps: [{ type: 'delay', ms: 60000 }, { type: 'text', text: 'nunca' }] })
  await call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'x' }] })
  await s.until((e) => e.some((x) => x.payload.type === 'session.status' && x.payload.properties.status.type === 'busy'))
  assert.equal((await call('POST', `/session/${sid}/abort?${q()}`)).data, true)
  await s.until((e) => e.some((x) => x.payload.type === 'session.idle'))
  const msgs = (await call('GET', `/session/${sid}/message?${q()}`)).data
  assert.equal(msgs[1].info.error.name, 'MessageAbortedError')
  s.close()
})

test('CRUD de sesiones, revert, fork y listados', async () => {
  await ctl('POST', 'reset', {})
  const a = (await call('POST', `/session?${q()}`, { title: 'A' })).data
  const b = (await call('POST', `/session?${q('/otra')}`, { title: 'B' })).data
  const child = (await call('POST', `/session?${q()}`, { title: 'hija', parentID: a.id })).data
  const roots = (await call('GET', `/session?${q()}&roots=true&limit=200`)).data
  assert.deepEqual(roots.map((s) => s.id), [a.id])
  assert.equal((await call('GET', `/session/${a.id}/children`)).data[0].id, child.id)
  // directory por cabecera
  const viaHeader = (await call('POST', '/session', {}, { 'x-opencode-directory': encodeURIComponent('/cab') })).data
  assert.equal(viaHeader.directory, '/cab')
  const upd = (await call('PATCH', `/session/${a.id}?${q()}`, { title: 'A2', time: { archived: 5 } })).data
  assert.equal(upd.title, 'A2')
  assert.equal(upd.time.archived, 5)
  assert.equal((await call('PATCH', `/session/${a.id}?${q()}`, { time: { archived: 0 } })).data.time.archived, undefined)
  await call('POST', `/session/${a.id}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'hola' }] })
  for (let i = 0; i < 100; i++) {
    if ((await call('GET', `/session/${a.id}/message`)).data.length === 2) break
    await new Promise((r) => setTimeout(r, 25))
  }
  await new Promise((r) => setTimeout(r, 30))
  const msgs = (await call('GET', `/session/${a.id}/message`)).data
  const rev = (await call('POST', `/session/${a.id}/revert?${q()}`, { messageID: msgs[0].info.id })).data
  assert.equal(rev.revert.messageID, msgs[0].info.id)
  assert.equal((await call('POST', `/session/${a.id}/unrevert?${q()}`)).data.revert, undefined)
  const fork = (await call('POST', `/session/${a.id}/fork?${q()}`, {})).data
  assert.notEqual(fork.id, a.id)
  const global = (await call('GET', '/experimental/session?limit=50')).data
  assert.ok(global.length >= 4)
  assert.equal((await call('DELETE', `/session/${a.id}?${q()}`)).data, true)
  assert.equal((await call('GET', `/session/${a.id}`)).status, 404)
  assert.equal((await call('GET', `/session/${child.id}`)).status, 404, 'borrar el padre borra las hijas')
  assert.ok(b.id)
})

test('OAuth falso: authorize, callback con código y conexión del proveedor', async () => {
  await ctl('POST', 'reset', {})
  const methods = (await call('GET', '/provider/auth')).data
  assert.deepEqual(methods.openai.map((m) => m.type), ['oauth', 'api'])
  assert.equal(methods.openai[0].label, 'Cuenta (E2E)')
  assert.deepEqual(methods['opencode-go'], [{ type: 'api', label: 'API key' }])
  const authz = (await call('POST', '/provider/openai/oauth/authorize', { method: 0 })).data
  assert.equal(authz.url, 'http://127.0.0.1/fake-oauth/provider/openai')
  assert.equal(authz.method, 'code')
  assert.equal((await call('POST', '/provider/openai/oauth/callback', { method: 0 })).status, 400)
  assert.equal((await call('GET', '/provider')).data.connected.includes('openai'), false)
  assert.equal((await call('POST', '/provider/openai/oauth/callback', { method: 0, code: 'abc' })).data, true)
  assert.ok((await call('GET', '/provider')).data.connected.includes('openai'))
  await call('DELETE', '/auth/openai')
  assert.equal((await call('GET', '/provider')).data.connected.includes('openai'), false)
})

test('requests registra peticiones; providers, mcp, auth y config', async () => {
  await ctl('POST', 'reset', {})
  await call('GET', `/session/status?${q()}`)
  const reqs = (await ctl('GET', 'requests?limit=5')).data
  const last = reqs[reqs.length - 1]
  assert.equal(last.method, 'GET')
  assert.equal(last.path, '/session/status')
  assert.equal(last.directory, DIR)
  const prov = (await call('GET', '/config/providers')).data
  assert.ok(prov.providers.some((p) => p.id === 'fake'))
  assert.equal(prov.providers.some((p) => p.id === 'anthropic'), false)
  assert.equal((await call('PUT', '/auth/anthropic', { type: 'api', key: 'k' })).data, true)
  assert.ok((await call('GET', '/config/providers')).data.providers.some((p) => p.id === 'anthropic'))
  assert.ok((await call('GET', '/provider')).data.connected.includes('anthropic'))
  await call('DELETE', '/auth/anthropic')
  assert.equal((await call('GET', '/provider')).data.connected.includes('anthropic'), false)
  assert.equal((await call('GET', '/mcp')).data.browser.status, 'connected')
  await call('POST', '/mcp/browser/disconnect')
  assert.equal((await call('GET', '/mcp')).data.browser.status, 'disabled')
  await call('POST', '/global/dispose')
  assert.equal((await call('GET', '/mcp')).data.browser.status, 'connected')
  assert.equal((await call('POST', '/mcp/nope/connect')).status, 404)
  const cfg = (await ctl('GET', 'config')).data
  assert.equal(cfg.content.mcp.browser.type, 'remote')
  assert.ok(cfg.raw.includes('browser'))
  assert.equal((await call('GET', '/config')).data.mcp.browser.type, 'remote')
})

// --- proceso real: argumentos, auth por entorno, --version ---

function launch(args, env = {}) {
  const child = spawn(join(here, 'opencode'), args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const ready = new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
      const m = /listening on (http:\/\/\S+)/.exec(out)
      if (m) resolve(m[1])
    })
    child.once('exit', (c) => reject(new Error('salió con ' + c)))
  })
  return { child, ready }
}

test('CLI: --version, flags desconocidos ignorados, auth y config desde el entorno', async () => {
  const v = spawn(join(here, 'opencode'), ['--version'])
  let out = ''
  v.stdout.on('data', (d) => (out += d))
  await new Promise((r) => v.once('exit', r))
  assert.match(out.trim(), /^\d+\.\d+\.\d+/)

  const cfg = JSON.stringify({ mcp: { browser: { type: 'remote', url: 'http://x/mcp' } } })
  const { child, ready } = launch(['serve', '--port', '0', '--hostname', '127.0.0.1', '--cors', 'http://localhost:5173', '--print-logs', '--foo=bar'], {
    OPENCODE_SERVER_USERNAME: 'onyxcode',
    OPENCODE_SERVER_PASSWORD: 'pw',
    OPENCODE_CONFIG_CONTENT: cfg
  })
  try {
    const url = await ready
    assert.equal((await fetch(url + '/global/health')).status, 401)
    const auth = 'Basic ' + Buffer.from('onyxcode:pw').toString('base64')
    const h = await fetch(url + '/global/health', { headers: { authorization: auth } })
    assert.equal(h.status, 200)
    const c = await (await fetch(url + '/__e2e/config', { headers: { authorization: auth } })).json()
    assert.equal(c.raw, cfg)
    const pre = await fetch(url + '/session', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } })
    assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  } finally {
    child.kill('SIGTERM')
    await new Promise((r) => child.once('exit', r))
  }
})

test('credenciales: OPENCODE_AUTH_CONTENT sustituye al auth.json, PUT /auth escribe el fichero y /__e2e/env no expone valores', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const xdg = mkdtempSync(join(tmpdir(), 'fake-auth-'))
  const file = join(xdg, 'opencode', 'auth.json')
  const start = async (extra) => {
    const f = createFakeServer({ env: { OPENCODE_SERVER_USERNAME: 'user', OPENCODE_SERVER_PASSWORD: 'secret', FAKE_OPENCODE_HEARTBEAT_MS: '0', XDG_DATA_HOME: xdg, ...extra }, cors: [] })
    const a = await f.listen(0, '127.0.0.1')
    const get = async (path) => (await fetch(`http://127.0.0.1:${a.port}${path}`, { headers: { authorization: AUTH } })).json()
    return { f, a, get }
  }
  try {
    // 1) sin fichero ni contenido: nada
    let s = await start({})
    assert.deepEqual((await s.get('/__e2e/status')).authProviders, [])
    const env0 = await s.get('/__e2e/env')
    assert.equal(env0.xdgDataHome, xdg)
    assert.deepEqual(env0.authContent.providers, [])
    // 2) PUT /auth escribe el fichero
    const put = await fetch(`http://127.0.0.1:${s.a.port}/auth/opencode-go`, { method: 'PUT', headers: { authorization: AUTH, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'api', key: 'k-real' }) })
    assert.equal(put.status, 200)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'opencode-go': { type: 'api', key: 'k-real' } })
    await s.f.close()
    // 3) al arrancar lee el fichero
    s = await start({})
    assert.deepEqual((await s.get('/__e2e/status')).authProviders, ['opencode-go'])
    await s.f.close()
    // 4) AUTH_CONTENT sustituye (no mezcla) y /__e2e/env no revela la clave
    s = await start({ OPENCODE_AUTH_CONTENT: JSON.stringify({ anthropic: { type: 'api', key: 'sandboxed-placeholder-abc' } }) })
    assert.deepEqual((await s.get('/__e2e/status')).authProviders, ['anthropic'])
    const env1 = await s.get('/__e2e/env')
    assert.deepEqual(env1, { xdgDataHome: xdg, authContent: { providers: ['anthropic'], allPlaceholder: true } })
    assert.ok(!JSON.stringify(env1).includes('abc'))
    await s.f.close()
    s = await start({ OPENCODE_AUTH_CONTENT: JSON.stringify({ anthropic: { type: 'api', key: 'real-secret' } }) })
    assert.equal((await s.get('/__e2e/env')).authContent.allPlaceholder, false)
    await s.f.close()
  } finally {
    rmSync(xdg, { recursive: true, force: true })
  }
})

test('paso fs: escribe y borra archivos reales dentro del directorio de la sesión y rechaza salirse', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fake-fs-')))
  const dir = join(root, 'work')
  mkdirSync(dir)
  writeFileSync(join(dir, 'a.txt'), 'uno')
  writeFileSync(join(dir, 'c.txt'), 'cc')
  writeFileSync(join(root, 'fuera.txt'), 'fuera')
  symlinkSync(root, join(dir, 'enlace'))
  try {
    await ctl('POST', 'reset', {})
    const s = await openSse()
    const sid = (await call('POST', `/session?${q(dir)}`, { title: 'fs' })).data.id
    await ctl('POST', 'script', {
      sessionID: sid,
      steps: [
        { type: 'fs', op: 'write', path: 'a.txt', content: 'DOS' },
        { type: 'fs', op: 'write', path: 'sub/b.txt', content: 'nuevo' },
        { type: 'fs', op: 'delete', path: 'c.txt' }
      ]
    })
    await call('POST', `/session/${sid}/prompt_async?${q(dir)}`, { parts: [{ type: 'text', text: 'x' }] })
    await s.until((e) => e.some((x) => x.payload.type === 'session.idle'))
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'DOS')
    assert.equal(readFileSync(join(dir, 'sub', 'b.txt'), 'utf8'), 'nuevo')
    assert.equal(existsSync(join(dir, 'c.txt')), false)

    // Fuera del directorio (ruta con .. o a través de un enlace simbólico): el paso falla y no escribe.
    for (const path of ['../fuera.txt', join(root, 'fuera.txt'), 'enlace/fuera.txt']) {
      await ctl('POST', 'script', { sessionID: sid, steps: [{ type: 'fs', op: 'write', path, content: 'HACK' }] })
      const before = s.events.length
      await call('POST', `/session/${sid}/prompt_async?${q(dir)}`, { parts: [{ type: 'text', text: 'y' }] })
      await s.until((e) => e.slice(before).some((x) => x.payload.type === 'session.idle'))
      const msgs = (await call('GET', `/session/${sid}/message?${q(dir)}`)).data
      assert.match(msgs[msgs.length - 1].info.error?.data?.message ?? '', /fuera del directorio/, path)
      assert.equal(readFileSync(join(root, 'fuera.txt'), 'utf8'), 'fuera', path)
    }
    s.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('las respuestas de permiso con indicaciones quedan en /__e2e/requests', async () => {
  await ctl('POST', 'reset', {})
  const s = await openSse()
  const sid = (await call('POST', `/session?${q()}`, { title: 'perm' })).data.id
  await ctl('POST', 'script', {
    sessionID: sid,
    steps: [{ type: 'permission', permission: 'edit', patterns: ['a.txt'], metadata: { filepath: '/work/proj/a.txt', diff: '@@ -1 +1 @@\n-a\n+b\n' } }]
  })
  await call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'x' }] })
  await s.until((e) => e.some((x) => x.payload.type === 'permission.asked'))
  const perm = (await call('GET', `/permission?${q()}`)).data[0]
  await call('POST', `/permission/${perm.id}/reply?${q()}`, { reply: 'reject', message: 'Usa otro nombre' })
  await s.until((e) => e.some((x) => x.payload.type === 'session.idle'))
  const reqs = (await ctl('GET', 'requests?path=/permission/')).data.filter((r) => r.method === 'POST')
  assert.deepEqual(reqs.map((r) => r.body), [{ reply: 'reject', message: 'Usa otro nombre' }])
  s.close()
})

test('POST /__e2e/log escribe el texto en la salida del proceso', async () => {
  const writes = []
  const orig = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk, ...rest) => {
    writes.push(String(chunk))
    return typeof rest.at(-1) === 'function' ? rest.at(-1)() : true
  }
  try {
    const ok = await ctl('POST', 'log', { stream: 'stderr', text: 'linea de prueba' })
    assert.equal(ok.status, 200)
  } finally {
    process.stderr.write = orig
  }
  assert.ok(writes.some((w) => w === 'linea de prueba\n'))
  const bad = await ctl('POST', 'log', {})
  assert.notEqual(bad.status, 200)
})

test('set failPrompt: prompt_async corta la conexión las N veces pedidas y luego responde', async () => {
  const created = await call('POST', `/session?${q()}`, {})
  const sid = created.data.id
  await ctl('POST', 'set', { failPrompt: 1 })
  await assert.rejects(() => call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'hola' }] }))
  const ok = await call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'hola' }] })
  assert.equal(ok.status, 204)
})
