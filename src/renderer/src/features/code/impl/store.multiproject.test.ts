/**
 * Varios proyectos abiertos a la vez en Code (decisión del dueño, 2026-10-07): `openProject` agrega en vez de
 * reemplazar, `closeOneProject`/`focusProject` manejan el resto, y todo se persiste en `code.projects`.
 */
import type { Session } from '@opencode-ai/sdk/v2/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REMOTE_SURFACE } from '@shared/platform-caps'
import { makeSession, resetEventIds, sessionCreated } from '../../../../../test/fixtures/events'
import { MAX_OPEN_PROJECTS } from './open-projects'

const sendNotification = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/notify', () => ({ sendNotification, setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']

const A = '/work/a'
const B = '/work/b'
const C = '/work/c'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;(globalThis as { window: { api?: { platform?: string } } }).window.api!.platform = 'darwin'
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()

/** Cliente falso: `session.list` responde según el `directory` pedido; el resto, vacío/trivial. */
function installClient(lists: Record<string, Session[]> = {}): void {
  const client = {
    session: {
      list: ({ directory }: { directory: string }) => Promise.resolve({ data: lists[directory] ?? [] }),
      status: () => Promise.resolve({ data: {} }),
      messages: () => Promise.resolve({ data: [] }),
      todo: () => Promise.resolve({ data: [] }),
      delete: () => Promise.resolve({ data: true }),
      create: ({ directory, title }: { directory: string; title?: string }) =>
        Promise.resolve({ data: makeSession(`new-${directory}`, directory, { title }) })
    },
    permission: { list: () => Promise.resolve({ data: [] }) },
    question: { list: () => Promise.resolve({ data: [] }) }
  }
  useServer.setState({ client: client as never })
}

const projectsLS = (): { v: number; open: string[]; focus: string | null } | null => {
  const raw = localStorage.getItem('code.projects')
  return raw ? JSON.parse(raw) : null
}

describe('openProject agrega en vez de reemplazar (escritorio)', () => {
  it('abrir A y luego B: los dos quedan abiertos, el foco pasa a B, las sesiones de A siguen', async () => {
    installClient({ [A]: [makeSession('sa', A)], [B]: [makeSession('sb', B)] })
    await st().openProject(A)
    expect(st().openDirectories).toEqual([A])
    expect(st().directory).toBe(A)
    expect(st().sessions['sa']).toBeDefined()

    await st().openProject(B)
    expect(st().openDirectories).toEqual([A, B])
    expect(st().directory).toBe(B)
    // Las sesiones de A no se tocaron al abrir B.
    expect(st().sessions['sa']).toBeDefined()
    expect(st().sessionProject['sa']).toBe(A)
    expect(projectsLS()).toEqual({ v: 1, open: [A, B], focus: B })
  })

  it('abrir un proyecto ya abierto solo le da el foco (no lo duplica ni recarga desde cero otra vez)', async () => {
    installClient({ [A]: [makeSession('sa', A)], [B]: [] })
    await st().openProject(A)
    await st().openProject(B)
    await st().openProject(A)
    expect(st().openDirectories).toEqual([A, B])
    expect(st().directory).toBe(A)
  })
})

describe('focusProject', () => {
  it('cambia el foco a un proyecto ya abierto sin tocar sus sesiones ni las del otro', async () => {
    installClient({ [A]: [makeSession('sa', A)], [B]: [makeSession('sb', B)] })
    await st().openProject(A)
    await st().openProject(B)
    expect(st().directory).toBe(B)
    await st().focusProject(A)
    expect(st().directory).toBe(A)
    expect(st().sessions['sa']).toBeDefined()
    expect(st().sessions['sb']).toBeDefined()
    expect(projectsLS()?.focus).toBe(A)
  })

  it('no hace nada si el proyecto no está abierto', async () => {
    installClient({ [A]: [] })
    await st().openProject(A)
    await st().focusProject(C)
    expect(st().directory).toBe(A)
  })
})

describe('closeOneProject', () => {
  it('cierra uno que NO tiene el foco: el foco no cambia, sus sesiones se purgan', async () => {
    installClient({ [A]: [makeSession('sa', A)], [B]: [makeSession('sb', B)] })
    await st().openProject(A)
    await st().openProject(B)
    st().closeOneProject(A)
    expect(st().openDirectories).toEqual([B])
    expect(st().directory).toBe(B)
    expect(st().sessions['sa']).toBeUndefined()
    expect(st().sessionProject['sa']).toBeUndefined()
    expect(st().sessions['sb']).toBeDefined()
  })

  it('cierra el que tiene el foco: pasa el foco a otro abierto', async () => {
    installClient({ [A]: [makeSession('sa', A)], [B]: [makeSession('sb', B)] })
    await st().openProject(A)
    await st().openProject(B) // foco en B
    st().closeOneProject(B)
    await vi.waitFor(() => expect(st().directory).toBe(A))
    expect(st().openDirectories).toEqual([A])
  })

  it('cierra el último proyecto abierto: el foco queda en null (pantalla de recientes)', async () => {
    installClient({ [A]: [makeSession('sa', A)] })
    await st().openProject(A)
    st().closeOneProject(A)
    expect(st().directory).toBeNull()
    expect(st().openDirectories).toEqual([])
    expect(projectsLS()).toEqual({ v: 1, open: [], focus: null })
  })

  it('conserva las sesiones fijadas (pinned) del proyecto cerrado', async () => {
    installClient({ [A]: [makeSession('sa', A)], [B]: [] })
    await st().openProject(A)
    st().togglePin('sa')
    await st().openProject(B)
    st().closeOneProject(A)
    expect(st().pinned[A]).toEqual(['sa'])
  })

  it('no hace nada si el proyecto no está abierto', async () => {
    installClient({ [A]: [makeSession('sa', A)] })
    await st().openProject(A)
    st().closeOneProject(C)
    expect(st().openDirectories).toEqual([A])
  })
})

describe('adopt/projectFor aceptan eventos de cualquier proyecto abierto (con foco o no)', () => {
  it('session.created de un proyecto abierto sin foco se agrega a ESE proyecto', async () => {
    installClient({ [A]: [], [B]: [] })
    await st().openProject(A)
    await st().openProject(B) // foco en B
    st().applyEvent(sessionCreated(makeSession('s-cli', A)).event, A)
    expect(st().sessionProject['s-cli']).toBe(A)
  })

  it('un evento de un directorio que NO está abierto se ignora', async () => {
    installClient({ [A]: [] })
    await st().openProject(A)
    st().applyEvent(sessionCreated(makeSession('s-fuera', C)).event, C)
    expect(st().sessionProject['s-fuera']).toBeUndefined()
  })
})

describe('tope de proyectos abiertos', () => {
  it(`al llegar a ${MAX_OPEN_PROJECTS}, uno sin actividad se desaloja para abrir uno nuevo`, async () => {
    const lists: Record<string, Session[]> = {}
    const dirs = Array.from({ length: MAX_OPEN_PROJECTS }, (_, i) => `/work/p${i}`)
    for (const d of dirs) lists[d] = []
    installClient(lists)
    for (const d of dirs) await st().openProject(d)
    expect(st().openDirectories).toHaveLength(MAX_OPEN_PROJECTS)

    installClient({ ...lists, [C]: [] })
    await st().openProject(C)
    expect(st().openDirectories).toHaveLength(MAX_OPEN_PROJECTS)
    expect(st().openDirectories).toContain(C)
    expect(st().openDirectories).not.toContain(dirs[0]) // el de foco más viejo (el primero abierto)
  })

  it('si todos los abiertos tienen algo trabajando, rechaza abrir uno más (sin desalojar)', async () => {
    const lists: Record<string, Session[]> = {}
    const dirs = Array.from({ length: MAX_OPEN_PROJECTS }, (_, i) => `/work/q${i}`)
    for (const d of dirs) lists[d] = [makeSession(`s${d}`, d)]
    installClient(lists)
    for (const d of dirs) await st().openProject(d)
    // Todas ocupadas.
    for (const d of dirs)
      st().applyEvent({ id: `busy-${d}`, type: 'session.status', properties: { sessionID: `s${d}`, status: { type: 'busy' } } } as never, d)

    await st().openProject(C)
    expect(st().openDirectories).toHaveLength(MAX_OPEN_PROJECTS)
    expect(st().openDirectories).not.toContain(C)
    expect(st().globalError).toBeTruthy()
  })
})

describe('celular (isRemoteSurface): un solo proyecto a la vez, reemplaza como siempre', () => {
  it('openProject(B) tras A deja solo B abierto', async () => {
    ;(globalThis as { window: { api?: { platform?: string } } }).window.api!.platform = REMOTE_SURFACE
    vi.resetModules()
    ;({ useCode } = await import('./store'))
    ;({ useServer } = await import('../../../stores/server'))
    installClient({ [A]: [makeSession('sa', A)], [B]: [makeSession('sb', B)] })
    await st().openProject(A)
    await st().openProject(B)
    expect(st().openDirectories).toEqual([B])
    expect(st().directory).toBe(B)
  })
})

describe('al reiniciar, los proyectos abiertos no desaparecen de la barra', () => {
  it('un proyecto abierto que aún no es de confianza sigue en la lista, pero no se cargan sus sesiones', async () => {
    const listed: string[] = []
    const client = {
      session: {
        list: ({ directory }: { directory: string }) => {
          listed.push(directory)
          return Promise.resolve({ data: [] })
        },
        status: () => Promise.resolve({ data: {} }),
        messages: () => Promise.resolve({ data: [] }),
        todo: () => Promise.resolve({ data: [] })
      },
      permission: { list: () => Promise.resolve({ data: [] }) },
      question: { list: () => Promise.resolve({ data: [] }) }
    }
    useServer.setState({ client: client as never })
    // Estado de «reinicio»: tres proyectos guardados; solo B es de confianza y A tiene el foco.
    useCode.setState({ directory: A, openDirectories: [A, B, C], trustedFolders: [B] })
    await st().restoreOpenProjects()
    expect(st().openDirectories).toEqual([A, B, C])
    expect(listed).toContain(B)
    expect(listed).not.toContain(C)
  })

  it('con todos de confianza se cargan todos', async () => {
    installClient()
    useCode.setState({ directory: A, openDirectories: [A, B], trustedFolders: [A, B] })
    await st().restoreOpenProjects()
    expect(st().openDirectories).toEqual([A, B])
  })
})
