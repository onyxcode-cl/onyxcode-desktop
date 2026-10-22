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
  cors: ['lazunox://app']
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
  const pre = await fetch(base + '/session', { method: 'OPTIONS', headers: { origin: 'lazunox://app', 'access-control-request-method': 'GET' } })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'lazunox://app')
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
    OPENCODE_SERVER_USERNAME: 'lazunox',
    OPENCODE_SERVER_PASSWORD: 'pw',
    OPENCODE_CONFIG_CONTENT: cfg
  })
  try {
    const url = await ready
    assert.equal((await fetch(url + '/global/health')).status, 401)
    const auth = 'Basic ' + Buffer.from('lazunox:pw').toString('base64')
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

test('guion por modelo (forModel), error de cuota, /instance/dispose y metadata/synthetic de las partes del usuario', async () => {
  await ctl('POST', 'reset', {})
  // El catálogo sigue pequeño y trae el modelo de Go, conectado.
  const prov = (await call('GET', '/provider')).data
  assert.ok(prov.all.length <= 6)
  assert.ok(prov.connected.includes('opencode-go'))
  assert.ok(prov.all.find((p) => p.id === 'opencode-go').models['fake-go-model'])
  assert.ok((await call('GET', '/config/providers')).data.providers.some((p) => p.id === 'opencode-go'))

  await ctl('POST', 'script', {
    scripts: [
      { forModel: 'fake/fake-model', steps: [{ type: 'text', text: 'Respuesta A' }], cost: 0.01 },
      { forModel: 'fake/fake-reasoner', steps: [{ type: 'text', text: 'Respuesta B' }], startDelayMs: 50 },
      { forModel: 'opencode-go/fake-go-model', steps: [{ type: 'error', preset: 'quota' }], sticky: true }
    ]
  })
  const run = async (model) => {
    const sid = (await call('POST', `/session?${q()}`, {})).data.id
    const [providerID, modelID] = model.split('/')
    await call('POST', `/session/${sid}/prompt_async?${q()}`, {
      model: { providerID, modelID },
      parts: [{ type: 'text', text: 'hola', synthetic: true, metadata: { lazunox: { kind: 'element' } } }]
    })
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 20))
      const st = (await call('GET', `/session/status?${q()}`)).data
      const msgs = (await call('GET', `/session/${sid}/message?${q()}`)).data
      if (msgs.length >= 2 && !st[sid]) return msgs
    }
    throw new Error('no terminó')
  }
  // Orden inverso al de los guiones: cada modelo toma el suyo, no el primero de la cola.
  const sse = await openSse()
  await run('opencode-go/fake-go-model')
  await sse.until((e) => e.some((x) => x.payload.type === 'session.error'))
  const qerr = sse.events.find((x) => x.payload.type === 'session.error').payload.properties.error
  assert.equal(qerr.data.statusCode, 429)
  assert.match(qerr.data.message, /token rate limit/i)
  sse.close()
  const b = await run('fake/fake-reasoner')
  assert.equal(b[1].parts.find((p) => p.type === 'text').text, 'Respuesta B')
  const a = await run('fake/fake-model')
  assert.equal(a[1].parts.find((p) => p.type === 'text').text, 'Respuesta A')
  assert.equal(a[1].info.cost, 0.01)
  // metadata y synthetic de la parte del usuario se devuelven tal cual.
  const up = a[0].parts[0]
  assert.equal(up.synthetic, true)
  assert.deepEqual(up.metadata, { lazunox: { kind: 'element' } })
  // El guion de Go es sticky: sigue ahí; los otros dos se consumieron.
  assert.equal((await ctl('GET', 'status')).data.scriptsQueued, 1)

  assert.equal((await call('POST', '/instance/dispose', {})).data, true)
  assert.equal((await ctl('GET', 'status')).data.instanceDisposeCount, 1)
})

// ───────────── subagentes en segundo plano y Code Mode ─────────────

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
/** Sondea hasta que `fn` devuelva algo no vacío. */
async function until(label, fn, ms = 3000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timeout esperando: ' + label)
    await sleepMs(15)
  }
}
const msgsOf = async (sid) => (await call('GET', `/session/${sid}/message?${q()}`)).data
const statusOf = async () => (await call('GET', `/session/status?${q()}`)).data
const childrenOf = async (sid) => (await call('GET', `/session/${sid}/children?${q()}`)).data
/** Crea una sesión padre, encola su guion y la prompta; devuelve su id. */
async function runParent(steps, extra = {}) {
  const sid = (await call('POST', `/session?${q()}`, { title: 'padre' })).data.id
  await ctl('POST', 'script', { steps, ...extra })
  await call('POST', `/session/${sid}/prompt_async?${q()}`, { parts: [{ type: 'text', text: 'lanza' }] })
  return sid
}
const taskPart = (msgs) => msgs.flatMap((m) => m.parts).find((p) => p.type === 'tool' && p.tool === 'task')
const syntheticOf = (msgs) => msgs.filter((m) => m.info.role === 'user').flatMap((m) => m.parts).filter((p) => p.synthetic)

test('task en segundo plano: vuelve de inmediato, el hijo corre aparte y al terminar avisa al padre y despierta un turno', async () => {
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: true })
  const sse = await openSse()
  // Guion del turno de despertar (lo consume el aviso sintético).
  await ctl('POST', 'script', { match: 'Background task', steps: [{ type: 'text', text: 'Resumen tras el aviso' }] })
  const sid = await runParent([
    { type: 'task', background: true, title: 'Buscar', prompt: 'busca cosas', steps: [{ type: 'text', text: 'hallazgos' }] },
    { type: 'text', text: 'lancé el hijo' }
  ])
  await until('padre inactivo', async () => (await msgsOf(sid)).length >= 2 && !(await statusOf())[sid])
  const first = await msgsOf(sid)
  const part = taskPart(first)
  assert.equal(part.state.status, 'completed')
  assert.match(part.state.output, /Background task started/)
  assert.equal(part.state.metadata.background, true)
  const kids = await childrenOf(sid)
  assert.equal(kids.length, 1)
  assert.equal(kids[0].parentID, sid)
  assert.equal(part.state.metadata.sessionId, kids[0].id)
  // El hijo espera su compuerta: ocupado, y el padre sin aviso todavía.
  assert.equal((await statusOf())[kids[0].id]?.type, 'busy')
  assert.equal(syntheticOf(first).length, 0)
  assert.equal((await ctl('GET', 'bg')).data[0].status, 'running')

  await ctl('POST', 'bg-release', { sessionID: kids[0].id })
  await until('aviso en el padre', async () => syntheticOf(await msgsOf(sid)).length === 1)
  await until('turno del padre terminado', async () => {
    const m = await msgsOf(sid)
    return m.filter((x) => x.info.role === 'assistant').length === 2 && !(await statusOf())[sid]
  })
  const after = await msgsOf(sid)
  const note = syntheticOf(after)[0]
  assert.match(note.text, /state: completed/)
  assert.match(note.text, /Background task completed: Buscar/)
  assert.match(note.text, /<task_result>\nhallazgos\n<\/task_result>/)
  assert.equal(after[after.length - 1].parts.find((p) => p.type === 'text').text, 'Resumen tras el aviso')
  // Eventos de la hija llegaron por SSE (creada, mensajes y partes de la hija).
  const evs = sse.events.map((e) => e.payload)
  assert.ok(evs.some((e) => e.type === 'session.created' && e.properties.info.parentID === sid))
  assert.ok(evs.some((e) => e.type === 'message.part.updated' && e.properties.sessionID === kids[0].id))
  assert.ok(evs.some((e) => e.type === 'session.idle' && e.properties.sessionID === kids[0].id))
  const job = (await ctl('GET', 'bg')).data[0]
  assert.equal(job.status, 'completed')
  assert.equal(job.notified, true)
  sse.close()
})

test('retraso del hijo (bg-set delayMs) y abortar al padre NO cancela al hijo en segundo plano', async () => {
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { delayMs: 120, hold: false })
  await ctl('POST', 'script', { match: 'Background task', steps: [{ type: 'text', text: 'ok' }] })
  const sid = await runParent([
    { type: 'task', background: true, title: 'Lento', steps: [{ type: 'text', text: 'listo' }] },
    { type: 'delay', ms: 400 }
  ])
  const kids = await until('hijo creado', async () => {
    const k = await childrenOf(sid)
    return k.length ? k : null
  })
  assert.equal((await call('POST', `/session/${sid}/abort?${q()}`)).data, true)
  await until('padre inactivo', async () => !(await statusOf())[sid])
  // El hijo sigue y termina; el padre recibe el aviso aun habiendo sido abortado.
  await until('aviso', async () => syntheticOf(await msgsOf(sid)).length === 1)
  assert.equal((await ctl('GET', 'bg')).data[0].status, 'completed')
  assert.equal((await childrenOf(sid))[0].id, kids[0].id)
})

test('cancelar al hijo (abort de su sesión) no avisa al padre', async () => {
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: true })
  const sid = await runParent([{ type: 'task', background: true, title: 'Cancelable' }])
  const [kid] = await until('hijo', async () => {
    const k = await childrenOf(sid)
    return k.length ? k : null
  })
  await until('hijo ocupado', async () => (await statusOf())[kid.id]?.type === 'busy')
  assert.equal((await call('POST', `/session/${kid.id}/abort?${q()}`)).data, true)
  await until('trabajo cancelado', async () => (await ctl('GET', 'bg')).data[0].status === 'cancelled')
  await sleepMs(80)
  assert.equal(syntheticOf(await msgsOf(sid)).length, 0)
  assert.equal((await ctl('GET', 'bg')).data[0].notified, false)
  const kidMsgs = await msgsOf(kid.id)
  assert.equal(kidMsgs[kidMsgs.length - 1].info.error.name, 'MessageAbortedError')
})

test('fallo del hijo (failNext y bg-fail): session.error en la hija y aviso de error al padre', async () => {
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { failNext: 1, failMessage: 'boom 1', hold: false, delayMs: 0 })
  const sse = await openSse()
  await ctl('POST', 'script', { match: 'Background task', steps: [{ type: 'text', text: 'visto' }] })
  const sid = await runParent([{ type: 'task', background: true, title: 'Falla' }])
  await until('aviso de error', async () => syntheticOf(await msgsOf(sid)).length === 1)
  const note = syntheticOf(await msgsOf(sid))[0].text
  assert.match(note, /state: error/)
  assert.match(note, /Background task failed: Falla/)
  assert.match(note, /boom 1/)
  const [kid] = await childrenOf(sid)
  await sse.until((e) => e.some((x) => x.payload.type === 'session.error' && x.payload.properties.sessionID === kid.id))
  sse.close()

  // bg-fail sobre un hijo en espera.
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: true, failNext: 0 })
  await ctl('POST', 'script', { match: 'Background task', steps: [{ type: 'text', text: 'visto 2' }] })
  const sid2 = await runParent([{ type: 'task', background: true, title: 'Falla ya' }])
  const [kid2] = await until('hijo 2', async () => {
    const k = await childrenOf(sid2)
    return k.length ? k : null
  })
  assert.equal((await ctl('POST', 'bg-fail', { sessionID: kid2.id, message: 'forzado' })).status, 200)
  await until('aviso 2', async () => syntheticOf(await msgsOf(sid2)).length === 1)
  assert.match(syntheticOf(await msgsOf(sid2))[0].text, /forzado/)
  assert.equal((await ctl('POST', 'bg-fail', { sessionID: 'ses_nope' })).status, 404)
})

test('task en primer plano bloquea al padre; la ruta experimental /background lo manda al fondo', async () => {
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: true })
  await ctl('POST', 'script', { match: 'Background task', steps: [{ type: 'text', text: 'despierto' }] })
  const sid = await runParent([
    { type: 'task', title: 'Bloquea', steps: [{ type: 'text', text: 'resultado largo' }] },
    { type: 'text', text: 'sigo' }
  ])
  const [kid] = await until('hijo', async () => {
    const k = await childrenOf(sid)
    return k.length ? k : null
  })
  await sleepMs(60)
  // Bloqueado: la herramienta sigue en ejecución y el padre ocupado.
  assert.equal(taskPart(await msgsOf(sid)).state.status, 'running')
  assert.equal((await statusOf())[sid]?.type, 'busy')
  const sent = await call('POST', `/experimental/session/${sid}/background?${q()}`)
  assert.equal(sent.status, 200)
  assert.equal(sent.data, true)
  await until('tool completada', async () => taskPart(await msgsOf(sid)).state.status === 'completed')
  assert.match(taskPart(await msgsOf(sid)).state.output, /Background task started/)
  await until('padre inactivo', async () => !(await statusOf())[sid])
  // Sin nada en primer plano la ruta responde false.
  assert.equal((await call('POST', `/experimental/session/${sid}/background?${q()}`)).data, false)
  assert.equal((await call('POST', `/experimental/session/ses_nope/background?${q()}`)).status, 404)
  await ctl('POST', 'bg-release', { sessionID: kid.id })
  await until('aviso', async () => syntheticOf(await msgsOf(sid)).length === 1)
  assert.match(syntheticOf(await msgsOf(sid))[0].text, /resultado largo/)
})

test('task en primer plano: termina solo (sin aviso) y abortar al padre cancela al hijo', async () => {
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: false, delayMs: 40 })
  const sid = await runParent([{ type: 'task', title: 'Corto', steps: [{ type: 'text', text: 'fin' }] }])
  await until('padre inactivo', async () => (await msgsOf(sid)).length >= 2 && !(await statusOf())[sid])
  const part = taskPart(await msgsOf(sid))
  assert.equal(part.state.status, 'completed')
  assert.match(part.state.output, /<task_result>\nfin\n<\/task_result>/)
  assert.equal(syntheticOf(await msgsOf(sid)).length, 0)

  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: true })
  const sid2 = await runParent([{ type: 'task', title: 'Largo' }])
  const [kid] = await until('hijo', async () => {
    const k = await childrenOf(sid2)
    return k.length ? k : null
  })
  await until('hijo ocupado', async () => (await statusOf())[kid.id]?.type === 'busy')
  await call('POST', `/session/${sid2}/abort?${q()}`)
  await until('hijo inactivo', async () => !(await statusOf())[kid.id])
  assert.equal((await ctl('GET', 'bg')).data[0].status, 'cancelled')
  assert.equal(syntheticOf(await msgsOf(sid2)).length, 0)
})

test('los permisos de la hija llegan por permission.asked con su propio sessionID', async () => {
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: false, delayMs: 0 })
  const sid = await runParent([
    { type: 'task', background: true, title: 'Con permiso', steps: [{ type: 'permission', permission: 'bash', patterns: ['rm x'] }, { type: 'text', text: 'hecho' }] }
  ])
  const req = await until('permiso pendiente', async () => (await call('GET', `/permission?${q()}`)).data[0])
  const [kid] = await childrenOf(sid)
  assert.equal(req.sessionID, kid.id)
  await call('POST', `/permission/${req.id}/reply?${q()}`, { reply: 'once' })
  await until('trabajo completado', async () => (await ctl('GET', 'bg')).data[0]?.status === 'completed')
})

test('restart: "lose" pierde el trabajo sin avisar; "resume" lo reanuda y avisa', async () => {
  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: true })
  const sid = await runParent([{ type: 'task', background: true, title: 'Reinicio' }])
  const [kid] = await until('hijo', async () => {
    const k = await childrenOf(sid)
    return k.length ? k : null
  })
  await until('hijo ocupado', async () => (await statusOf())[kid.id]?.type === 'busy')
  const lost = await ctl('POST', 'restart', { mode: 'lose' })
  assert.deepEqual(lost.data.lost, [kid.id])
  await sleepMs(80)
  assert.equal((await ctl('GET', 'bg')).data[0].status, 'cancelled')
  assert.equal((await ctl('GET', 'bg')).data[0].lost, true)
  assert.equal(syntheticOf(await msgsOf(sid)).length, 0)
  assert.equal((await ctl('GET', 'status')).data.restartCount, 1)
  assert.equal((await statusOf())[kid.id], undefined)

  await ctl('POST', 'reset', {})
  await ctl('POST', 'bg-set', { hold: true })
  await ctl('POST', 'script', { match: 'Background task', steps: [{ type: 'text', text: 'tras reinicio' }] })
  const sid2 = await runParent([{ type: 'task', background: true, title: 'Reanuda', steps: [{ type: 'text', text: 'sobrevivió' }] }])
  const [kid2] = await until('hijo 2', async () => {
    const k = await childrenOf(sid2)
    return k.length ? k : null
  })
  const res = await ctl('POST', 'restart', { mode: 'resume' })
  assert.deepEqual(res.data.resumed, [kid2.id])
  await until('hijo reanudado en espera', async () => (await ctl('GET', 'bg')).data[0].waiting)
  await ctl('POST', 'bg-release', { sessionID: kid2.id })
  await until('aviso tras reiniciar', async () => syntheticOf(await msgsOf(sid2)).length === 1)
  assert.match(syntheticOf(await msgsOf(sid2))[0].text, /sobrevivió/)
  assert.equal((await ctl('GET', 'bg')).data[0].generation >= 2, true)
})

test('code_mode: pide permiso por CADA llamada interna (clave MCP) y respeta allow/deny/always/reject', async () => {
  await ctl('POST', 'reset', {})
  const sse = await openSse()
  const calls = [
    { tool: 'github_list_issues', input: { repo: 'a/b' }, output: ['#1'] },
    { tool: 'github_get_issue', input: { n: 1 }, output: { title: 'x' } },
    { tool: 'files_read', output: 'hola' }
  ]
  const sid = await runParent([{ type: 'code_mode', calls, rules: [{ permission: 'files_*', action: 'allow' }] }, { type: 'text', text: 'fin' }])
  const ask1 = await until('permiso 1', async () => (await call('GET', `/permission?${q()}`)).data[0])
  assert.equal(ask1.permission, 'github_list_issues')
  assert.deepEqual(ask1.patterns, ['*'])
  assert.deepEqual(ask1.always, ['*'])
  assert.equal(ask1.sessionID, sid)
  const running = taskLike(await msgsOf(sid))
  assert.equal(running.tool, 'execute')
  assert.match(running.state.input.code, /tools\.github\.list_issues/)
  assert.deepEqual(running.state.metadata.toolCalls.map((t) => [t.tool, t.status]), [['github_list_issues', 'running']])
  assert.equal(ask1.tool.callID, running.callID)
  await call('POST', `/permission/${ask1.id}/reply?${q()}`, { reply: 'once' })
  const ask2 = await until('permiso 2', async () => {
    const l = (await call('GET', `/permission?${q()}`)).data
    return l[0] && l[0].id !== ask1.id ? l[0] : null
  })
  assert.equal(ask2.permission, 'github_get_issue')
  await call('POST', `/permission/${ask2.id}/reply?${q()}`, { reply: 'always' })
  await until('turno terminado', async () => !(await statusOf())[sid] && (await msgsOf(sid)).length >= 2)
  const done = taskLike(await msgsOf(sid))
  assert.equal(done.state.status, 'completed')
  assert.deepEqual(done.state.metadata.toolCalls.map((t) => t.status), ['completed', 'completed', 'completed'])
  assert.deepEqual(JSON.parse(done.state.output), [['#1'], { title: 'x' }, 'hola'])
  // files_read estaba en allow: nunca se preguntó. Solo 2 preguntas en total.
  assert.equal(sse.events.filter((e) => e.payload.type === 'permission.asked').length, 2)

  // «always» recuerda la clave: otra sesión ya no pregunta por github_get_issue.
  const sid2 = await runParent([{ type: 'code_mode', calls: [calls[1]] }])
  await until('sin preguntas', async () => (await msgsOf(sid2)).length >= 2 && !(await statusOf())[sid2])
  assert.equal(taskLike(await msgsOf(sid2)).state.status, 'completed')
  assert.equal(sse.events.filter((e) => e.payload.type === 'permission.asked').length, 2)
  sse.close()
})

const taskLike = (msgs) => msgs.flatMap((m) => m.parts).find((p) => p.type === 'tool' && p.tool === 'execute')

test('code_mode: deny hace la herramienta invisible, reject corta la ejecución y las reglas salen de la config', async () => {
  await ctl('POST', 'reset', {})
  const sse = await openSse()
  // deny por regla del paso: sin permission.asked, error UnknownTool y la 2.ª llamada no corre.
  const sid = await runParent([
    { type: 'code_mode', calls: [{ tool: 'shell_run' }, { tool: 'github_x' }], rules: [{ permission: 'shell_*', action: 'deny' }] }
  ])
  await until('termina', async () => (await msgsOf(sid)).length >= 2 && !(await statusOf())[sid])
  const denied = taskLike(await msgsOf(sid))
  assert.equal(denied.state.status, 'error')
  assert.match(denied.state.error, /UnknownTool: shell_run/)
  assert.deepEqual(denied.state.metadata.toolCalls.map((t) => t.status), ['error'])
  assert.equal(sse.events.filter((e) => e.payload.type === 'permission.asked').length, 0)

  // reject: la ejecución se corta tras la primera llamada.
  const sid2 = await runParent([{ type: 'code_mode', calls: [{ tool: 'a_one' }, { tool: 'a_two' }] }])
  const ask = await until('permiso', async () => (await call('GET', `/permission?${q()}`)).data[0])
  assert.equal(ask.permission, 'a_one')
  await call('POST', `/permission/${ask.id}/reply?${q()}`, { reply: 'reject' })
  await until('termina 2', async () => !(await statusOf())[sid2] && (await msgsOf(sid2)).length >= 2)
  const rej = taskLike(await msgsOf(sid2))
  assert.equal(rej.state.status, 'error')
  assert.match(rej.state.error, /rejected permission/)
  assert.equal(sse.events.filter((e) => e.payload.type === 'permission.asked').length, 1)

  // Reglas de la config (allow para todo b_*): ninguna pregunta; y el patrón más específico posterior gana.
  await ctl('POST', 'set', { config: { permission: { 'b_*': 'allow', b_secret: 'ask' } } })
  const sid3 = await runParent([{ type: 'code_mode', calls: [{ tool: 'b_open' }, { tool: 'b_secret' }] }])
  const ask3 = await until('permiso b_secret', async () => (await call('GET', `/permission?${q()}`)).data[0])
  assert.equal(ask3.permission, 'b_secret')
  await call('POST', `/permission/${ask3.id}/reply?${q()}`, { reply: 'once' })
  await until('termina 3', async () => !(await statusOf())[sid3] && (await msgsOf(sid3)).length >= 2)
  assert.equal(taskLike(await msgsOf(sid3)).state.status, 'completed')
  sse.close()
})

test('code_mode: abortar mientras espera un permiso deja la herramienta en error y sin pendientes', async () => {
  await ctl('POST', 'reset', {})
  const sid = await runParent([{ type: 'code_mode', calls: [{ tool: 'c_one' }] }])
  await until('permiso', async () => (await call('GET', `/permission?${q()}`)).data[0])
  await call('POST', `/session/${sid}/abort?${q()}`)
  await until('sin pendientes', async () => (await call('GET', `/permission?${q()}`)).data.length === 0 && !(await statusOf())[sid])
  assert.equal(taskLike(await msgsOf(sid)).state.status, 'error')
})
