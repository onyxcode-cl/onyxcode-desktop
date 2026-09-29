/** F7 · G2: estado de tareas desalojadas, origen de Cowork y limpieza al borrar una tarea. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
vi.mock('./bridge', () => ({ cw: vi.fn(async () => undefined) }))

const D = '/proj'
const SRC = 'http://cw'

let useSessions: (typeof import('../../../stores/sessions'))['useSessions']
let useCowork: (typeof import('./store'))['useCowork']
let util: typeof import('./util')
let actions: typeof import('./actions')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;({ useSessions } = await import('../../../stores/sessions'))
  ;({ useCowork } = await import('./store'))
  util = await import('./util')
  actions = await import('./actions')
})

describe('isCoworkSource (F7-B37)', () => {
  it('cualquier servidor de Cowork cuenta; Chat/Code (origen principal o ausente) no', () => {
    expect(util.isCoworkSource('http://cw')).toBe(true)
    expect(util.isCoworkSource('http://otro-cw')).toBe(true)
    expect(util.isCoworkSource('main')).toBe(false)
    expect(util.isCoworkSource(undefined)).toBe(false)
  })
})

describe('taskStatus con historial desalojado (F7-B35)', () => {
  const base = { run: 'idle' as const, waiting: false, error: null }
  it('sin historial y sin estado guardado se asume terminada', () => {
    expect(util.taskStatus({ ...base, entries: undefined })).toBe('done')
  })
  it('sin historial usa el estado terminal guardado al desalojar', () => {
    expect(util.taskStatus({ ...base, entries: undefined, evicted: 'error' })).toBe('error')
  })
  it('con historial cargado ignora el estado guardado', () => {
    expect(util.taskStatus({ ...base, entries: [], evicted: 'error' })).toBe('idle')
  })
  it('rememberEvictedStatus solo conserva error y lo borra al recalcular', () => {
    const errEntry = {
      info: { id: 'm1', role: 'assistant', sessionID: 's', error: { name: 'APIError', data: {} } },
      parts: []
    } as never
    util.rememberEvictedStatus('s', [errEntry])
    expect(util.evictedStatusOf('s')).toBe('error')
    util.rememberEvictedStatus('s', [])
    expect(util.evictedStatusOf('s')).toBeUndefined()
  })
})

describe('deleteTask y creación de tareas (F7-B36)', () => {
  it('deleteTask borra también status, errors, sessionSource y loaded', async () => {
    const client = { session: { delete: vi.fn(async () => ({ data: true })) } }
    useCowork.setState({ client: client as never, folder: D })
    const st = useSessions.getState()
    st.upsertSession(makeSession('t1', D), SRC)
    st.setStatus('t1', 'busy')
    st.setError('t1', 'boom')
    useSessions.setState((s) => ({ messages: { ...s.messages, t1: [] }, loaded: { ...s.loaded, t1: true } }))
    await actions.deleteTask('t1')
    const s = useSessions.getState()
    expect(s.sessions.t1).toBeUndefined()
    expect(s.messages.t1).toBeUndefined()
    expect(s.status.t1).toBeUndefined()
    expect(s.errors.t1).toBeUndefined()
    expect(s.sessionSource.t1).toBeUndefined()
    expect(s.loaded.t1).toBeUndefined()
  })
})
