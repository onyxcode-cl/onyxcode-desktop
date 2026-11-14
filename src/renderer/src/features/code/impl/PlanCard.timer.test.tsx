// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanCard } from './PlanCard'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.unstubAllGlobals()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useCode.setState({ todos: { s: [{ content: 'Crear estructura', status: 'in_progress', priority: 'medium' }] } })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('reloj del plan', () => {
  it('cuenta al trabajar, se detiene al quedar inactiva y vuelve a contar al reanudar', () => {
    act(() => root.render(<PlanCard sessionID="s" busy />))
    act(() => vi.advanceTimersByTime(14_000))
    expect(host.textContent).toContain('trabajando · 0:14')
    expect(vi.getTimerCount()).toBe(1)
    act(() => root.render(<PlanCard sessionID="s" busy={false} />))
    expect(vi.getTimerCount()).toBe(0)
    expect(host.textContent).toContain('sin confirmar')
    expect(host.textContent).not.toContain('trabajando')
    const idleText = host.textContent
    act(() => vi.advanceTimersByTime(60_000))
    expect(host.textContent).toBe(idleText)
    act(() => root.render(<PlanCard sessionID="s" busy />))
    act(() => vi.advanceTimersByTime(2000))
    expect(host.textContent).toContain('trabajando · 0:02')
    expect(vi.getTimerCount()).toBe(1)
  })
})
