/**
 * Como los Artifacts de Claude: cuando el agente termina de escribir/editar un documento que el
 * visor sabe mostrar (.pdf/.docx/.xlsx/.pptx), el panel del visor se abre solo (`requestViewerOpen`),
 * sin que el usuario tenga que ir a buscarlo a la lista de entregables.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { partUpdated, toolPart } from '../../../../../test/fixtures/events'

const D = '/proj'
const SRC = 'http://cw1'
let C: typeof import('./store')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;(globalThis as { window?: unknown }).window = { api: { platform: 'darwin' } }
  C = await import('./store')
  C.useTasks.setState({ folder: D, conn: { baseUrl: SRC } as never, activeTaskId: 't1', viewerRequest: null })
})

function writeCompleted(path: string, tool = 'write'): void {
  const part = toolPart('p1', 'm1', 't1', tool, { status: 'completed', input: { filePath: path } })
  const { event, directory } = partUpdated(part, D)
  C.handleEvent(event, directory)
}

describe('auto-apertura del visor al terminar de escribir un documento', () => {
  it('un .pdf recién escrito abre el visor solo', () => {
    writeCompleted('/proj/informe.pdf')
    expect(C.useTasks.getState().viewerRequest?.path).toBe('/proj/informe.pdf')
  })

  it('.docx, .xlsx y .pptx también, y cada uno sube el nonce (se ve el último)', () => {
    writeCompleted('/proj/a.docx')
    const n1 = C.useTasks.getState().viewerRequest?.nonce
    writeCompleted('/proj/b.xlsx')
    const n2 = C.useTasks.getState().viewerRequest?.nonce
    writeCompleted('/proj/c.pptx')
    const st = C.useTasks.getState()
    expect(st.viewerRequest?.path).toBe('/proj/c.pptx')
    expect(n2).toBeGreaterThan(n1!)
    expect(st.viewerRequest?.nonce).toBeGreaterThan(n2!)
  })

  it('un archivo que el visor no reconoce (.txt) no abre nada', () => {
    writeCompleted('/proj/notas.txt')
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('bash no tiene ruta directa en su input: nunca abre el visor, aunque el tool haya tocado un .pdf', () => {
    writeCompleted('/proj/informe.pdf', 'bash')
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('una tool todavía "running" (no completed) no abre nada', () => {
    const part = toolPart('p1', 'm1', 't1', 'write', { status: 'running', input: { filePath: '/proj/informe.pdf' } })
    const { event, directory } = partUpdated(part, D)
    C.handleEvent(event, directory)
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('un evento de OTRA sesión (tarea en segundo plano) no abre el visor de la tarea activa', () => {
    const part = toolPart('p1', 'm1', 'otra-tarea', 'write', { status: 'completed', input: { filePath: '/proj/informe.pdf' } })
    const { event, directory } = partUpdated(part, D)
    C.handleEvent(event, directory)
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('sin platformCaps().docViewer (p. ej. el celular) no abre nada', () => {
    ;(globalThis as { window?: unknown }).window = { api: { platform: 'remote' } }
    writeCompleted('/proj/informe.pdf')
    expect(C.useTasks.getState().viewerRequest).toBeNull()
  })

  it('"path" (no "filePath") también sirve, ya que algunas tools usan esa clave', () => {
    const part = toolPart('p1', 'm1', 't1', 'edit', { status: 'completed', input: { path: '/proj/informe.docx' } })
    const { event, directory } = partUpdated(part, D)
    C.handleEvent(event, directory)
    expect(C.useTasks.getState().viewerRequest?.path).toBe('/proj/informe.docx')
  })
})
