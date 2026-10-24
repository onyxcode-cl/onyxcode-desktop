// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionsBackgroundJobs } from './BackgroundJobsConnectors'
import { useSessions } from '../../../stores/sessions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
// `jobs:list` / `jobs:stop` pasan por `call` (IPC al main): aquí se simulan. Por defecto el motor no tiene la ruta.
const mockCall = vi.hoisted(() => ({ impl: null as null | ((ch: string, req?: unknown) => unknown) }))
vi.mock('../../../lib/api', () => ({
  call: async (ch: string, req?: unknown) => (mockCall.impl ? mockCall.impl(ch, req) : { available: false })
}))

const now = Date.now()
const sess = (id: string, parentID?: string): never => ({ id, parentID, title: id, time: { created: now - 30_000, updated: now } }) as never
const task = (child: string): never =>
  ({
    id: `p_${child}`,
    sessionID: 'root',
    messageID: 'm1',
    type: 'tool',
    callID: `c_${child}`,
    tool: 'task',
    state: { status: 'completed', input: { description: `Hace ${child}` }, metadata: { sessionId: child, background: true } }
  }) as never

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  mockCall.impl = null
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useSessions.setState({
    sessions: { root: sess('root'), kid: sess('kid', 'root'), side: sess('side', 'root') },
    status: { kid: 'busy', side: 'busy' },
    messages: { root: [{ info: { id: 'm1' } as never, parts: [task('kid')] }] },
    errors: {}
  })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('SessionsBackgroundJobs (Tareas y Chat)', () => {
  it('muestra solo el subagente de fondo (no la consulta lateral) y Cancelar aborta esa hija en su directorio', async () => {
    const abort = vi.fn(async () => ({ data: true }))
    const client = { session: { abort } } as never
    act(() => root.render(createElement(SessionsBackgroundJobs, { rootId: 'root', directory: '/proj', client })))
    expect(host.querySelectorAll('li')).toHaveLength(1)
    expect(host.textContent).toContain('Hace kid')
    act(() => host.querySelector('button')!.click())
    await act(async () => {
      await Promise.resolve()
    })
    expect(abort).toHaveBeenCalledWith({ sessionID: 'kid', directory: '/proj' })
  })

  it('un permiso pendiente de la hija la marca como esperando', () => {
    act(() =>
      root.render(createElement(SessionsBackgroundJobs, { rootId: 'root', directory: '/proj', client: null, pendingSessionIds: ['kid'] }))
    )
    expect(host.textContent).toContain('Espera tu permiso')
  })

  it('sin trabajos no pinta nada', () => {
    useSessions.setState({ messages: { root: [] } })
    act(() => root.render(createElement(SessionsBackgroundJobs, { rootId: 'root', directory: '/proj', client: null })))
    expect(host.innerHTML).toBe('')
  })
})

describe('SessionsBackgroundJobs con trabajos del motor (jobs:list / jobs:stop)', () => {
  const jobsOk = (estado = 'en_curso') => ({
    available: true as const,
    jobs: [
      {
        id: 'sh_1',
        kind: 'shell' as const,
        title: 'npm run dev',
        state: estado as never,
        code: null,
        startedAt: now - 10_000,
        endedAt: null
      }
    ]
  })
  const setup = (callImpl: (ch: string, req?: unknown) => unknown): ReturnType<typeof vi.fn> => {
    const spy = vi.fn(async (ch: string, req?: unknown) => callImpl(ch, req))
    mockCall.impl = spy
    return spy
  }
  // Reloj falso desde el principio: el sondeo crea su intervalo al montar.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const settle = async (ms = 0): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('lista el comando del motor junto al ayudante y Parar llama a jobs:stop y vuelve a consultar', async () => {
    let state = 'en_curso'
    const spy = setup((ch) => (ch === 'jobs:list' ? jobsOk(state) : { ok: true }))
    act(() => root.render(createElement(SessionsBackgroundJobs, { rootId: 'root', directory: '/proj', client: null })))
    await settle()
    expect(spy).toHaveBeenCalledWith('jobs:list', { sessionID: 'root', directory: '/proj' })
    expect(host.querySelectorAll('li')).toHaveLength(2)
    expect(host.textContent).toContain('npm run dev')
    const stopBtn = [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('Parar'))!
    state = 'terminado_por_ti'
    act(() => stopBtn.click())
    await settle()
    expect(spy).toHaveBeenCalledWith('jobs:stop', { sessionID: 'root', jobId: 'sh_1', directory: '/proj' })
    expect(host.textContent).toContain('Parado')
  })

  it('404 del motor (available:false): solo ayudantes y ninguna alerta', async () => {
    const spy = setup(() => ({ available: false }))
    act(() => root.render(createElement(SessionsBackgroundJobs, { rootId: 'root', directory: '/proj', client: null })))
    await settle()
    expect(host.querySelectorAll('li')).toHaveLength(1)
    expect(host.querySelector('[role="alert"]')).toBeNull()
    const calls = spy.mock.calls.length
    await settle(20_000)
    expect(spy.mock.calls.length).toBe(calls) // no sigue preguntando
  })

  it('error de red al consultar: sin mensajes, solo los ayudantes', async () => {
    setup(() => {
      throw new Error('fetch failed')
    })
    act(() => root.render(createElement(SessionsBackgroundJobs, { rootId: 'root', directory: '/proj', client: null })))
    await settle()
    expect(host.querySelectorAll('li')).toHaveLength(1)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('sondeo suave: repite mientras haya uno en curso', async () => {
    const spy = setup(() => jobsOk())
    act(() => root.render(createElement(SessionsBackgroundJobs, { rootId: 'root', directory: '/proj', client: null })))
    await settle()
    const first = spy.mock.calls.filter((c) => c[0] === 'jobs:list').length
    await settle(9000)
    expect(spy.mock.calls.filter((c) => c[0] === 'jobs:list').length).toBeGreaterThanOrEqual(first + 2)
  })

  it('sin nada en curso y conversación ociosa no hay sondeo', async () => {
    useSessions.setState({ messages: { root: [] }, status: {} })
    const spy = setup(() => ({ available: true, jobs: [] }))
    act(() => root.render(createElement(SessionsBackgroundJobs, { rootId: 'root', directory: '/proj', client: null })))
    await settle()
    const first = spy.mock.calls.length
    await settle(30_000)
    expect(spy.mock.calls.length).toBe(first)
    expect(host.innerHTML).toBe('')
  })
})
