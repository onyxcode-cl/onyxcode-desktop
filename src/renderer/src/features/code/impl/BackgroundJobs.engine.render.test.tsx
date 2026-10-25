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
  resumable: false,
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

  describe('ayudantes perdidos (Reanudar)', () => {
    const lost = (over: Partial<EngineJobRow> = {}): EngineJobRow =>
      row({ id: 'ses_h1', kind: 'ayudante', title: 'Revisar pruebas', state: 'perdido', live: false, resumable: true, ...over })

    it('un ayudante perdido muestra «Reanudar» (y no «Parar») con etiqueta accesible', () => {
      render(
        createElement(BackgroundJobs, {
          view: view([]),
          onCancel: vi.fn(),
          engineJobs: [lost()],
          onStopEngineJob: vi.fn(),
          onResumeEngineJob: vi.fn()
        })
      )
      const btns = [...host.querySelectorAll('button')]
      expect(btns).toHaveLength(1)
      expect(btns[0]!.getAttribute('aria-label')).toBe('Reanudar «Revisar pruebas»')
      expect(host.textContent).toContain('Ayudante')
      expect(host.textContent).toContain('Se perdió al reiniciar')
    })

    it('Reanudar llama a onResumeEngineJob con el id de la sesión hija', async () => {
      const onResume = vi.fn(async () => ({ ok: true as const }))
      render(createElement(BackgroundJobs, { view: view([]), onCancel: vi.fn(), engineJobs: [lost()], onResumeEngineJob: onResume }))
      act(() => host.querySelector('button')!.click())
      await flush()
      expect(onResume).toHaveBeenCalledWith('ses_h1')
      expect(host.querySelector('[role="alert"]')).toBeNull()
    })

    it('si el motor no puede, dice el motivo en la fila (tope, ya en curso, no existe) y el botón sigue disponible', async () => {
      for (const [motivo, texto] of [
        ['tope', 'demasiados ayudantes'],
        ['ya_en_curso', 'Ya está en marcha'],
        ['no_existe', 'Ya no se puede reanudar']
      ] as const) {
        const onResume = vi.fn(async () => ({ ok: false as const, motivo }))
        render(createElement(BackgroundJobs, { view: view([]), onCancel: vi.fn(), engineJobs: [lost()], onResumeEngineJob: onResume }))
        act(() => host.querySelector('button')!.click())
        await flush()
        expect(host.querySelector('[role="alert"]')?.textContent).toContain(texto)
        expect(host.querySelector('button')!.disabled).toBe(false)
      }
    })

    it('si la llamada falla (red), avisa y no rompe', async () => {
      const onResume = vi.fn(async () => {
        throw new Error('x')
      })
      render(createElement(BackgroundJobs, { view: view([]), onCancel: vi.fn(), engineJobs: [lost()], onResumeEngineJob: onResume }))
      act(() => host.querySelector('button')!.click())
      await flush()
      expect(host.querySelector('[role="alert"]')?.textContent).toBe('No se pudo reanudar.')
    })

    it('un comando perdido NO ofrece Reanudar; sin onResumeEngineJob tampoco', () => {
      render(
        createElement(BackgroundJobs, {
          view: view([]),
          onCancel: vi.fn(),
          engineJobs: [row({ state: 'perdido', live: false })],
          onResumeEngineJob: vi.fn()
        })
      )
      expect(host.querySelector('button')).toBeNull()
      render(createElement(BackgroundJobs, { view: view([]), onCancel: vi.fn(), engineJobs: [lost()] }))
      expect(host.querySelector('button')).toBeNull()
    })
  })
})
