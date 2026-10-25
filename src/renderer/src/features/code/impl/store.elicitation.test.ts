/**
 * Formularios de conectores (`mcp.elicitation.*`) en el store de Code: eventos, respuesta (400 deja abierto, 404 quita) y
 * «Detener» cancela los formularios de la conversación detenida y de sus ayudantes (y solo esos). Rutas del motor con `fetch` crudo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, statusBusy, type TraceEvent } from '../../../../../test/fixtures/events'
import type { OcEvent } from '../../../lib/opencode'

const sendNotification = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/notify', () => ({ sendNotification, setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'
const OTHER = '/work/otro'

const fetchMock = vi.fn()

beforeEach(async () => {
  vi.resetModules()
  sendNotification.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const apply = (te: TraceEvent): void => st().applyEvent(te.event, te.directory)

const asked = (id: string, sessionID: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  sessionID,
  server: 'crm',
  message: 'Dato',
  fields: [{ name: 'nombre', type: 'string', required: true, maxLength: 50 }],
  expiresAt: Date.now() + 60_000,
  ...over
})
let n = 0
const ev = (type: string, properties: unknown, directory = D): TraceEvent => ({
  event: { id: `evt_el_${++n}`, type, properties } as unknown as OcEvent,
  directory
})

function install(): { abort: ReturnType<typeof vi.fn> } {
  const abort = vi.fn(() => Promise.resolve({ data: true }))
  useServer.setState({
    client: {
      permission: { reply: vi.fn(), list: () => Promise.resolve({ data: [] }) },
      session: { abort, update: vi.fn(), status: () => Promise.resolve({ data: {} }), list: () => Promise.resolve({ data: [] }) },
      question: { list: () => Promise.resolve({ data: [] }) }
    } as never,
    connection: { baseUrl: 'http://127.0.0.1:4999', authorization: 'Basic abc', chatDirectory: '/chat' } as never
  })
  return { abort }
}

const ok = (body: unknown = true, status = 200): Response => new Response(JSON.stringify(body), { status })

describe('eventos mcp.elicitation.*', () => {
  it('asked: guarda el formulario (saneado), marca la conversación como pendiente y avisa', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('mcp.elicitation.asked', asked('eli_1', 's1', { message: 'Hola\u202E' })))
    expect(Object.keys(st().elicitations)).toEqual(['eli_1'])
    expect(st().elicitations.eli_1.message).toBe('Hola')
    expect(sendNotification).toHaveBeenCalled()
    expect(st().unread.s1).toBeDefined()
  })

  it('un asked mal formado o de un proyecto que no está abierto se ignora', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('mcp.elicitation.asked', { id: 'x' }))
    apply(ev('mcp.elicitation.asked', asked('eli_9', 's_ajena'), OTHER))
    expect(st().elicitations).toEqual({})
  })

  it('replied y rejected(abort/server-cancel) quitan la tarjeta SIN aviso', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('mcp.elicitation.asked', asked('eli_1', 's1')))
    apply(ev('mcp.elicitation.replied', { id: 'eli_1', sessionID: 's1', action: 'accept' }))
    expect(st().elicitations).toEqual({})
    apply(ev('mcp.elicitation.asked', asked('eli_2', 's1')))
    apply(ev('mcp.elicitation.rejected', { id: 'eli_2', sessionID: 's1', reason: 'abort' }))
    apply(ev('mcp.elicitation.asked', asked('eli_3', 's1')))
    apply(ev('mcp.elicitation.rejected', { id: 'eli_3', sessionID: 's1', reason: 'server-cancel' }))
    expect(st().elicitations).toEqual({})
    expect(st().elicitationNotices).toEqual({})
  })

  it('rejected(timeout) con tarjeta abierta la quita y deja un aviso', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('mcp.elicitation.asked', asked('eli_1', 's1')))
    apply(ev('mcp.elicitation.rejected', { id: 'eli_1', sessionID: 's1', reason: 'timeout' }))
    expect(st().elicitations).toEqual({})
    expect(st().elicitationNotices.eli_1).toEqual({ id: 'eli_1', sessionID: 's1', reason: 'timeout' })
    st().dismissElicitationNotice('eli_1')
    expect(st().elicitationNotices).toEqual({})
  })

  it('rejected SIN asked previo (secreto, esquema, ambiguo): aviso informativo, nada de tarjeta; timeout sin tarjeta no avisa', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    for (const reason of ['secret', 'schema', 'ambiguous'] as const)
      apply(ev('mcp.elicitation.rejected', { id: `eli_${reason}`, sessionID: 's1', reason }))
    expect(st().elicitations).toEqual({})
    expect(Object.values(st().elicitationNotices).map((x) => x.reason)).toEqual(['secret', 'schema', 'ambiguous'])
    apply(ev('mcp.elicitation.rejected', { id: 'eli_t', sessionID: 's1', reason: 'timeout' }))
    expect(st().elicitationNotices.eli_t).toBeUndefined()
    // De un proyecto que esta ventana no tiene abierto: nada.
    apply(ev('mcp.elicitation.rejected', { id: 'eli_x', sessionID: 'ajena', reason: 'secret' }, OTHER))
    expect(st().elicitationNotices.eli_x).toBeUndefined()
  })

  it('borrar la conversación borra sus formularios y avisos', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('mcp.elicitation.asked', asked('eli_1', 's1')))
    apply(ev('mcp.elicitation.rejected', { id: 'eli_n', sessionID: 's1', reason: 'secret' }))
    apply(ev('session.deleted', { info: makeSession('s1', D) }))
    expect(st().elicitations).toEqual({})
    expect(st().elicitationNotices).toEqual({})
  })

  it('el formulario cuenta como atención pendiente (insignia del Dock) y como proyecto «vivo»', async () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('mcp.elicitation.asked', asked('eli_1', 's1')))
    const { selectCodeAttentionCount, selectProjectIsLive } = await import('./store')
    expect(selectCodeAttentionCount(st())).toBe(1)
    expect(selectProjectIsLive(st(), D)).toBe(true)
  })
})

describe('replyElicitation (POST /mcp/elicitation/{id}/reply)', () => {
  const open = (): void => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('mcp.elicitation.asked', asked('eli_1', 's1')))
  }

  it('aceptar manda action + content con la autorización y la carpeta de la sesión; al salir bien quita la tarjeta', async () => {
    open()
    fetchMock.mockResolvedValue(ok())
    const res = await st().replyElicitation(st().elicitations.eli_1, 'accept', { nombre: 'Ana' })
    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/mcp/elicitation/eli_1/reply?directory=%2Fwork%2Fcode')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc')
    expect(JSON.parse(init.body as string)).toEqual({ action: 'accept', content: { nombre: 'Ana' } })
    expect(st().elicitations).toEqual({})
  })

  it('400: la tarjeta SIGUE abierta y el resultado trae los motivos', async () => {
    open()
    fetchMock.mockResolvedValue(ok({ errors: [{ campo: 'nombre', motivo: 'ya existe' }] }, 400))
    const res = await st().replyElicitation(st().elicitations.eli_1, 'accept', { nombre: 'Ana' })
    expect(res).toEqual({ ok: false, invalid: [{ campo: 'nombre', motivo: 'ya existe' }] })
    expect(Object.keys(st().elicitations)).toEqual(['eli_1'])
  })

  it('404 (ya no existe): la tarjeta se va; un error de red la deja abierta', async () => {
    open()
    fetchMock.mockRejectedValueOnce(new Error('sin red'))
    expect(await st().replyElicitation(st().elicitations.eli_1, 'decline')).toEqual({ ok: false, error: 'sin red' })
    expect(Object.keys(st().elicitations)).toEqual(['eli_1'])
    fetchMock.mockResolvedValue(ok({}, 404))
    expect(await st().replyElicitation(st().elicitations.eli_1, 'decline')).toEqual({ ok: false, gone: true })
    expect(st().elicitations).toEqual({})
  })
})

describe('Detener (abort) cancela los formularios de la conversación y de sus ayudantes', () => {
  it('cancela los de la raíz y los de su ayudante vivo, no los de otra conversación', async () => {
    const { abort } = install()
    fetchMock.mockImplementation(async () => ok())
    apply(sessionCreated(makeSession('root', D)))
    apply(sessionCreated(makeSession('kid', D, { parentID: 'root' })))
    apply(sessionCreated(makeSession('otra', D)))
    useCode.setState({ activeSessionID: 'root' })
    apply(statusBusy('root', D))
    apply(statusBusy('kid', D))
    apply(ev('mcp.elicitation.asked', asked('eli_root', 'root')))
    apply(ev('mcp.elicitation.asked', asked('eli_kid', 'kid')))
    apply(ev('mcp.elicitation.asked', asked('eli_otra', 'otra')))

    await st().abort()

    const posts = fetchMock.mock.calls.map((c) => ({ url: c[0] as string, body: JSON.parse((c[1] as RequestInit).body as string) }))
    expect(posts.map((p) => p.url.split('/mcp/elicitation/')[1]!.split('/reply')[0]).sort()).toEqual(['eli_kid', 'eli_root'])
    for (const p of posts) expect(p.body).toEqual({ action: 'cancel' }) // cancelar, nunca aceptar ni enviar contenido
    expect(Object.keys(st().elicitations)).toEqual(['eli_otra'])
    // Primero se detiene la ejecución y después se cancelan los formularios.
    expect(abort.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!)
  })

  it('un fallo al cancelar uno no impide cancelar los demás ni rompe el Detener', async () => {
    install()
    fetchMock.mockRejectedValueOnce(new Error('caído')).mockResolvedValue(ok())
    apply(sessionCreated(makeSession('root', D)))
    useCode.setState({ activeSessionID: 'root' })
    apply(statusBusy('root', D))
    apply(ev('mcp.elicitation.asked', asked('eli_a', 'root')))
    apply(ev('mcp.elicitation.asked', asked('eli_b', 'root')))
    await st().abort()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(st().globalError).toBeNull()
  })
})

describe('reconstruir desde el servidor (GET /mcp/elicitation)', () => {
  it('loadSessions trae los formularios pendientes de ese proyecto; si el motor no tiene la ruta, no pasa nada', async () => {
    const { abort: _a } = install()
    void _a
    apply(sessionCreated(makeSession('s1', D)))
    const client = useServer.getState().client as unknown as { session: { list: () => Promise<unknown> } }
    client.session.list = () => Promise.resolve({ data: [makeSession('s1', D)] })
    fetchMock.mockResolvedValue(ok([asked('eli_srv', 's1'), { basura: 1 }]))
    await st().loadSessions(D)
    expect(Object.keys(st().elicitations)).toEqual(['eli_srv'])
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:4999/mcp/elicitation?directory=%2Fwork%2Fcode')
    // Lo que el servidor ya no lista (contestado desde otro cliente) se descarta.
    fetchMock.mockResolvedValue(ok([]))
    await st().loadSessions(D)
    expect(st().elicitations).toEqual({})
    // Motor sin la ruta (404): se conserva lo que haya y no hay error global.
    apply(ev('mcp.elicitation.asked', asked('eli_ev', 's1')))
    fetchMock.mockResolvedValue(ok({}, 404))
    await st().loadSessions(D)
    expect(Object.keys(st().elicitations)).toEqual(['eli_ev'])
    expect(st().globalError).toBeNull()
  })
})
