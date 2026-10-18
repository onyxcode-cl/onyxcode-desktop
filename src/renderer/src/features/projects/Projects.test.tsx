// @vitest-environment jsdom
/** Proyectos del Chat: barra lateral, pantalla del proyecto (archivos, estados, accesibilidad) y chip de la caja de escribir. */
import { createElement } from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectFileInfo, ProjectInfo, ProjectsState } from '@shared/ipc-extras'
import { click, mount, typeInto, type Mounted } from '../../../../test/dom-render'
import { useSessions } from '../../stores/sessions'
import { useChat } from '../chat/store'
import { ProjectChip } from './ProjectChip'
import { ProjectView } from './ProjectView'
import { ProjectsSidebarSection } from './ProjectsSidebar'
import { useProjects } from './store'

const LIMITS = {
  maxProjects: 50,
  maxFilesPerProject: 20,
  maxFileBytes: 10 * 1024 * 1024,
  maxProjectBytes: 50 * 1024 * 1024,
  maxCharsPerFile: 400_000,
  maxInstructionsChars: 4000,
  maxNameChars: 80,
  maxPassages: 5,
  maxInjectedChars: 5000,
  extensions: ['pdf', 'docx', 'md']
}
const ID = 'a'.repeat(16)
const ID2 = 'b'.repeat(16)

const ready = (name: string, over: Partial<ProjectFileInfo> = {}): ProjectFileInfo => ({
  id: name.padEnd(16, '0').slice(0, 16),
  name,
  bytes: 2048,
  addedAt: 1,
  status: 'ready',
  chunks: 3,
  ...over
})
const project = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id: ID,
  name: 'Contratos',
  instructions: 'Responde formal.',
  createdAt: 1,
  updatedAt: 1,
  files: [],
  usedBytes: 0,
  ...over
})
const stateOf = (projects: ProjectInfo[], assignments: Record<string, string> = {}): ProjectsState => ({
  projects,
  assignments,
  limits: LIMITS
})

let m: Mounted | null = null
let invoke: ReturnType<typeof vi.fn>
const q = (id: string): HTMLElement | null => m!.q(`[data-testid="${id}"]`)
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function setApi(handler: (channel: string, req?: unknown) => unknown): void {
  invoke = vi.fn(async (channel: string, req?: unknown) => handler(channel, req))
  ;(window as unknown as { api: unknown }).api = { extras: { invoke, on: () => () => undefined } }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  useProjects.setState({ state: null, loading: false, error: null, viewId: null, pendingId: null, upload: null })
  useChat.setState({ activeSessionId: null })
  useSessions.setState({ sessions: {} })
})
afterEach(() => {
  m?.unmount()
  m = null
  delete (window as unknown as { api?: unknown }).api
})

describe('ProjectsSidebarSection', () => {
  it('sin puente (celular o ventana sin extras) no se pinta', () => {
    delete (window as unknown as { api?: unknown }).api
    m = mount(createElement(ProjectsSidebarSection))
    expect(m.host.innerHTML).toBe('')
  })

  it('estado vacío con una explicación llana y botón para crear', async () => {
    setApi((c) => (c === 'projects:list' ? stateOf([]) : undefined))
    m = mount(createElement(ProjectsSidebarSection))
    await flush()
    expect(q('projects-sidebar')!.textContent).toContain('Reúne instrucciones y archivos en un proyecto')
    expect(q('projects-new')!.getAttribute('aria-label')).toBe('Nuevo proyecto')
  })

  it('lista los proyectos con su número de archivos y abre el elegido', async () => {
    setApi((c) =>
      c === 'projects:list'
        ? stateOf([
            project({ files: [ready('a.md'), ready('b.md'), { ...ready('c.md'), status: 'error', reason: 'corrupt' }] }),
            project({ id: ID2, name: 'Otro' })
          ])
        : undefined
    )
    m = mount(createElement(ProjectsSidebarSection))
    await flush()
    const rows = m.qa('[data-testid="project-row"]')
    expect(rows.map((r) => r.textContent)).toEqual(['Contratos2 archivos', 'Otro0 archivos'])
    click(rows[1])
    expect(useProjects.getState().viewId).toBe(ID2)
    expect(m.qa('[data-testid="project-row"]')[1].getAttribute('aria-current')).toBe('page')
  })

  it('error al cargar: aviso con «Reintentar»', async () => {
    let fail = true
    setApi((c) => {
      if (c !== 'projects:list') return undefined
      if (fail) throw new Error('boom')
      return stateOf([])
    })
    m = mount(createElement(ProjectsSidebarSection))
    await flush()
    expect(m.q('[role="alert"]')!.textContent).toContain('No se pudieron cargar los proyectos')
    fail = false
    click(m.q('[role="alert"] button'))
    await flush()
    expect(m.q('[role="alert"]')).toBeNull()
  })
})

describe('ProjectView', () => {
  const open = (p: ProjectInfo, assignments: Record<string, string> = {}): void => {
    useProjects.setState({ state: stateOf([p], assignments), viewId: p.id })
  }

  it('cargando: mensaje de estado, sin la pantalla', () => {
    setApi(() => undefined)
    useProjects.setState({ viewId: ID, loading: true })
    m = mount(createElement(ProjectView))
    expect(m.q('[role="status"]')!.textContent).toContain('Cargando el proyecto')
  })

  it('un proyecto que ya no existe se dice y se puede volver', () => {
    setApi(() => undefined)
    useProjects.setState({ state: stateOf([]), viewId: ID })
    m = mount(createElement(ProjectView))
    expect(m.host.textContent).toContain('Este proyecto ya no existe')
    click(m.q('button')!)
    expect(useProjects.getState().viewId).toBeNull()
  })

  it('sin archivos: estado vacío, límites y aviso de qué sale del equipo, con regiones con nombre', () => {
    setApi(() => undefined)
    open(project())
    m = mount(createElement(ProjectView))
    const region = m.q('[role="region"]')!
    expect(region.getAttribute('aria-label')).toBe('Proyecto Contratos')
    expect(m.host.textContent).toContain('Aún no hay archivos')
    expect(m.host.textContent).toContain('Hasta 20 archivos de 10 MB cada uno, y 50 MB en total')
    expect(m.host.textContent).toContain('Los archivos se copian a este equipo y se leen aquí, sin enviarlos a ningún servicio')
    expect(m.host.textContent).toContain('solo viajan las instrucciones del proyecto y los fragmentos de los archivos')
    expect(m.host.textContent).toContain('0 de 20 archivos')
    expect(document.activeElement?.tagName).toBe('H1')
  })

  it('lista archivos listos y con error (con el motivo en lenguaje llano) y el espacio usado', () => {
    setApi(() => undefined)
    open(
      project({
        usedBytes: 3 * 1024 * 1024,
        files: [
          ready('informe.docx'),
          ready('largo.pdf', { truncated: true }),
          { ...ready('clave.txt'), status: 'error', reason: 'reserved', chunks: undefined },
          { ...ready('escaneo.pdf'), status: 'error', reason: 'noText', chunks: undefined }
        ]
      })
    )
    m = mount(createElement(ProjectView))
    const rows = m.qa('[data-testid="project-file"]')
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Listo · 3 fragmentos')
    expect(rows[1].textContent).toContain('Listo · solo se leyó el principio')
    expect(rows[2].textContent).toContain('No se pudo leer. Parece un archivo con claves o secretos')
    expect(rows[3].textContent).toContain('Es solo imagen (sin texto)')
    expect(q('project-files-count')!.textContent).toMatch(/2 de 20 archivos · Espacio usado: 3 MB de 50 MB/)
  })

  it('guardar las instrucciones solo se habilita si cambian, y llama a projects:update', async () => {
    setApi((c) => (c === 'projects:update' ? stateOf([project({ instructions: 'Nuevas.' })]) : undefined))
    open(project())
    m = mount(createElement(ProjectView))
    const save = q('project-instructions-save') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    typeInto(q('project-instructions') as HTMLTextAreaElement, 'Nuevas.')
    expect(save.disabled).toBe(false)
    click(save)
    await flush()
    expect(invoke).toHaveBeenCalledWith('projects:update', { id: ID, instructions: 'Nuevas.' })
    expect(m.host.textContent).toContain('Instrucciones guardadas.')
    expect((q('project-instructions') as HTMLTextAreaElement).maxLength).toBe(4000)
  })

  it('«Añadir archivos»: diálogo nativo → lee cada ficha en orden y avisa el progreso y el resultado', async () => {
    const resolvers: Array<() => void> = []
    const done = (name: string): ProjectFileInfo => ready(name)
    setApi((c, req) => {
      if (c === 'projects:pickFiles')
        return [
          { token: 't'.repeat(32), name: 'uno.md', bytes: 10 },
          { token: 'u'.repeat(32), name: 'dos.pdf', bytes: 10 }
        ]
      if (c === 'projects:addPicked') {
        const tk = (req as { token: string }).token
        return new Promise((res) =>
          resolvers.push(() => res({ state: stateOf([project()]), file: done(tk[0] === 't' ? 'uno.md' : 'dos.pdf') }))
        )
      }
      if (c === 'projects:list') return stateOf([project({ files: [ready('uno.md'), ready('dos.pdf')] })])
      return undefined
    })
    open(project())
    m = mount(createElement(ProjectView))
    click(q('project-add-files'))
    await flush()
    expect(q('project-live')!.textContent).toContain('Leyendo uno.md (1 de 2)…')
    expect((q('project-add-files') as HTMLButtonElement).disabled).toBe(true)
    expect(q('project-live')!.getAttribute('aria-live')).toBe('polite')
    await act(async () => resolvers.shift()!())
    await flush()
    expect(q('project-live')!.textContent).toContain('Leyendo dos.pdf (2 de 2)…')
    await act(async () => resolvers.shift()!())
    await flush()
    expect(q('project-live')!.textContent).toContain('Listo: 2 archivos añadidos.')
    expect(invoke.mock.calls.filter(([c]) => c === 'projects:addPicked')).toHaveLength(2)
    // nunca se mandó una ruta
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/\/Users|\\\\/)
  })

  it('un archivo que no se pudo leer se cuenta aparte en el resumen', async () => {
    setApi((c) => {
      if (c === 'projects:pickFiles') return [{ token: 't'.repeat(32), name: 'x.docx', bytes: 10 }]
      if (c === 'projects:addPicked')
        return { state: stateOf([project()]), file: { ...ready('x.docx'), status: 'error', reason: 'encrypted', chunks: undefined } }
      if (c === 'projects:list') return stateOf([project()])
      return undefined
    })
    open(project())
    m = mount(createElement(ProjectView))
    click(q('project-add-files'))
    await flush()
    await flush()
    expect(q('project-live')!.textContent).toContain('Ningún archivo se pudo añadir')
  })

  it('un archivo que pasa del tope por archivo ni se lee ni se envía: se rechaza aquí con el motivo', async () => {
    setApi((c) => (c === 'projects:list' ? stateOf([project()]) : undefined))
    open(project())
    m = mount(createElement(ProjectView))
    const big = new File(['x'], 'enorme.pdf')
    Object.defineProperty(big, 'size', { value: LIMITS.maxFileBytes + 1 })
    await act(async () => {
      await useProjects.getState().addFiles(ID, [{ kind: 'dropped', file: big }])
    })
    expect(invoke.mock.calls.some(([c]) => c === 'projects:addBytes')).toBe(false)
    const row = q('project-upload')!
    expect(row.getAttribute('data-status')).toBe('error')
    expect(row.textContent).toContain('Pesa más que el límite por archivo')
  })

  it('arrastrar archivos los envía como bytes en base64 y muestra la zona de soltar', async () => {
    setApi((c) => {
      if (c === 'projects:addBytes') return { state: stateOf([project()]), file: ready('nota.md') }
      if (c === 'projects:list') return stateOf([project()])
      return undefined
    })
    open(project())
    m = mount(createElement(ProjectView))
    const region = m.q('[role="region"]')!
    const file = new File(['hola'], 'nota.md', { type: 'text/markdown' })
    const dt = { types: ['Files'], files: [file] }
    const ev = (type: string): Event => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: dt })
    act(() => void region.dispatchEvent(ev('dragenter')))
    expect(q('project-drop')!.textContent).toContain('Suelta los archivos para añadirlos al proyecto')
    await act(async () => {
      region.dispatchEvent(ev('drop'))
      await new Promise((r) => setTimeout(r, 30))
    })
    await flush()
    const call = invoke.mock.calls.find(([c]) => c === 'projects:addBytes')!
    expect(call[1]).toEqual({ id: ID, name: 'nota.md', base64: Buffer.from('hola').toString('base64') })
    expect(q('project-drop')).toBeNull()
  })

  it('quitar un archivo llama a projects:removeFile con su id', async () => {
    const f = ready('a.md')
    setApi((c) => (c === 'projects:removeFile' ? stateOf([project()]) : undefined))
    open(project({ files: [f] }))
    m = mount(createElement(ProjectView))
    click(m.q(`button[aria-label="Quitar a.md"]`))
    await flush()
    expect(invoke).toHaveBeenCalledWith('projects:removeFile', { id: ID, fileId: f.id })
  })

  it('lista las conversaciones del proyecto y las abre', () => {
    setApi(() => undefined)
    open(project(), { ses_1: ID, ses_2: ID2 })
    useSessions.setState({
      sessions: {
        ses_1: { id: 'ses_1', title: 'Canon de la bodega', time: { created: 1, updated: 5 } },
        ses_2: { id: 'ses_2', title: 'De otro proyecto', time: { created: 1, updated: 9 } }
      } as never
    })
    m = mount(createElement(ProjectView))
    const items = m.qa('[data-testid="project-conversation"]')
    expect(items.map((i) => i.textContent)).toEqual(['Canon de la bodega'])
  })

  it('«Nueva conversación en este proyecto» deja el proyecto elegido y vuelve al chat', () => {
    setApi(() => undefined)
    open(project())
    m = mount(createElement(ProjectView))
    click(q('project-new-chat'))
    expect(useProjects.getState().pendingId).toBe(ID)
    expect(useProjects.getState().viewId).toBeNull()
  })

  it('un error del motor se muestra en lenguaje llano, sin el texto crudo', () => {
    setApi(() => undefined)
    open(project())
    useProjects.setState({ error: 'Error invoking remote method projects:update: boom' })
    m = mount(createElement(ProjectView))
    const alert = q('project-error')!
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('No se pudo completar la acción')
    expect(alert.textContent).not.toContain('Error invoking')
  })
})

describe('ProjectChip', () => {
  it('sin puente no se pinta', () => {
    delete (window as unknown as { api?: unknown }).api
    m = mount(createElement(ProjectChip))
    expect(m.host.innerHTML).toBe('')
  })

  it('en una conversación nueva deja elegido el proyecto; en una creada la asigna', async () => {
    setApi((c, req) =>
      c === 'projects:assign'
        ? stateOf([project(), project({ id: ID2, name: 'Otro' })], { ses_1: (req as { projectId: string }).projectId })
        : undefined
    )
    useProjects.setState({ state: stateOf([project(), project({ id: ID2, name: 'Otro' })]) })
    m = mount(createElement(ProjectChip))
    const chip = q('project-chip') ?? m.q('button')!
    expect(chip.textContent).toContain('Sin proyecto')
    click(chip)
    const opts = m.qa('[role="menuitemradio"]')
    expect(opts.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Contratos'), expect.stringContaining('Otro')])
    )
    click(opts.find((o) => o.textContent?.includes('Contratos'))!)
    expect(useProjects.getState().pendingId).toBe(ID)

    // conversación ya creada: cambia en main
    act(() => {
      useChat.setState({ activeSessionId: 'ses_1' })
      useProjects.setState({ pendingId: null })
    })
    m.rerender(createElement(ProjectChip))
    click(m.q('button')!)
    click(m.qa('[role="menuitemradio"]').find((o) => o.textContent?.includes('Otro'))!)
    await flush()
    expect(invoke).toHaveBeenCalledWith('projects:assign', { sessionId: 'ses_1', projectId: ID2 })
  })
})
