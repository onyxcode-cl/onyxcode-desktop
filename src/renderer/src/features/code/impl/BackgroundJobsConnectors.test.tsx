// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionsBackgroundJobs } from './BackgroundJobsConnectors'
import { useSessions } from '../../../stores/sessions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

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
