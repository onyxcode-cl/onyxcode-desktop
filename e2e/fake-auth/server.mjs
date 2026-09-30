#!/usr/bin/env node
/**
 * Servidor de autenticación FALSO y determinista para los E2E de la cuenta (sin red real, sin
 * Google, sin correo). Imita el contrato de docs/CUENTAS-SERVIDOR.md:
 *
 *   POST   /v1/auth/email/start   { email }                         -> 202 siempre (respuesta uniforme)
 *   POST   /v1/auth/email/verify  { email, code }                   -> 200 { token, email, provider, expires_at } | 401 invalid_code | 429
 *   POST   /v1/auth/google/start  { redirect_uri, state, code_challenge, code_challenge_method } -> 200 { auth_url }
 *   POST   /v1/auth/exchange      { code, code_verifier, redirect_uri } -> 200 sesión | 401 (comprueba PKCE S256)
 *   GET    /v1/me                 Bearer                            -> 200 { email, provider, created_at, last_seen } | 401 | 410
 *   POST   /v1/logout             Bearer                            -> 204
 *   DELETE /v1/me                 Bearer                            -> 204
 *
 * Reglas del servidor real que aquí también se aplican: POST/DELETE con cabecera `Origin` -> 403; sin CORS
 * (un OPTIONS no se atiende); los códigos de correo caducan y se bloquean tras 5 intentos.
 *
 * «Google automático»: `google/start` responde con una `auth_url` y, de inmediato, hace la redirección que haría
 * Google: GET `<redirect_uri>?code=<un solo uso>&state=<state>` (el receptor loopback de la app). Modos de Google:
 * `auto` (defecto) | `manual` (no redirige; `POST /__e2e/google-complete`) | `deny` (redirige con error=access_denied).
 *
 * Control (solo 127.0.0.1), prefijo /__e2e/:
 *   POST mode         { mode: 'normal'|'down'|'401'|'410' }  -> `down`: corta TODA conexión a /v1 (servidor caído);
 *                     `401`/`410`: /v1/me responde ese estado (sesión revocada / cuenta borrada)
 *   POST set          { googleMode?, googleEmail?, emailLimit? }
 *   GET  last-code    ?email=<correo>  (sin email: el último emitido)  -> { code, email }
 *   POST seed         { email, provider?, token? }  -> { token }  (crea usuario y sesión válida)
 *   POST expire       { token }  -> la sesión pasa a revocada (401)
 *   POST google-complete { error? }  -> completa a mano el último google/start (modo manual)
 *   GET  requests     ?path=<prefijo>&method=  -> lista de peticiones recibidas (sin valores secretos: token/código aparecen
 *                     solo como `hasAuth`, `origin`, `cookie`, y el cuerpo con `code`/`code_verifier` tal cual, es un falso)
 *   GET  state        resumen
 *   POST reset        vuelve al estado inicial
 */
import http from 'node:http'
import { createHash, randomBytes, randomInt } from 'node:crypto'

const SESSION_MS = 90 * 24 * 60 * 60 * 1000
const CODE_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const s256 = (v) => b64url(createHash('sha256').update(v, 'ascii').digest())

export function createFakeAuth(options = {}) {
  const now = options.now ?? (() => Date.now())
  let s
  const fresh = () => ({
    mode: 'normal',
    googleMode: 'auto',
    googleEmail: 'google.user@example.test',
    emailLimit: 1000,
    users: new Map(), // email -> { email, provider, createdAt, lastSeen, deleted }
    sessions: new Map(), // token -> { email, provider, expiresAt, revoked }
    codes: new Map(), // email -> { code, expiresAt, attempts }
    starts: new Map(), // email -> nº de envíos
    lastCode: null, // { email, code }
    gcodes: new Map(), // code -> { redirectUri, challenge, state, used }
    lastGoogle: null, // { redirectUri, state, gcode }
    requests: []
  })
  s = fresh()
  let seq = 0

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = ''
      req.on('data', (d) => {
        raw += d
        if (raw.length > 64 * 1024) req.destroy()
      })
      req.on('end', () => {
        if (!raw) return resolve({})
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve(null)
        }
      })
      req.on('error', () => resolve(null))
    })
  const bearer = (req) => {
    const h = req.headers.authorization
    return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null
  }
  const session = (req) => {
    const t = bearer(req)
    const sess = t ? s.sessions.get(t) : null
    if (!sess || sess.revoked || sess.expiresAt <= now()) return null
    return { token: t, sess }
  }
  const createSession = (email, provider) => {
    let u = s.users.get(email)
    if (!u || u.deleted) {
      u = { email, provider, createdAt: now(), lastSeen: now(), deleted: false }
      s.users.set(email, u)
    }
    const token = b64url(randomBytes(32))
    s.sessions.set(token, { email, provider: u.provider, expiresAt: now() + SESSION_MS, revoked: false })
    return { token, email, provider: u.provider, expires_at: new Date(now() + SESSION_MS).toISOString() }
  }

  async function redirectToLoopback(redirectUri, params) {
    const u = new URL(redirectUri)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    try {
      const r = await fetch(u, { redirect: 'manual' })
      await r.arrayBuffer()
    } catch {
      /* el receptor ya no escucha: el resultado lo decide la app */
    }
  }

  async function handleControl(req, res, url) {
    const path = url.pathname.slice('/__e2e/'.length)
    const body = req.method === 'POST' ? ((await readBody(req)) ?? {}) : {}
    if (req.method === 'POST' && path === 'mode') {
      if (!['normal', 'down', '401', '410'].includes(body.mode)) return json(res, 400, { error: 'modo inválido' })
      s.mode = body.mode
      return json(res, 200, { mode: s.mode })
    }
    if (req.method === 'POST' && path === 'set') {
      if (body.googleMode !== undefined) s.googleMode = body.googleMode
      if (body.googleEmail !== undefined) s.googleEmail = body.googleEmail
      if (body.emailLimit !== undefined) s.emailLimit = body.emailLimit
      return json(res, 200, { googleMode: s.googleMode, googleEmail: s.googleEmail, emailLimit: s.emailLimit })
    }
    if (req.method === 'GET' && path === 'last-code') {
      const email = url.searchParams.get('email')
      const c = email ? s.codes.get(email.toLowerCase()) : null
      if (email) return json(res, 200, { email, code: c ? c.code : null })
      return json(res, 200, s.lastCode ?? { email: null, code: null })
    }
    if (req.method === 'POST' && path === 'seed') {
      const email = String(body.email ?? 'seed@example.test').toLowerCase()
      const made = createSession(email, body.provider === 'google' ? 'google' : 'email')
      if (body.token) {
        const sess = s.sessions.get(made.token)
        s.sessions.delete(made.token)
        s.sessions.set(String(body.token), sess)
        made.token = String(body.token)
      }
      return json(res, 200, { token: made.token, email: made.email, provider: made.provider })
    }
    if (req.method === 'POST' && path === 'expire') {
      const sess = s.sessions.get(String(body.token))
      if (sess) sess.revoked = true
      return json(res, 200, { ok: Boolean(sess) })
    }
    if (req.method === 'POST' && path === 'google-complete') {
      const g = s.lastGoogle
      if (!g) return json(res, 409, { error: 'sin google/start pendiente' })
      await redirectToLoopback(g.redirectUri, body.error ? { error: String(body.error), state: g.state } : { code: g.gcode, state: g.state })
      return json(res, 200, { ok: true })
    }
    if (req.method === 'GET' && path === 'requests') {
      const prefix = url.searchParams.get('path') ?? ''
      const method = url.searchParams.get('method')
      return json(
        res,
        200,
        s.requests.filter((r) => r.path.startsWith(prefix) && (!method || r.method === method))
      )
    }
    if (req.method === 'GET' && path === 'state') {
      return json(res, 200, {
        mode: s.mode,
        googleMode: s.googleMode,
        users: [...s.users.values()].map((u) => ({ email: u.email, provider: u.provider, deleted: u.deleted })),
        sessions: [...s.sessions.values()].filter((x) => !x.revoked).length
      })
    }
    if (req.method === 'POST' && path === 'reset') {
      s = fresh()
      return json(res, 200, { ok: true })
    }
    return json(res, 404, { error: 'control desconocido' })
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/__e2e/')) return handleControl(req, res, url)

    const entry = {
      seq: ++seq,
      method: req.method,
      path: url.pathname,
      hasAuth: Boolean(req.headers.authorization),
      origin: req.headers.origin ?? null,
      cookie: req.headers.cookie ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      body: null
    }
    s.requests.push(entry)
    // Servidor caído: la conexión se corta sin respuesta (la app lo ve como «sin red»).
    if (s.mode === 'down') return void req.socket.destroy()
    const mutating = req.method === 'POST' || req.method === 'DELETE'
    // Sin CORS: no hay respuestas a OPTIONS ni cabeceras Access-Control-*.
    if (req.method === 'OPTIONS') return json(res, 404, { error: 'not_found' })
    // Protección CSRF del servidor real: un navegador siempre manda Origin; la app de escritorio, nunca.
    if (mutating && req.headers.origin) return json(res, 403, { error: 'origin_not_allowed' })
    const body = mutating ? await readBody(req) : {}
    if (mutating && body === null) return json(res, 400, { error: 'invalid_json' })
    entry.body = body

    if (req.method === 'POST' && url.pathname === '/v1/auth/email/start') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error: 'invalid_email' })
      const n = (s.starts.get(email) ?? 0) + 1
      s.starts.set(email, n)
      if (n > s.emailLimit) return json(res, 429, { error: 'rate_limited' }, { 'retry-after': '3600' })
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
      s.codes.set(email, { code, expiresAt: now() + CODE_MS, attempts: 0 })
      s.lastCode = { email, code }
      return json(res, 202, { ok: true })
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/email/verify') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const code = typeof body.code === 'string' ? body.code : ''
      if (!/^\d{6}$/.test(code)) return json(res, 400, { error: 'invalid_request' })
      const c = s.codes.get(email)
      if (!c || c.expiresAt <= now()) return json(res, 401, { error: 'invalid_code' })
      if (c.attempts >= MAX_ATTEMPTS) return json(res, 429, { error: 'too_many_attempts' })
      c.attempts++
      if (c.code !== code) return json(res, 401, { error: 'invalid_code' })
      s.codes.delete(email)
      return json(res, 200, createSession(email, 'email'))
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/google/start') {
      const { redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: method } = body
      if (typeof redirectUri !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/callback$/.test(redirectUri)) return json(res, 400, { error: 'invalid_redirect_uri' })
      if (typeof state !== 'string' || state.length < 16 || typeof challenge !== 'string' || method !== 'S256') return json(res, 400, { error: 'invalid_request' })
      const gcode = b64url(randomBytes(24))
      s.gcodes.set(gcode, { redirectUri, challenge, state, used: false })
      s.lastGoogle = { redirectUri, state, gcode }
      const addr = server.address()
      json(res, 200, { auth_url: `http://127.0.0.1:${addr.port}/__fake_google?state=${encodeURIComponent(state)}` })
      if (s.googleMode === 'auto') setTimeout(() => void redirectToLoopback(redirectUri, { code: gcode, state }), 0)
      else if (s.googleMode === 'deny') setTimeout(() => void redirectToLoopback(redirectUri, { error: 'access_denied', state }), 0)
      return
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/exchange') {
      const g = typeof body.code === 'string' ? s.gcodes.get(body.code) : null
      if (!g || g.used) return json(res, 401, { error: 'invalid_code' })
      g.used = true // un solo uso, aunque falle lo demás
      if (body.redirect_uri !== g.redirectUri) return json(res, 401, { error: 'invalid_code' })
      if (typeof body.code_verifier !== 'string' || s256(body.code_verifier) !== g.challenge) return json(res, 401, { error: 'invalid_code' })
      return json(res, 200, createSession(s.googleEmail, 'google'))
    }

    if (url.pathname === '/v1/me' && (req.method === 'GET' || req.method === 'DELETE')) {
      if (req.method === 'GET' && s.mode === '401') return json(res, 401, { error: 'unauthorized' })
      if (req.method === 'GET' && s.mode === '410') return json(res, 410, { error: 'gone' })
      const a = session(req)
      if (!a) return json(res, 401, { error: 'unauthorized' })
      const u = s.users.get(a.sess.email)
      if (!u || u.deleted) return json(res, 410, { error: 'gone' })
      if (req.method === 'DELETE') {
        u.deleted = true
        for (const x of s.sessions.values()) if (x.email === u.email) x.revoked = true
        res.writeHead(204)
        return void res.end()
      }
      u.lastSeen = now()
      return json(res, 200, {
        email: u.email,
        provider: u.provider,
        created_at: new Date(u.createdAt).toISOString(),
        last_seen: new Date(u.lastSeen).toISOString()
      })
    }

    if (req.method === 'POST' && url.pathname === '/v1/logout') {
      const a = session(req)
      if (a) a.sess.revoked = true
      res.writeHead(a ? 204 : 401)
      return void res.end()
    }

    return json(res, 404, { error: 'not_found' })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'internal' })
    })
  })

  return {
    server,
    listen: (port = 0, host = '127.0.0.1') =>
      new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address()))
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}

// CLI: `node server.mjs [puerto]` (imprime la URL).
if (import.meta.url === `file://${process.argv[1]}`) {
  const fake = createFakeAuth()
  const addr = await fake.listen(Number(process.argv[2] ?? 0))
  console.log(`fake-auth escuchando en http://127.0.0.1:${addr.port}`)
}
