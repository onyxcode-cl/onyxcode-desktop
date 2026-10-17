import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assistantMessage,
  msgUpdated,
  partDelta,
  partUpdated,
  permAsked,
  resetEventIds,
  statusBusy,
  statusIdle,
  textPart
} from '../../../../test/fixtures/events'
import { useServer } from '../../stores/server'
import { compareApi } from './api'
import { fakeCompare, installApi, mkCol, mkManifest } from './testkit'
import {
  applyManifest,
  armModels,
  bootCompare,
  cancelColumn,
  cancelConfirm,
  closeCompare,
  confirmStart,
  ctxKey,
  handleEvent,
  hydrate,
  isArmed,
  isHiddenCompareSession,
  keepColumn,
  maybeInterceptSubmit,
  reduceColumnEvents,
  replyPermission,
  requestCompare,
  resetCompareForTests,
  retryColumn,
  selectRecoverable,
  selectShown,
  useCompare
} from './store'
import { createBuffers, type ConvSlice } from '../../lib/session-reducer'

const WT0 = '/repo-wt/lazunox-compare-0'
const WT1 = '/repo-wt/lazunox-compare-1'
const MODELS = [
  { providerID: 'fake', modelID: 'a' },
  { providerID: 'fake', modelID: 'b' }
]
const empty = (): ConvSlice => ({ messages: {}, status: {}, errors: {}, sessions: {} })
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

let fake: ReturnType<typeof fakeCompare>
beforeEach(() => {
  resetEventIds()
  resetCompareForTests()
  fake = fakeCompare()
  installApi(fake.api)
  useServer.setState({ client: null })
  localStorage.clear()
})
afterEach(() => {
  resetCompareForTests()
  installApi(null)
})

describe('reducción de eventos por sesión', () => {
  it('cada columna recibe solo los eventos de su sesión; el resto se ignora', () => {
    const b = createBuffers()
    const accept = (sid: string): boolean => sid === 'ses_0' || sid === 'ses_1'
    const evs = [
      msgUpdated(assistantMessage('m0', 'ses_0'), WT0),
      partUpdated(textPart('p0', 'm0', 'ses_0', 'hola'), WT0),
      partDelta({ sessionID: 'ses_0', messageID: 'm0', partID: 'p0', delta: ' mundo' }, WT0),
      msgUpdated(assistantMessage('m1', 'ses_1'), WT1),
      partUpdated(textPart('p1', 'm1', 'ses_1', 'otra'), WT1),
      msgUpdated(assistantMessage('mx', 'ses_ajena'), '/otro'),
      partUpdated(textPart('px', 'mx', 'ses_ajena', 'no debe verse'), '/otro'),
      statusBusy('ses_0', WT0),
      statusIdle('ses_1', WT1)
    ].map((e) => e.event)
    const out = reduceColumnEvents(empty(), evs, b, accept)
    const text = (sid: string): string[] =>
      (out.messages[sid] ?? []).flatMap((e) => e.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text))
    expect(text('ses_0')).toEqual(['hola mundo'])
    expect(text('ses_1')).toEqual(['otra'])
    expect(out.messages.ses_ajena).toBeUndefined()
    expect(out.status.ses_0).toBe('busy')
    expect(out.status.ses_1).toBe('idle')
  })
  it('sin eventos aceptados devuelve la misma referencia', () => {
    const s = empty()
    expect(reduceColumnEvents(s, [msgUpdated(assistantMessage('m', 'zzz'), '/x').event], createBuffers(), () => false)).toBe(s)
  })
})

describe('manifiestos y ciclo de vida de una columna', () => {
  it('queued → running → done con compare:changed; las métricas null siguen siendo null', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const m = (state: 'queued' | 'running' | 'done') => mkManifest({}, [mkCol(0, { state }), mkCol(1, { state: 'running' })])
    const dispose = bootCompare()
    fake.emit(m('queued'))
    expect(useCompare.getState().manifests[id]!.columns[0]!.state).toBe('queued')
    fake.emit(m('running'))
    expect(useCompare.getState().manifests[id]!.columns[0]!.state).toBe('running')
    fake.emit(mkManifest({}, [mkCol(0, { state: 'done', metrics: { ...mkCol(0).metrics, costUsd: null } }), mkCol(1)]))
    const c0 = useCompare.getState().manifests[id]!.columns[0]!
    expect(c0.state).toBe('done')
    expect(c0.metrics.costUsd).toBeNull()
    dispose()
  })
  it('bootCompare carga la lista, cuenta usos y se da de baja del todo al soltar el último', async () => {
    const m = mkManifest({}, [mkCol(0, { interrupted: true }), mkCol(1, { interrupted: true })])
    ;(fake.api.list as ReturnType<typeof vi.fn>).mockResolvedValue([m])
    const d1 = bootCompare()
    const d2 = bootCompare()
    await flushMicrotasks()
    expect(fake.api.list).toHaveBeenCalledTimes(1)
    expect(fake.api.onChanged).toHaveBeenCalledTimes(1)
    expect(useCompare.getState().loaded).toBe(true)
    expect(selectRecoverable(useCompare.getState(), 'code', '/repo')).toHaveLength(1)
    expect(selectShown(useCompare.getState(), 'code', '/repo')).toBeNull()
    d1()
    d2()
  })
  it('un fallo de list se registra sin romper', async () => {
    ;(fake.api.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    bootCompare()()
    await flushMicrotasks()
    expect(useCompare.getState().loaded).toBe(true)
    expect(useCompare.getState().loadError).toBe('boom')
  })
  it('hydrate pide los mensajes de cada sesión en la carpeta de su copia y los fusiona con el stream', async () => {
    const messages = vi.fn(async ({ sessionID }: { sessionID: string; directory: string }) => ({
      data: [{ info: assistantMessage(`m_${sessionID}`, sessionID), parts: [textPart('p', `m_${sessionID}`, sessionID, 'ya estaba')] }]
    }))
    useServer.setState({ client: { session: { messages } } as never })
    const m = mkManifest()
    applyManifest(m)
    await hydrate(m)
    expect(messages).toHaveBeenCalledWith({ sessionID: 'ses_0', directory: WT0 })
    expect(messages).toHaveBeenCalledWith({ sessionID: 'ses_1', directory: WT1 })
    expect(useCompare.getState().slice.messages.ses_0![0]!.parts[0]).toMatchObject({ text: 'ya estaba' })
    // una segunda hidratación no repite la petición salvo `force`
    await hydrate(m)
    expect(messages).toHaveBeenCalledTimes(2)
    await hydrate(m, true)
    expect(messages).toHaveBeenCalledTimes(4)
  })
  it('un fallo al cargar los mensajes permite reintentar', async () => {
    const messages = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ data: [] })
    useServer.setState({ client: { session: { messages } } as never })
    const m = mkManifest({}, [mkCol(0)])
    await hydrate(m)
    await hydrate(m)
    expect(messages).toHaveBeenCalledTimes(2)
  })
  it('handleEvent: solo pinta sesiones del manifiesto; los permisos pendientes van a su columna y no a useCode', () => {
    const m = mkManifest()
    applyManifest(m)
    handleEvent(msgUpdated(assistantMessage('m0', 'ses_0'), WT0).event, WT0)
    handleEvent(msgUpdated(assistantMessage('mx', 'ses_otra'), '/otro').event, '/otro')
    expect(Object.keys(useCompare.getState().slice.messages)).toEqual(['ses_0'])
    handleEvent(permAsked({ id: 'perm1', sessionID: 'ses_1' }, WT1).event, WT1)
    // permiso de una sesión hija (subagente) en la carpeta de la copia
    handleEvent(permAsked({ id: 'perm2', sessionID: 'ses_hija' }, WT0).event, WT0)
    handleEvent(permAsked({ id: 'perm3', sessionID: 'ajena' }, '/otro').event, '/otro')
    const perms = useCompare.getState().permissions
    expect(Object.keys(perms).sort()).toEqual(['perm1', 'perm2'])
    expect(perms.perm1).toMatchObject({ index: 1, compareId: m.id })
    expect(perms.perm2).toMatchObject({ index: 0 })
  })
  it('responder un permiso lo quita; «una vez» llama al motor con la carpeta de la copia', async () => {
    const reply = vi.fn(async () => ({ data: true }))
    useServer.setState({ client: { permission: { reply } } as never })
    applyManifest(mkManifest())
    handleEvent(permAsked({ id: 'perm1', sessionID: 'ses_1' }, WT1).event, WT1)
    await replyPermission(useCompare.getState().permissions.perm1!, 'once')
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm1', reply: 'once', directory: WT1 })
    expect(useCompare.getState().permissions.perm1).toBeUndefined()
  })
})

describe('lanzamiento (requestCompare / confirmStart)', () => {
  it('sin nada armado no interviene (el compositor envía como siempre)', async () => {
    expect(isArmed('code', '/repo')).toBe(false)
    expect(await requestCompare({ mode: 'code', directory: '/repo', text: 'hola' })).toBe(false)
    expect(maybeInterceptSubmit('hola', { mode: 'code', directory: '/repo', attachments: [] })).toBe(false)
    expect(useCompare.getState().confirm).toBeNull()
  })
  it('armar exige entre 2 y 4 modelos', () => {
    armModels('chat', null, [MODELS[0]!])
    expect(isArmed('chat', null)).toBe(false)
    armModels('chat', null, MODELS)
    expect(isArmed('chat', null)).toBe(true)
    expect(useCompare.getState().armed[ctxKey('chat', null)]).toHaveLength(2)
  })
  it('con adjuntos queda bloqueado (v1 solo texto) y no llama a start', async () => {
    armModels('chat', null, MODELS)
    const p = requestCompare({ mode: 'chat', directory: null, text: 'x', attachments: [{ id: 'a' }] })
    expect(useCompare.getState().confirm!.blocker).toBe('attachments')
    await confirmStart()
    expect(fake.api.start).not.toHaveBeenCalled()
    cancelConfirm()
    expect(await p).toBe(false)
  })
  it('con otra comparación activa queda bloqueado (solo una a la vez)', async () => {
    applyManifest(mkManifest())
    armModels('chat', null, MODELS)
    const p = requestCompare({ mode: 'chat', directory: null, text: 'x' })
    expect(useCompare.getState().confirm!.blocker).toBe('busy')
    cancelConfirm()
    expect(await p).toBe(false)
  })
  it('Code: consulta preflight, avisa de cambios sin guardar y lanza al confirmar; `plan` se rebaja a Preguntar siempre', async () => {
    ;(fake.api.preflight as ReturnType<typeof vi.fn>).mockResolvedValue({
      repo: true,
      root: '/repo',
      head: 'abc1234deadbeef',
      shortHead: 'abc1234',
      clean: false,
      dirtyFiles: 3
    })
    armModels('code', '/repo', MODELS)
    const p = requestCompare({ mode: 'code', directory: '/repo', text: 'hazlo', permissionMode: 'plan' })
    expect(useCompare.getState().confirm!.checking).toBe(true)
    await flushMicrotasks()
    const c = useCompare.getState().confirm!
    expect(c.checking).toBe(false)
    expect(c.preflight!.clean).toBe(false)
    expect(c.blocker).toBeNull()
    await confirmStart()
    expect(await p).toBe(true)
    const req = (fake.api.start as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(req).toMatchObject({ mode: 'code', cwd: '/repo', prompt: 'hazlo', permissionMode: 'manual', models: MODELS })
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/)
    const s = useCompare.getState()
    expect(s.confirm).toBeNull()
    expect(isArmed('code', '/repo')).toBe(false)
    expect(Object.values(s.opened)).toEqual([true])
    expect(selectShown(s, 'code', '/repo')!.id).toBe(req.id)
    expect(selectShown(s, 'code', '/otro')).toBeNull()
  })
  it('Code sin repositorio: se explica y no se lanza', async () => {
    ;(fake.api.preflight as ReturnType<typeof vi.fn>).mockResolvedValue({
      repo: false,
      root: null,
      head: null,
      shortHead: null,
      clean: true,
      dirtyFiles: 0
    })
    armModels('code', '/sin-git', MODELS)
    const p = requestCompare({ mode: 'code', directory: '/sin-git', text: 'x' })
    await flushMicrotasks()
    expect(useCompare.getState().confirm!.blocker).toBe('noRepo')
    await confirmStart()
    expect(fake.api.start).not.toHaveBeenCalled()
    cancelConfirm()
    expect(await p).toBe(false)
  })
  it('un error de start (p. ej. «busy» de main) deja el diálogo abierto con el mensaje; cancelar devuelve false', async () => {
    ;(fake.api.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Ya hay una comparación en curso.'))
    armModels('chat', null, MODELS)
    const p = requestCompare({ mode: 'chat', directory: null, text: 'x' })
    await confirmStart()
    expect(useCompare.getState().confirm).toMatchObject({ error: 'Ya hay una comparación en curso.', starting: false })
    expect(isArmed('chat', null)).toBe(true)
    cancelConfirm()
    expect(await p).toBe(false)
  })
  it('«No volver a mostrar»: Chat arranca sin diálogo; Code solo si el árbol está limpio', async () => {
    armModels('chat', null, MODELS)
    const p1 = requestCompare({ mode: 'chat', directory: null, text: 'uno' })
    await confirmStart({ dontAsk: true })
    expect(await p1).toBe(true)
    resetCompareForTests()
    installApi(fake.api)
    localStorage.setItem('lazunox.compare.skipConfirm', '1')
    armModels('chat', null, MODELS)
    const p2 = requestCompare({ mode: 'chat', directory: null, text: 'dos' })
    await flushMicrotasks()
    expect(await p2).toBe(true)
    expect(useCompare.getState().confirm).toBeNull()
    // Code con árbol sucio: se sigue mostrando el diálogo
    resetCompareForTests()
    installApi(fake.api)
    localStorage.setItem('lazunox.compare.skipConfirm', '1')
    ;(fake.api.preflight as ReturnType<typeof vi.fn>).mockResolvedValue({
      repo: true,
      root: '/repo',
      head: 'a',
      shortHead: 'a',
      clean: false,
      dirtyFiles: 1
    })
    armModels('code', '/repo', MODELS)
    void requestCompare({ mode: 'code', directory: '/repo', text: 'tres' })
    await flushMicrotasks()
    expect(useCompare.getState().confirm).not.toBeNull()
    cancelConfirm()
  })
  it('maybeInterceptSubmit: devuelve true, no limpia el borrador hasta que arranca y avisa con onStarted', async () => {
    armModels('chat', null, MODELS)
    const onStarted = vi.fn()
    expect(maybeInterceptSubmit('hola', { mode: 'chat', directory: null, attachments: [], onStarted })).toBe(true)
    expect(onStarted).not.toHaveBeenCalled()
    await confirmStart()
    await flushMicrotasks()
    expect(onStarted).toHaveBeenCalledTimes(1)
  })
})

describe('acciones sobre columnas', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  it('cancelar una columna o todas', async () => {
    await cancelColumn(id, 1)
    await cancelColumn(id)
    expect(fake.api.cancel).toHaveBeenNthCalledWith(1, id, 1)
    expect(fake.api.cancel).toHaveBeenNthCalledWith(2, id, undefined)
  })
  it('reintentar manda {id, index}; un error de main queda visible', async () => {
    await retryColumn(id, 2)
    expect(fake.api.retry).toHaveBeenCalledWith(id, 2)
    ;(fake.api.retry as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no se puede'))
    await retryColumn(id, 2)
    expect(useCompare.getState().errors[id]).toBe('no se puede')
  })
  it('«Quedarme con este»: adopta y cierra; la comparación desaparece del estado', async () => {
    const m = mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1, { state: 'done' })])
    applyManifest(m)
    useCompare.setState({ opened: { [id]: true } })
    const out = await keepColumn(id, 0)
    expect(out).toEqual({ kind: 'ok', files: ['a.txt'], closed: true })
    expect(fake.api.adopt).toHaveBeenCalledWith(id, 0, undefined)
    expect(fake.api.close).toHaveBeenCalledWith(id)
    expect(useCompare.getState().manifests[id]).toBeUndefined()
    expect(useCompare.getState().opened[id]).toBeUndefined()
  })
  it('un compare:changed rezagado tras cerrar no resucita la comparación ni vuelve a pedir mensajes de sus sesiones', async () => {
    const getMessages = vi.fn(async () => ({ data: [] }))
    useServer.setState({ client: { session: { messages: getMessages } } as never })
    const m = mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1, { state: 'done' })])
    applyManifest(m)
    await flushMicrotasks()
    getMessages.mockClear()
    await keepColumn(id, 0)
    applyManifest(m) // evento anterior al cierre que llega después
    await flushMicrotasks()
    expect(useCompare.getState().manifests[id]).toBeUndefined()
    expect(getMessages).not.toHaveBeenCalled()
  })
  it.each(['conflict', 'empty', 'symlink', 'not-ready'] as const)(
    'adopt %s: no se cierra nada y el fallo queda a la vista',
    async (reason) => {
      ;(fake.api.adopt as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, reason, files: ['a.txt'] })
      applyManifest(mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1)]))
      const out = await keepColumn(id, 0)
      expect(out).toMatchObject({ kind: 'failed', reason })
      expect(fake.api.close).not.toHaveBeenCalled()
      expect(useCompare.getState().adoptFailures[`${id}:0`]).toMatchObject({ reason, files: ['a.txt'] })
      expect(useCompare.getState().manifests[id]).toBeDefined()
    }
  )
  it('dirty-overlap se puede repetir con force', async () => {
    ;(fake.api.adopt as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, reason: 'dirty-overlap', files: ['a.txt', 'b.txt'] })
    applyManifest(mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1)]))
    const first = await keepColumn(id, 0)
    expect(first).toMatchObject({ kind: 'failed', reason: 'dirty-overlap', files: ['a.txt', 'b.txt'] })
    const second = await keepColumn(id, 0, true)
    expect(second.kind).toBe('ok')
    expect(fake.api.adopt).toHaveBeenLastCalledWith(id, 0, true)
    expect(useCompare.getState().adoptFailures[`${id}:0`]).toBeUndefined()
  })
  it('cerrar con copias que se conservan (parada sin confirmar): closed:false no borra el manifiesto', async () => {
    ;(fake.api.close as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ closed: false, kept: [1] })
    applyManifest(mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1, { state: 'cancelled', stopUnconfirmed: true })]))
    expect(await closeCompare(id)).toBe(false)
    expect(useCompare.getState().manifests[id]).toBeDefined()
    expect(useCompare.getState().errors[id]).toMatch(/no se pudieron descartar/i)
    expect(await closeCompare(id)).toBe(true)
    expect(useCompare.getState().manifests[id]).toBeUndefined()
  })
  it('tras la adopción en Chat la sesión elegida deja de estar oculta; las demás siguen ocultas', () => {
    const m = mkManifest({ mode: 'chat', cwd: null }, [
      mkCol(0, { state: 'done', adopted: true, worktree: null }),
      mkCol(1, { state: 'done', worktree: null })
    ])
    const st = { manifests: { [m.id]: m }, loaded: true }
    const sess = (sid: string): { id: string; metadata: Record<string, unknown> } => ({
      id: sid,
      metadata: { mode: 'chat', compare: m.id }
    })
    expect(isHiddenCompareSession(sess('ses_0'), st)).toBe(false)
    expect(isHiddenCompareSession(sess('ses_1'), st)).toBe(true)
    expect(isHiddenCompareSession({ id: 'normal', metadata: { mode: 'chat' } }, st)).toBe(false)
    expect(isHiddenCompareSession({ id: 'normal' }, st)).toBe(false)
    // comparación ya cerrada (sin manifiesto): una sesión marcada ya es conversación normal
    expect(isHiddenCompareSession(sess('ses_9'), { manifests: {}, loaded: true })).toBe(false)
    // antes de cargar los manifiestos se ocultan para evitar un parpadeo
    expect(isHiddenCompareSession(sess('ses_9'), { manifests: {}, loaded: false })).toBe(true)
  })
})

describe('el celular no usa la función', () => {
  it('compareApi es null en la superficie remota y nada se sincroniza ni se lanza', async () => {
    installApi(fake.api, 'remote')
    expect(compareApi()).toBeNull()
    const dispose = bootCompare()
    dispose()
    expect(fake.api.list).not.toHaveBeenCalled()
    expect(fake.api.onChanged).not.toHaveBeenCalled()
    useCompare.setState({ armed: { [ctxKey('chat', null)]: MODELS } })
    expect(await requestCompare({ mode: 'chat', directory: null, text: 'x' })).toBe(false)
    expect(maybeInterceptSubmit('x', { mode: 'chat', directory: null, attachments: [] })).toBe(false)
  })
  it('en escritorio la API existe', () => {
    expect(compareApi()).not.toBeNull()
  })
})
