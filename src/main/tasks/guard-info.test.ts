/**
 * Canal de solo lectura del guardián de subagentes (F8-B208): validación, forma de la respuesta y fail-closed.
 * El motor es un `fetch` simulado que registra cada petición.
 */
import { describe, expect, it } from 'vitest'
import { createGuardInfoHandler, GUARD_MAX_UPSTREAM_BYTES, type GuardServerRef } from './guard-info'

const REF: GuardServerRef = { baseUrl: 'http://127.0.0.1:5000', authorization: 'Basic dGFza3M6eA==', directory: '/Users/x/carpeta' }
const ROOT = 'ses_e9b2cf937ffecoccXvQCgPJPCu'
const KID = 'ses_e9b2ce1f9ffeJllVC0e67AINoy'
const RULES = [{ permission: 'bash', pattern: '*', action: 'deny' }]

interface Call {
  url: string
  auth: string | null
  method: string
}

function engine(routes: Record<string, () => Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, auth: new Headers(init?.headers).get('authorization'), method: init?.method ?? 'GET' })
    const path = new URL(url).pathname
    const r = routes[path]
    return r ? r() : new Response('no', { status: 404 })
  }) as typeof fetch
  return { fetchImpl, calls }
}
const json = (v: unknown, status = 200): Response =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

const sessions = {
  [`/session/${ROOT}`]: () => json({ id: ROOT, agent: 'tasks', title: 'TITULO PRIVADO', permission: RULES, time: { created: 1 } }),
  [`/session/${KID}`]: () => json({ id: KID, parentID: ROOT, agent: 'lazunox-helper', title: 'x', permission: [] }),
  [`/session/${ROOT}/message`]: () =>
    json([
      { info: { role: 'user', agent: 'tasks', time: { created: 1 } }, parts: [{ type: 'text', text: 'CONTENIDO SECRETO' }] },
      { info: { role: 'user', agent: 'build', time: { created: 5 } }, parts: [{ type: 'text', text: 'otro secreto' }] },
      { info: { role: 'assistant', agent: 'general', time: { created: 9 } }, parts: [] }
    ]),
  '/agent': () =>
    json([
      { name: 'tasks', mode: 'primary', prompt: 'PROMPT LARGO', permission: RULES },
      { name: 'roto', permission: [{ permission: 'x', pattern: '*', action: 'quizas' }] },
      { name: 'lazunox-helper', permission: [] }
    ])
}

describe('canal de solo lectura del guardián', () => {
  it('sesión raíz: solo { id, agent, permission }; el agente es el del ÚLTIMO mensaje de usuario y no sale contenido', async () => {
    const e = engine(sessions)
    const h = createGuardInfoHandler({ server: () => REF, fetchImpl: e.fetchImpl })
    const r = await h('/session', new URLSearchParams({ id: ROOT }))
    expect(r).toEqual({ status: 200, body: { id: ROOT, agent: 'build', permission: RULES } })
    expect(JSON.stringify(r.body)).not.toMatch(/SECRETO|secreto|TITULO/)
    // Main consulta al motor de ESA tarea, con su autorización y su carpeta, y solo por GET.
    for (const c of e.calls) {
      expect(c.auth).toBe(REF.authorization)
      expect(c.method).toBe('GET')
      expect(new URL(c.url).searchParams.get('directory')).toBe(REF.directory)
      expect(c.url.startsWith(REF.baseUrl + '/session/')).toBe(true)
    }
  })

  it('sesión hija: agente de la sesión y parentID; sin pedir mensajes', async () => {
    const e = engine(sessions)
    const r = await createGuardInfoHandler({ server: () => REF, fetchImpl: e.fetchImpl })('/session', new URLSearchParams({ id: KID }))
    expect(r).toEqual({ status: 200, body: { id: KID, parentID: ROOT, agent: 'lazunox-helper', permission: [] } })
    expect(e.calls).toHaveLength(1)
  })

  it('agentes: solo { name, permission } válidos', async () => {
    const e = engine(sessions)
    const r = await createGuardInfoHandler({ server: () => REF, fetchImpl: e.fetchImpl })('/agents', new URLSearchParams())
    expect(r).toEqual({
      status: 200,
      body: [
        { name: 'tasks', permission: RULES },
        { name: 'lazunox-helper', permission: [] }
      ]
    })
  })

  it('session malformada, repetida o con claves de más: 400 SIN consultar al motor', async () => {
    const e = engine(sessions)
    const h = createGuardInfoHandler({ server: () => REF, fetchImpl: e.fetchImpl })
    for (const q of [
      '',
      'id=',
      'id=../../config',
      `id=${ROOT}/message`,
      'id=ses_corto',
      `id=${ROOT}%00`,
      `id=${ROOT}&id=${KID}`,
      `id=${ROOT}&directory=/etc`,
      `id=ses_${'a'.repeat(65)}`
    ]) {
      expect((await h('/session', new URLSearchParams(q))).status, q).toBe(400)
    }
    expect((await h('/agents', new URLSearchParams('x=1'))).status).toBe(400)
    expect(e.calls).toHaveLength(0)
  })

  it('sesión inexistente: 404; rutas desconocidas (aprobar, crear, configurar): 404 sin consultar', async () => {
    const e = engine(sessions)
    const h = createGuardInfoHandler({ server: () => REF, fetchImpl: e.fetchImpl })
    expect((await h('/session', new URLSearchParams({ id: 'ses_noexiste1234' }))).status).toBe(404)
    const n = e.calls.length
    for (const p of ['/permission', '/config', '/reply', '/abort', '/']) expect((await h(p, new URLSearchParams())).status).toBe(404)
    expect(e.calls).toHaveLength(n)
  })

  it('fail-closed: servidor no listo (503), motor con error, respuesta ajena, permisos inválidos o demasiado grande (502)', async () => {
    const id = new URLSearchParams({ id: ROOT })
    expect((await createGuardInfoHandler({ server: () => null, fetchImpl: engine(sessions).fetchImpl })('/session', id)).status).toBe(503)
    const cases: Array<Record<string, () => Response>> = [
      { [`/session/${ROOT}`]: () => json({}, 500) },
      { [`/session/${ROOT}`]: () => json({ id: KID, agent: 'tasks' }) },
      { [`/session/${ROOT}`]: () => json({ id: ROOT, agent: 'tasks', permission: [{ permission: 'bash' }] }) },
      { [`/session/${ROOT}`]: () => new Response('no es json', { status: 200 }) },
      {
        [`/session/${ROOT}`]: () =>
          new Response(JSON.stringify({ id: ROOT, agent: 'tasks', pad: 'x'.repeat(GUARD_MAX_UPSTREAM_BYTES) }), { status: 200 })
      }
    ]
    for (const c of cases)
      expect((await createGuardInfoHandler({ server: () => REF, fetchImpl: engine(c).fetchImpl })('/session', id)).status).toBe(502)
    const throwing = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect((await createGuardInfoHandler({ server: () => REF, fetchImpl: throwing })('/agents', new URLSearchParams())).status).toBe(502)
  })

  it('si la lista de mensajes falla o es enorme, queda el agente de la sesión (misma regla que el guardián)', async () => {
    const e = engine({ ...sessions, [`/session/${ROOT}/message`]: () => json({}, 500) })
    const r = await createGuardInfoHandler({ server: () => REF, fetchImpl: e.fetchImpl })('/session', new URLSearchParams({ id: ROOT }))
    expect(r.body).toMatchObject({ agent: 'tasks' })
  })
})
