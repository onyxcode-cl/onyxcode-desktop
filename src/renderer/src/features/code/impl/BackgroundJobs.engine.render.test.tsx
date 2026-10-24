// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundJobs } from './BackgroundJobs'
import type { BackgroundJob, BackgroundJobsView } from './background-jobs'
import type { EngineJobRow } from './engine-jobs'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const helper: BackgroundJob = {
  id: 'kid',
  title: 'Revisar pruebas',
  agent: 'explore',
  state: 'running',
  startedAt: 0,
  endedAt: null,
  elapsedMs: 5000
}
const view = (jobs: BackgroundJob[]): BackgroundJobsView => ({ jobs, liveCount: jobs.length, hidden: 0, overLimit: false })
const row = (over: Partial<EngineJobRow> = {}): EngineJobRow => ({
  id: 'sh_1',
  kind: 'shell',
  title: 'npm run build',
  state: 'en_curso',
  code: null,
  startedAt: 0,
  endedAt: null,
  elapsedMs: 65_000,
  live: true,
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
const render = (el: React.ReactElement): void => act(() => root.render(el))
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('BackgroundJobs con trabajos del motor', () => {
  it('mezcla ayudantes y trabajos del motor en una lista, con el total de vivos', () => {
    render(
      createElement(BackgroundJobs, {
        view: view([helper]),
        onCancel: vi.fn(),
        engineJobs: [
          row(),
          row({ id: 'cm_2', kind: 'celda', title: 'analiza.js', state: 'terminado', code: 2, live: false, elapsedMs: 3000 })
        ],
        onStopEngineJob: vi.fn()
      })
    )
    const items = [...host.querySelectorAll('li')]
    expect(items).toHaveLength(3)
    expect(items[0]!.textContent).toContain('Revisar pruebas')
    expect(items[1]!.textContent).toContain('npm run build')
    expect(items[1]!.textContent).toContain('Comando')
    expect(items[1]!.textContent).toContain('En curso')
    expect(items[1]!.textContent).toContain('1 min 05 s')
    expect(items[2]!.textContent).toContain('Script de Code')
    expect(items[2]!.textContent).toContain('código 2')
    expect(host.textContent).toContain('2 en segundo plano')
  })

  it('muestra los estados parado, tope de vida y perdido, sin botón de parar', () => {
    render(
      createElement(BackgroundJobs, {
        view: view([]),
        onCancel: vi.fn(),
        engineJobs: [
          row({ id: 'a', state: 'terminado_por_ti', live: false }),
          row({ id: 'b', state: 'tope_de_vida', live: false }),
          row({ id: 'c', state: 'perdido', live: false })
        ],
        onStopEngineJob: vi.fn()
      })
    )
    expect(host.textContent).toContain('Parado')
    expect(host.textContent).toContain('Alcanzó su tope de vida')
    expect(host.textContent).toContain('Se perdió al reiniciar')
    expect(host.querySelector('button')).toBeNull()
  })

  it('solo hay trabajos del motor: la banda se pinta igual', () => {
    render(createElement(BackgroundJobs, { view: view([]), onCancel: vi.fn(), engineJobs: [row()], onStopEngineJob: vi.fn() }))
    expect(host.querySelector('section')).not.toBeNull()
  })

  it('Parar llama a onStopEngineJob con el id y el botón tiene etiqueta accesible', async () => {
    const onStop = vi.fn(async () => {})
    render(createElement(BackgroundJobs, { view: view([]), onCancel: vi.fn(), engineJobs: [row()], onStopEngineJob: onStop }))
    const btn = host.querySelector('button')!
    expect(btn.getAttribute('aria-label')).toBe('Parar «npm run build»')
    act(() => btn.click())
    await flush()
    expect(onStop).toHaveBeenCalledWith('sh_1')
  })

  it('si parar falla, avisa en la fila y el botón vuelve a estar disponible', async () => {
    const onStop = vi.fn(async () => {
      throw new Error('x')
    })
    render(createElement(BackgroundJobs, { view: view([]), onCancel: vi.fn(), engineJobs: [row()], onStopEngineJob: onStop }))
    act(() => host.querySelector('button')!.click())
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('No se pudo parar.')
    expect(host.querySelector('button')!.disabled).toBe(false)
  })
})
