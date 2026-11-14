// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeSummary } from './CodeSummary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ togglePanel: vi.fn(), focusRequest: 0 }))
vi.mock('./store', () => ({
  useCode: (select: (state: unknown) => unknown) => select({ activeSessionID: null, model: null, togglePanel: mocks.togglePanel }),
  selectCodeRunOf: () => 'idle'
}))
vi.mock('./BackgroundJobsConnectors', () => ({
  useCodeBackgroundJobs: () => ({ focusRequest: mocks.focusRequest }),
  CodeBackgroundJobs: () => createElement('section', { 'data-testid': 'jobs-content' }, 'jobs')
}))
vi.mock('../../../components/ContextDetail', () => ({ ContextDetail: () => null }))
vi.mock('../../../components/UsageMeter', () => ({ UsageMeter: () => null }))
vi.mock('../../settings/impl/extras', () => ({ useModeModel: () => null }))
vi.mock('../../project-profile/ProjectCard', () => ({ ProjectCard: () => createElement('section', null, 'project') }))
vi.mock('../../project-profile/useLinkedFolders', () => ({ useLinkedFolders: () => [] }))
vi.mock('./PlanCard', () => ({ PlanCard: () => null }))
vi.mock('./ComposerControls', () => ({ useCodeAiGate: () => ({ effective: null }) }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  mocks.togglePanel.mockClear()
  mocks.focusRequest = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const mount = (): void => act(() => root.render(createElement(CodeSummary, { directory: '/project', branch: null, changes: 3 })))

describe('CodeSummary', () => {
  it('pone los trabajos después del plan y conserva la navegación a Cambios', () => {
    mount()
    expect([...host.querySelectorAll('[data-summary-card]')].map((node) => node.getAttribute('data-summary-card'))).toEqual([
      'project',
      'plan',
      'background',
      'context',
      'changes'
    ])
    expect(host.querySelector('[data-summary-card="background"] [data-testid="jobs-content"]')).not.toBeNull()
    act(() => host.querySelector<HTMLButtonElement>('[data-summary-card="changes"] > button')!.click())
    expect(mocks.togglePanel).toHaveBeenCalledWith('changes')
  })

  it('restaura el orden guardado de Código y conserva el foco solicitado para los trabajos', () => {
    localStorage.setItem('lazunox.summary-order.v1.code', JSON.stringify(['background', 'project', 'changes', 'plan', 'context']))
    mount()
    expect(host.querySelector('[data-summary-card]')?.getAttribute('data-summary-card')).toBe('background')
    mocks.focusRequest = 1
    mount()
    expect(document.activeElement).toBe(host.querySelector('[data-testid="code-summary-jobs"]'))
  })
})
