// Tests del servidor de autenticación falso: `node --test e2e/fake-auth/server.test.mjs`
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { createFakeAuth } from './server.mjs'

let clock = 1_800_000_000_000
const fake = createFakeAuth({ now: () => clock })
const addr = await fake.listen(0, '127.0.0.1')
const base = `http://127.0.0.1:${addr.port}`
after(() => fake.close())
beforeEach(async () => {
  clock = 1_800_000_000_000
  await ctl('POST', 'reset')
})

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers }
}
const ctl = (method, path, body) => call(method, `/__e2e/${path}`, body)
const bearer = (t) => ({ authorization: `Bearer ${t}` })

async function loginByEmail(email = 'ana@example.test') {
  await call('POST', '/v1/auth/email/start', { email })
  const { data } = await ctl('GET', `last-code?email=${encodeURIComponent(email)}`)
  const r = await call('POST', '/v1/auth/email/verify', { email, code: data.code })
  assert.equal(r.status, 200)
  return r.data
}

/** Receptor loopback mínimo que captura la redirección de Google. */
async function loopback() {
  const hits = []
  const srv = http.createServer((req, res) => {
    hits.push(req.url)
    res.end('ok')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  return { redirectUri: `http://127.0.0.1:${port}/callback`, hits, close: () => new Promise((r) => (srv.closeAllConnections(), srv.close(r))) }
}

test('email/start responde 202 uniforme (cuenta nueva o existente) y valida el formato', async () => {
  const a = await call('POST', '/v1/auth/email/start', { email: 'nuevo@example.test' })
  assert.equal(a.status, 202)
  await loginByEmail('ya@example.test')
  const b = await call('POST', '/v1/auth/email/start', { email: 'ya@example.test' })
  assert.equal(b.status, 202)
  assert.deepEqual(b.data, a.data)
  assert.equal((await call('POST', '/v1/auth/email/start', { email: 'x' })).status, 400)
})

test('flujo de correo: código correcto entrega sesión; /me la reconoce', async () => {
  const s = await loginByEmail()
  assert.equal(s.provider, 'email')
  assert.equal(s.email, 'ana@example.test')
  assert.match(s.token, /^[A-Za-z0-9_-]{43}$/)
  const me = await call('GET', '/v1/me', undefined, bearer(s.token))
  assert.equal(me.status, 200)
  assert.equal(me.data.email, 'ana@example.test')
})

test('código incorrecto: 401; a los 5 intentos: 429; el código se gasta al acertar', async () => {
  await call('POST', '/v1/auth/email/start', { email: 'a@example.test' })
  const { data } = await ctl('GET', 'last-code?email=a@example.test')
  const wrong = data.code === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/v1/auth/email/verify', { email: 'a@example.test', code: wrong })).status, 401)
  assert.equal((await call('POST', '/v1/auth/email/verify', { email: 'a@example.test', code: data.code })).status, 429)
  await call('POST', '/v1/auth/email/start', { email: 'b@example.test' })
  const b = await ctl('GET', 'last-code?email=b@example.test')
  assert.equal((await call('POST', '/v1/auth/email/verify', { email: 'b@example.test', code: b.data.code })).status, 200)
  assert.equal((await call('POST', '/v1/auth/email/verify', { email: 'b@example.test', code: b.data.code })).status, 401)
})

test('el código caduca a los 10 minutos', async () => {
  await call('POST', '/v1/auth/email/start', { email: 'a@example.test' })
  const { data } = await ctl('GET', 'last-code?email=a@example.test')
  clock += 10 * 60 * 1000 + 1
  assert.equal((await call('POST', '/v1/auth/email/verify', { email: 'a@example.test', code: data.code })).status, 401)
})

test('límite de envíos por correo: 429 con Retry-After', async () => {
  await ctl('POST', 'set', { emailLimit: 2 })
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', '/v1/auth/email/start', { email: 'a@example.test' })).status, 202)
  const r = await call('POST', '/v1/auth/email/start', { email: 'a@example.test' })
  assert.equal(r.status, 429)
  assert.equal(r.headers.get('retry-after'), '3600')
})

test('POST/DELETE con cabecera Origin se rechazan (403); no hay CORS', async () => {
  const r = await call('POST', '/v1/auth/email/start', { email: 'a@example.test' }, { origin: 'https://evil.example' })
  assert.equal(r.status, 403)
  const s = await loginByEmail()
  assert.equal((await call('DELETE', '/v1/me', undefined, { ...bearer(s.token), origin: 'https://evil.example' })).status, 403)
  const o = await call('OPTIONS', '/v1/me', undefined, { origin: 'https://x.example', 'access-control-request-method': 'GET' })
  assert.equal(o.status, 404)
  assert.equal(o.headers.get('access-control-allow-origin'), null)
})

test('Google automático: start redirige al loopback con code de un solo uso y exchange comprueba PKCE', async () => {
  const lb = await loopback()
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(24))
  const start = await call('POST', '/v1/auth/google/start', { redirect_uri: lb.redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256' })
  assert.equal(start.status, 200)
  assert.match(start.data.auth_url, /^http:\/\/127\.0\.0\.1:\d+\/__fake_google/)
  for (let i = 0; i < 50 && lb.hits.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(lb.hits.length, 1)
  const u = new URL(lb.hits[0], 'http://127.0.0.1')
  assert.equal(u.pathname, '/callback')
  assert.equal(u.searchParams.get('state'), state)
  const code = u.searchParams.get('code')
  // verifier equivocado: rechazado y el código queda gastado
  assert.equal((await call('POST', '/v1/auth/exchange', { code, code_verifier: 'x'.repeat(43), redirect_uri: lb.redirectUri })).status, 401)
  assert.equal((await call('POST', '/v1/auth/exchange', { code, code_verifier: verifier, redirect_uri: lb.redirectUri })).status, 401)
  await lb.close()
})

test('exchange correcto: sesión de Google; el código no se reutiliza', async () => {
  const lb = await loopback()
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(24))
  await call('POST', '/v1/auth/google/start', { redirect_uri: lb.redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256' })
  for (let i = 0; i < 50 && lb.hits.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
  const code = new URL(lb.hits[0], 'http://127.0.0.1').searchParams.get('code')
  const ok = await call('POST', '/v1/auth/exchange', { code, code_verifier: verifier, redirect_uri: lb.redirectUri })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.provider, 'google')
  assert.equal((await call('POST', '/v1/auth/exchange', { code, code_verifier: verifier, redirect_uri: lb.redirectUri })).status, 401)
  await lb.close()
})

test('google/start: rechaza redirect_uri que no sea loopback o sin S256', async () => {
  const state = 'x'.repeat(32)
  assert.equal((await call('POST', '/v1/auth/google/start', { redirect_uri: 'https://evil.example/callback', state, code_challenge: 'c', code_challenge_method: 'S256' })).status, 400)
  assert.equal((await call('POST', '/v1/auth/google/start', { redirect_uri: 'http://127.0.0.1:5/callback', state, code_challenge: 'c', code_challenge_method: 'plain' })).status, 400)
})

test('modo manual y modo deny de Google', async () => {
  const lb = await loopback()
  await ctl('POST', 'set', { googleMode: 'manual' })
  const state = 'y'.repeat(32)
  await call('POST', '/v1/auth/google/start', { redirect_uri: lb.redirectUri, state, code_challenge: 'c', code_challenge_method: 'S256' })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(lb.hits.length, 0)
  await ctl('POST', 'google-complete', { error: 'access_denied' })
  assert.match(lb.hits[0], /error=access_denied/)
  await ctl('POST', 'set', { googleMode: 'deny' })
  await call('POST', '/v1/auth/google/start', { redirect_uri: lb.redirectUri, state, code_challenge: 'c', code_challenge_method: 'S256' })
  for (let i = 0; i < 50 && lb.hits.length < 2; i++) await new Promise((r) => setTimeout(r, 10))
  assert.match(lb.hits[1], /error=access_denied/)
  await lb.close()
})

test('modos de /me: 401, 410 y caído (conexión cortada)', async () => {
  const s = await loginByEmail()
  await ctl('POST', 'mode', { mode: '401' })
  assert.equal((await call('GET', '/v1/me', undefined, bearer(s.token))).status, 401)
  await ctl('POST', 'mode', { mode: '410' })
  assert.equal((await call('GET', '/v1/me', undefined, bearer(s.token))).status, 410)
  await ctl('POST', 'mode', { mode: 'down' })
  await assert.rejects(call('GET', '/v1/me', undefined, bearer(s.token)))
  await ctl('POST', 'mode', { mode: 'normal' })
  assert.equal((await call('GET', '/v1/me', undefined, bearer(s.token))).status, 200)
  assert.equal((await ctl('POST', 'mode', { mode: 'raro' })).status, 400)
})

test('logout revoca la sesión; expire la invalida; sin token es 401', async () => {
  const s = await loginByEmail()
  assert.equal((await call('POST', '/v1/logout', {}, bearer(s.token))).status, 204)
  assert.equal((await call('GET', '/v1/me', undefined, bearer(s.token))).status, 401)
  const t = await loginByEmail('otro@example.test')
  await ctl('POST', 'expire', { token: t.token })
  assert.equal((await call('GET', '/v1/me', undefined, bearer(t.token))).status, 401)
  assert.equal((await call('GET', '/v1/me')).status, 401)
})

test('DELETE /v1/me borra la cuenta: la sesión queda inválida y /me cuenta borrada no vuelve a abrir', async () => {
  const s = await loginByEmail()
  assert.equal((await call('DELETE', '/v1/me', undefined, bearer(s.token))).status, 204)
  assert.equal((await call('GET', '/v1/me', undefined, bearer(s.token))).status, 401)
  const st = await ctl('GET', 'state')
  assert.equal(st.data.users.find((u) => u.email === 'ana@example.test').deleted, true)
})

test('seed crea una sesión válida (con token elegido)', async () => {
  const r = await ctl('POST', 'seed', { email: 'Semilla@Example.test', provider: 'google', token: 'TOKEN-FIJO' })
  assert.equal(r.data.token, 'TOKEN-FIJO')
  const me = await call('GET', '/v1/me', undefined, bearer('TOKEN-FIJO'))
  assert.equal(me.status, 200)
  assert.equal(me.data.provider, 'google')
})

test('requests registra método, ruta, Origin y cookie, y no guarda el token', async () => {
  const s = await loginByEmail()
  await call('GET', '/v1/me', undefined, bearer(s.token))
  const r = await ctl('GET', 'requests?path=/v1/me')
  assert.equal(r.data.length, 1)
  assert.equal(r.data[0].hasAuth, true)
  assert.equal(r.data[0].origin, null)
  assert.equal(r.data[0].cookie, null)
  assert.equal(JSON.stringify(r.data).includes(s.token), false)
})
