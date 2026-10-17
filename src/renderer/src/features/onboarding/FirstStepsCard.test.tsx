// @vitest-environment jsdom
/** Tarjeta «Primeros pasos»: estructura accesible, marcado por eventos reales, ocultar, despedida y usuarios antiguos. */
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_FIRST_STEPS } from '@shared/first-steps'
import { click, mount, type Mounted } from '../../../../test/dom-render'
import { makeSession } from '../../../../test/fixtures/events'
import { useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'
import { useUi } from '../../stores/ui'
import { FirstStepsCard, FIRST_STEPS_FAREWELL_MS } from './FirstStepsCard'
import { markFirstStepDone, useFirstSteps } from '../../stores/first-steps'

function reset(): void {
  localStorage.clear()
  vi.unstubAllGlobals() // jsdom real en vez del window de setup.ts
  delete (window as unknown as { api?: unknown }).api
  useFirstSteps.setState({ state: { ...EMPTY_FIRST_STEPS, done: [] }, celebrating: false })
  useServer.setState({ status: { ...useServer.getState().status, state: 'ready' } })
  useSessions.setState({ sessions: {} })
}

let m: Mounted
const progress = (): string | undefined => m.q('[data-testid="first-steps-progress"]')?.textContent ?? undefined
const step = (id: string): HTMLElement | null => m.q(`[data-step="${id}"]`)

beforeEach(() => {
  vi.useFakeTimers()
  reset()
  m = mount(createElement(FirstStepsCard))
})
afterEach(() => {
  m.unmount()
  vi.useRealTimers()
})

describe('FirstStepsCard', () => {
  it('muestra «0 de 4» con 4 pasos como botones y una sección con nombre accesible', () => {
    expect(m.q('section[data-testid="first-steps"]')?.getAttribute('aria-label')).toBe('Primeros pasos: 0 de 4 hechos')
    expect(progress()).toBe('0 de 4')
    expect(m.qa('button[data-step]')).toHaveLength(4)
    // el estado de cada paso también llega al lector de pantalla
    expect(m.qa('.sr-only').filter((e) => e.textContent === 'pendiente')).toHaveLength(4)
  })

  it('cada paso se marca solo con su evento real y el progreso avanza', () => {
    act(() => markFirstStepDone('model'))
    expect(progress()).toBe('1 de 4')
    expect(step('model')?.hasAttribute('data-done')).toBe(true)
    expect(step('message')?.hasAttribute('data-done')).toBe(false)
    expect(m.qa('.sr-only').filter((e) => e.textContent === 'hecho')).toHaveLength(1)
    act(() => markFirstStepDone('message'))
    expect(progress()).toBe('2 de 4')
  })

  it('pulsar un paso lleva a donde se hace, pero NO lo marca', () => {
    const openSettingsAt = vi.fn()
    act(() => useUi.setState({ openSettingsAt }))
    click(step('settings'))
    expect(openSettingsAt).toHaveBeenCalledWith('instructions')
    click(step('model'))
    expect(openSettingsAt).toHaveBeenCalledWith('models')
    expect(useFirstSteps.getState().state.done).toEqual([])
  })

  it('se pliega y recuerda el pliegue (aria-expanded)', () => {
    const head = (): HTMLElement => m.q('button[aria-controls="first-steps-list"]')!
    expect(head().getAttribute('aria-expanded')).toBe('true')
    expect(head().getAttribute('aria-label')).toContain('Plegar los primeros pasos')
    click(head())
    expect(head().getAttribute('aria-expanded')).toBe('false')
    expect(head().getAttribute('aria-label')).toContain('Mostrar los primeros pasos')
    expect(step('model')).toBeNull()
    expect(localStorage.getItem('firstSteps.collapsed')).toBe('1')
  })

  it('«Ocultar» es permanente (queda guardado) y desde Ajustes se vuelve a mostrar', () => {
    const hide = m.qa('button').find((b) => b.textContent === 'Ocultar')!
    expect(hide.getAttribute('aria-label')).toContain('Ocultar los primeros pasos')
    click(hide)
    expect(m.q('[data-testid="first-steps"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('firstSteps.v1')!).hidden).toBe(true)
    act(() => useFirstSteps.getState().show())
    expect(m.q('[data-testid="first-steps"]')).not.toBeNull()
  })

  it('al completar los 4 pasos muestra un mensaje breve y desaparece sola', () => {
    act(() => {
      for (const id of ['model', 'message', 'attach', 'settings'] as const) markFirstStepDone(id)
    })
    expect(m.q('[role="status"]')?.textContent).toContain('¡Listo!')
    act(() => void vi.advanceTimersByTime(FIRST_STEPS_FAREWELL_MS + 10))
    expect(m.q('[data-testid="first-steps"]')).toBeNull()
    expect(m.q('[role="status"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('firstSteps.v1')!).finished).toBe(true)
  })

  it('ocultada, completar los pasos no muestra nada', () => {
    act(() => useFirstSteps.getState().hide())
    act(() => {
      for (const id of ['model', 'message', 'attach', 'settings'] as const) markFirstStepDone(id)
    })
    expect(m.q('[role="status"]')).toBeNull()
    expect(m.q('[data-testid="first-steps"]')).toBeNull()
  })

  it('quien ya tenía conversaciones no ve la lista; quien no, sí', () => {
    m.unmount()
    reset()
    act(() => useSessions.setState({ sessions: { c1: makeSession('c1', '/x') } }))
    m = mount(createElement(FirstStepsCard))
    expect(m.q('[data-testid="first-steps"]')).toBeNull()
    m.unmount()
    reset()
    m = mount(createElement(FirstStepsCard))
    expect(m.q('[data-testid="first-steps"]')).not.toBeNull()
  })
})
