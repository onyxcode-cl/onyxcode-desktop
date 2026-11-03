/**
 * Al terminar el turno el visor abre solo el entregable principal aunque no saliera de `write`/`edit` (`documentos_crear`, scripts por
 * `bash`): una vez por tarea, sin robar el foco y sin tocar lo que la persona ya abrió.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TasksDeliverable } from '@shared/ipc-tasks'
import { makeSession } from '../../../../../test/fixtures/events'

const h = vi.hoisted(() => ({ files: [] as TasksDeliverable[] }))
vi.mock('./bridge', async (orig) => ({ ...(await orig<typeof import('./bridge')>()), cw: vi.fn(async () => h.files) }))

const D = '/proj'
let C: typeof import('./store')
let useSessions: (typeof import('../../../stores/sessions'))['useSessions']

const f = (rel: string, mtime: number): TasksDeliverable => ({ path: `${D}/${rel}`, relPath: rel, size: 10, mtime })

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;(globalThis as { window?: unknown }).window = { api: { platform: 'darwin' } }
  ;({ useSessions } = await import('../../../stores/sessions'))
  C = await import('./store')
  useSessions.setState({ sessions: { t1: makeSession('t1', D), t2: makeSession('t2', D) } } as never)
  C.useTasks.setState({ folder: D, conn: { baseUrl: 'http://cw1' } as never, activeTaskId: 't1', viewerRequest: null, deliverables: {} })
  h.files = []
})

describe('auto-apertura del entregable principal al terminar el turno', () => {
  it('abre el documento más reciente aunque no viniera de write/edit, marcado como automático', async () => {
    h.files = [f('viejo.docx', 100), f('informe.pptx', 300), f('notas.txt', 400), f('.lazunox/trabajo/spec.json', 500)]
    await C.autoOpenMainDeliverable('t1')
    expect(C.useTasks.getState().viewerRequest).toMatchObject({ path: `${D}/informe.pptx`, auto: true })
  })

  it('una sola vez por tarea: si la persona lo cierra, no se vuelve a abrir', async () => {
    h.files = [f('a.xlsx', 100)]
    await C.autoOpenMainDeliverable('t1')
    C.clearViewerRequest()
    h.files = [f('a.xlsx', 100), f('b.docx', 200)]
    await C.autoOpenMainDeliverable('t1')
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('si el visor ya muestra algo (la persona abrió otro archivo) no lo pisa', async () => {
    C.requestViewerOpen(`${D}/suyo.pdf`)
    h.files = [f('a.docx', 100)]
    await C.autoOpenMainDeliverable('t1')
    expect(C.useTasks.getState().viewerRequest?.path).toBe(`${D}/suyo.pdf`)
    expect(C.useTasks.getState().viewerRequest?.auto).toBeUndefined()
  })

  it('si ya se abrió al escribir (write), el final del turno no lo repite', async () => {
    const { toolPart } = await import('../../../../../test/fixtures/events')
    const { partUpdated } = await import('../../../../../test/fixtures/events')
    const { event, directory } = partUpdated(
      toolPart('p1', 'm1', 't1', 'write', { status: 'completed', input: { filePath: `${D}/a.pdf` } }),
      D
    )
    C.handleEvent(event, directory)
    C.clearViewerRequest()
    h.files = [f('a.pdf', 100)]
    await C.autoOpenMainDeliverable('t1')
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('sin documentos (solo .txt o auxiliares) no abre nada', async () => {
    h.files = [f('notas.txt', 100), f('.lazunox/trabajo/x.pdf', 200)]
    await C.autoOpenMainDeliverable('t1')
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('si la persona cambió a otra tarea mientras tanto no abre el de la anterior', async () => {
    h.files = [f('a.docx', 100)]
    const p = C.autoOpenMainDeliverable('t1')
    C.useTasks.setState({ activeTaskId: 't2' })
    await p
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('sin visor de documentos (celular) no abre nada', async () => {
    ;(globalThis as { window?: unknown }).window = { api: { platform: 'remote' } }
    h.files = [f('a.docx', 100)]
    await C.autoOpenMainDeliverable('t1')
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('el evento session.idle de la tarea activa lo dispara', async () => {
    h.files = [f('a.docx', 100)]
    C.handleEvent({ id: 'e1', type: 'session.idle', properties: { sessionID: 't1' } } as never, D)
    await vi.waitFor(() => expect(C.useTasks.getState().viewerRequest?.path).toBe(`${D}/a.docx`))
  })
})
