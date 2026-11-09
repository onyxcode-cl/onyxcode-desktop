import { describe, expect, it, vi } from 'vitest'
import { EngineTrust, sendTrust } from './engine-trust'

const A = { baseUrl: 'http://127.0.0.1:1111', authorization: 'Basic aaa' }
const B = { baseUrl: 'http://127.0.0.1:2222', authorization: 'Basic bbb' }

type Call = { url: string; method: string; body: { directory: string }; auth: string }

/** Motor falso: guarda las carpetas declaradas por motor; `routes:false` imita a un motor sin `/lazunox/trust`. */
function fakeEngine(o: { routes?: boolean; failFor?: string[] } = {}) {
  const calls: Call[] = []
  const lists = new Map<string, Set<string>>()
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? '{}')) as { directory: string }
    const headers = init?.headers as Record<string, string>
    calls.push({ url, method: init?.method ?? 'GET', body, auth: headers.Authorization! })
    if (o.routes === false) return new Response('{"name":"NotFoundError"}', { status: 404 })
    if (o.failFor?.includes(body.directory)) return new Response('{}', { status: 500 })
    if (body.directory.includes('borrada')) return new Response('{"_tag":"FolderNotFoundError","message":"x"}', { status: 404 })
    const origin = new URL(url).origin
    const set = lists.get(origin) ?? new Set<string>()
    lists.set(origin, set)
    if (init?.method === 'DELETE') set.delete(body.directory)
    else set.add(body.directory)
    return new Response(JSON.stringify({ directory: body.directory, trusted: init?.method !== 'DELETE', changed: true, required: true }), { status: 200 })
  }) as unknown as typeof fetch
  return { calls, lists, fetchImpl }
}

describe('sendTrust', () => {
  it('POST y DELETE a /lazunox/trust con la autorización y el cuerpo JSON', async () => {
    const e = fakeEngine()
    expect(await sendTrust(A, 'POST', '/w/a', e.fetchImpl)).toBe('ok')
    expect(await sendTrust(A, 'DELETE', '/w/a', e.fetchImpl)).toBe('ok')
    expect(e.calls.map((c) => [c.method, c.url, c.body.directory, c.auth])).toEqual([
      ['POST', 'http://127.0.0.1:1111/lazunox/trust', '/w/a', 'Basic aaa'],
      ['DELETE', 'http://127.0.0.1:1111/lazunox/trust', '/w/a', 'Basic aaa']
    ])
  })
  it('distingue «motor sin la ruta» (404 genérico), «carpeta que no existe» y fallos', async () => {
    expect(await sendTrust(A, 'POST', '/w/a', fakeEngine({ routes: false }).fetchImpl)).toBe('unsupported')
    expect(await sendTrust(A, 'POST', '/w/borrada', fakeEngine().fetchImpl)).toBe('missing')
    expect(await sendTrust(A, 'POST', '/w/a', fakeEngine({ failFor: ['/w/a'] }).fetchImpl)).toBe('failed')
    expect(await sendTrust(A, 'POST', '/w/a', (() => Promise.reject(new Error('red caída'))) as unknown as typeof fetch)).toBe('failed')
  })
})

describe('EngineTrust (motor principal)', () => {
  function setup(fe = fakeEngine()) {
    const t = new EngineTrust(fe.fetchImpl)
    let conn = A
    t.bind({ start: async () => conn, peek: () => conn })
    return { t, fe, setConn: (c: typeof A) => (conn = c) }
  }

  it('declara una vez por motor (la segunda llamada no vuelve a pedir)', async () => {
    const { t, fe } = setup()
    expect(await t.declare('/w/a')).toBe('ok')
    expect(await t.declare('/w/a/')).toBe('ok') // la barra final no cuenta
    expect(fe.calls).toHaveLength(1)
  })

  it('llamadas simultáneas a la misma carpeta comparten una sola petición', async () => {
    const { t, fe } = setup()
    await Promise.all([t.declare('/w/a'), t.declare('/w/a'), t.declare('/w/a')])
    expect(fe.calls).toHaveLength(1)
  })

  it('rechaza rutas que no son absolutas y no manda nada', async () => {
    const { t, fe } = setup()
    expect(await t.declare('relativa/x')).toBe('failed')
    expect(await t.declare('')).toBe('failed')
    expect(fe.calls).toHaveLength(0)
  })

  it('«reinicio del motor»: declareAll vuelve a mandar la carpeta del Chat y todas las recordadas al motor nuevo', async () => {
    const { t, fe, setConn } = setup()
    await t.declare('/w/code')
    await t.declare('/w/code-worktrees/rama')
    expect([...fe.lists.get(A.baseUrl)!].sort()).toEqual(['/w/code', '/w/code-worktrees/rama'])
    setConn(B) // el motor nuevo nace con la lista vacía
    const failed = await t.declareAll(B, ['/chat'])
    expect(failed).toEqual([])
    expect([...fe.lists.get(B.baseUrl)!].sort()).toEqual(['/chat', '/w/code', '/w/code-worktrees/rama'])
    // y una carpeta ya declarada en B no se repite
    const before = fe.calls.length
    await t.declare('/w/code')
    expect(fe.calls).toHaveLength(before)
  })

  it('declareAll informa las que fallaron y sigue con las demás', async () => {
    const { t, fe } = setup(fakeEngine({ failFor: ['/w/mala'] }))
    await t.declare('/w/ok')
    await t.declare('/w/mala')
    const failed = await t.declareAll(B, ['/chat'])
    expect(failed).toEqual(['/w/mala'])
    expect(fe.lists.get(B.baseUrl)!.has('/w/ok')).toBe(true)
  })

  it('una carpeta que no pudo declararse se reintenta en la siguiente llamada', async () => {
    let bad = true
    const fe = fakeEngine()
    const real = fe.fetchImpl
    const t = new EngineTrust((async (i: string | URL | Request, init?: RequestInit) => (bad ? new Response('{}', { status: 500 }) : real(i, init))) as typeof fetch)
    t.bind({ start: async () => A, peek: () => A })
    expect(await t.declare('/w/a')).toBe('failed')
    bad = false
    expect(await t.declare('/w/a')).toBe('ok')
    expect(fe.calls).toHaveLength(1)
  })

  it('contra un motor sin la ruta (lazunox.15 u oficial) es inofensivo y no insiste', async () => {
    const { t, fe } = setup(fakeEngine({ routes: false }))
    expect(await t.declare('/w/a')).toBe('unsupported')
    expect(await t.declare('/w/a')).toBe('ok') // ya anotada: no se vuelve a preguntar
    expect(fe.calls).toHaveLength(1)
  })

  it('revoke: manda DELETE, la olvida (ya no se reenvía) y se puede volver a declarar', async () => {
    const { t, fe, setConn } = setup()
    await t.declare('/w/a')
    expect(await t.revoke('/w/a')).toBe('ok')
    expect(fe.calls.at(-1)).toMatchObject({ method: 'DELETE', body: { directory: '/w/a' } })
    expect(fe.lists.get(A.baseUrl)!.has('/w/a')).toBe(false)
    setConn(B)
    await t.declareAll(B, [])
    expect(fe.lists.get(B.baseUrl)?.has('/w/a') ?? false).toBe(false)
    await t.declare('/w/a')
    expect(fe.lists.get(B.baseUrl)!.has('/w/a')).toBe(true)
  })

  it('revoke sin motor en marcha no falla ni arranca nada', async () => {
    const t = new EngineTrust(fakeEngine().fetchImpl)
    const start = vi.fn(async () => A)
    t.bind({ start, peek: () => null })
    expect(await t.revoke('/w/a')).toBe('ok')
    expect(start).not.toHaveBeenCalled()
  })

  it('declare sin motor que arranque devuelve failed pero la recuerda para el próximo arranque', async () => {
    const t = new EngineTrust(fakeEngine().fetchImpl)
    t.bind({ start: async () => Promise.reject(new Error('sin motor')), peek: () => null })
    expect(await t.declare('/w/a')).toBe('failed')
    expect(t.wantedFolders()).toEqual(['/w/a'])
  })

  it('un motor nuevo que reutiliza el MISMO puerto (otra clave) no hereda lo declarado al anterior', async () => {
    const { t, fe } = setup()
    await t.declare('/w/a')
    const reborn = { baseUrl: A.baseUrl, authorization: 'Basic nueva' }
    expect(await t.declareOn(reborn, '/w/a')).toBe('ok')
    expect(fe.calls).toHaveLength(2)
  })

  it('declareOn (motores de Tareas) no recuerda la carpeta para el motor principal', async () => {
    const { t, fe } = setup()
    expect(await t.declareOn(B, '/tarea')).toBe('ok')
    expect(t.wantedFolders()).toEqual([])
    await t.declareAll(A, [])
    expect(fe.lists.get(A.baseUrl)?.has('/tarea') ?? false).toBe(false)
  })
})
