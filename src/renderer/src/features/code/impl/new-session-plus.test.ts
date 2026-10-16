/**
 * «+» del encabezado de proyecto: no repite en 400 ms y reutiliza la sesión vacía sin título en vez de crear otra.
 */
import type { Session } from '@opencode-ai/sdk/v2/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
type Plus = typeof import('./new-session-plus')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
let plus: Plus
let created: string[]

const A = '/work/a'
const PLACEHOLDER = 'New session - 2026-10-16T10:00:00.000Z'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  created = []
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  plus = await import('./new-session-plus')
  const client = {
    session: {
      create: ({ directory }: { directory: string }) => {
        const id = `new-${created.length}`
        created.push(id)
        return Promise.resolve({ data: makeSession(id, directory, { title: PLACEHOLDER }) })
      },
      messages: () => Promise.resolve({ data: [] }),
      todo: () => Promise.resolve({ data: [] })
    }
  }
  useServer.setState({ client: client as never })
})

function seed(sessions: Session[], messages: Record<string, unknown[]> = {}): void {
  useCode.setState({
    directory: A,
    openDirectories: [A],
    sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
    sessionProject: Object.fromEntries(sessions.map((s) => [s.id, A])),
    messages: messages as never,
    runState: {}
  })
}

describe('newSessionHere', () => {
  it('proyecto sin sesiones: crea una', async () => {
    seed([])
    const id = await plus.newSessionHere(A, 1000)
    expect(id).toBe('new-0')
    expect(created).toHaveLength(1)
  })

  it('con una vacía sin título: selecciona esa y no crea otra', async () => {
    seed([makeSession('vacia', A, { title: PLACEHOLDER })], { vacia: [] })
    const id = await plus.newSessionHere(A, 1000)
    expect(id).toBe('vacia')
    expect(created).toHaveLength(0)
    expect(useCode.getState().activeSessionID).toBe('vacia')
  })

  it('con una vacía pero ya con título: crea', async () => {
    seed([makeSession('titulada', A, { title: 'Informe de ventas' })], { titulada: [] })
    expect(await plus.newSessionHere(A, 1000)).toBe('new-0')
  })

  it('sin título pero con mensajes: crea', async () => {
    seed([makeSession('conmsg', A, { title: PLACEHOLDER })], { conmsg: [{ info: { id: 'm1', role: 'user' }, parts: [] }] })
    expect(await plus.newSessionHere(A, 1000)).toBe('new-0')
  })

  it('mensajes sin cargar (no se sabe si está vacía): crea', async () => {
    seed([makeSession('nose', A, { title: PLACEHOLDER })])
    expect(await plus.newSessionHere(A, 1000)).toBe('new-0')
  })

  it('anti-doble-clic: la segunda activación en <400 ms se ignora; pasado el respiro vuelve a funcionar', async () => {
    seed([])
    expect(await plus.newSessionHere(A, 1000)).toBe('new-0')
    expect(await plus.newSessionHere(A, 1200)).toBeNull()
    expect(created).toHaveLength(1)
    // Otro proyecto no se ve afectado.
    expect(await plus.newSessionHere('/work/b', 1200)).toBe('new-1')
    expect(await plus.newSessionHere(A, 1500)).not.toBeNull()
  })
})
