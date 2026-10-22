// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundJobs } from './BackgroundJobs'
import type { BackgroundJob, BackgroundJobsView } from './background-jobs'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: 'c1',
  title: 'Revisar pruebas',
  agent: 'explore',
  state: 'running',
  startedAt: 0,
  endedAt: null,
  elapsedMs: 65_000,
  ...over
})
const view = (jobs: BackgroundJob[], over: Partial<BackgroundJobsView> = {}): BackgroundJobsView => ({
  jobs,
  liveCount: jobs.filter((j) => j.state === 'running' || j.state === 'waiting').length,
  hidden: 0,
  overLimit: false,
  ...over
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const mount = (v: BackgroundJobsView, onCancel: (id: string) => Promise<void> | void = () => undefined): void =>
  act(() => root.render(createElement(BackgroundJobs, { view: v, onCancel })))

describe('BackgroundJobs', () => {
  it('sin trabajos no pinta nada', () => {
    mount(view([]))
    expect(host.innerHTML).toBe('')
  })

  it('lista con nombre accesible, estado en texto, tiempo y un botón Cancelar con nombre propio', () => {
    mount(view([job(), job({ id: 'c2', title: 'Buscar usos', state: 'waiting', elapsedMs: 9000 })]))
    const sec = host.querySelector('section')!
    expect(sec.getAttribute('aria-label')).toBe('Trabajos en segundo plano')
    expect(host.querySelectorAll('li')).toHaveLength(2)
    expect(host.textContent).toContain('Revisar pruebas')
    expect(host.textContent).toContain('Trabajando')
    expect(host.textContent).toContain('Espera tu permiso')
    expect(host.textContent).toContain('1 min 05 s')
    const names = [...host.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Cancelar «Revisar pruebas»', 'Cancelar «Buscar usos»'])
  })

  it('Cancelar llama a la API con el id de la sesión hija y se desactiva', async () => {
    const onCancel = vi.fn(async () => undefined)
    mount(view([job()]), onCancel)
    const b = host.querySelector('button')!
    act(() => b.click())
    await flush()
    expect(onCancel).toHaveBeenCalledWith('c1')
    expect(b.disabled).toBe(true)
  })

  it('si cancelar falla, lo dice con role=alert y deja reintentar', async () => {
    mount(
      view([job()]),
      vi.fn(async () => {
        throw new Error('x')
      })
    )
    const b = host.querySelector('button')!
    act(() => b.click())
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('No se pudo cancelar.')
    expect(b.disabled).toBe(false)
  })

  it('los terminados no tienen botón Cancelar y se anuncian con texto', () => {
    mount(view([job({ state: 'done', endedAt: 1 }), job({ id: 'c2', state: 'failed', endedAt: 1 })]))
    expect(host.querySelectorAll('button')).toHaveLength(0)
    expect(host.textContent).toContain('Terminó')
    expect(host.textContent).toContain('Falló')
  })

  it('al pasar del tope avisa con role=status', () => {
    mount(view([job()], { liveCount: 6, hidden: 5, overLimit: true }))
    const st = host.querySelector('[role="status"]')!
    expect(st.textContent).toContain('Hay 6 trabajos a la vez; se muestran 4.')
  })
})
