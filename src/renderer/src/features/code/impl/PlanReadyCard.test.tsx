// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { PLAN_APPROVE, PLAN_KEEP, type PlanReady } from '@shared/plan-mode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { PlanReadyCard } from './PlanReadyCard'
import { useCode } from './store'
import { useSettings } from '../../../stores/settings'
import { applyLangPref } from '../../../lib/i18n'

let host: HTMLDivElement
let root: Root
const decidePlan = vi.fn(async () => true)

const PLAN: PlanReady = {
  sessionID: 's1',
  callID: 'call_1',
  ruta: '.opencode/plans/p.md',
  rutaAbsoluta: '/p/.opencode/plans/p.md',
  contenido: '# Titular\n[enlace](https://malo.test)\n<img src=x onerror=alert(1)>',
  truncado: false,
  bytes: 70
}
const QUESTION = {
  id: 'que_1',
  sessionID: 's1',
  tool: { callID: 'call_1' },
  questions: [
    {
      question: 'q',
      header: 'h',
      options: [
        { label: PLAN_APPROVE, description: '' },
        { label: PLAN_KEEP, description: '' }
      ]
    }
  ]
}
const btn = (re: RegExp): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!

async function mount(opts: { flag?: boolean; plan?: PlanReady | null; question?: boolean } = {}): Promise<void> {
  const { flag = true, plan = PLAN, question = true } = opts
  act(() => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, modoPlan: flag } })
    useCode.setState({
      plans: plan ? { s1: plan } : {},
      questions: question ? { que_1: QUESTION as never } : {},
      decidePlan: decidePlan as never
    })
  })
  await act(async () => root.render(createElement(PlanReadyCard, { sessionID: 's1' })))
}

beforeEach(() => {
  decidePlan.mockClear()
  applyLangPref('es')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('PlanReadyCard', () => {
  it('muestra el plan como texto plano: sin enlaces, imágenes ni HTML activos', async () => {
    await mount()
    const pre = host.querySelector('pre')!
    expect(pre.textContent).toContain('[enlace](https://malo.test)')
    expect(pre.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(host.querySelector('a, img, script')).toBeNull()
    expect(host.textContent).toContain('.opencode/plans/p.md')
  })

  it('sin la bandera o sin plan no pinta nada', async () => {
    await mount({ flag: false })
    expect(host.innerHTML).toBe('')
    await mount({ plan: null })
    expect(host.innerHTML).toBe('')
  })

  it('se pliega y se despliega', async () => {
    await mount()
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('pre')!.className).toContain('max-h-[60vh]')
  })

  it('los botones llaman a decidir con la decisión correcta', async () => {
    await mount()
    await act(async () => btn(/Aprobar y editar con preguntas/).click())
    expect(decidePlan).toHaveBeenCalledWith(PLAN, 'aprobado')
    await act(async () => btn(/Seguir planificando/).click())
    expect(decidePlan).toHaveBeenLastCalledWith(PLAN, 'seguir')
  })

  it('sin la pregunta pendiente los botones están desactivados y se avisa', async () => {
    await mount({ question: false })
    expect(btn(/Aprobar y editar con preguntas/).disabled).toBe(true)
    expect(btn(/Seguir planificando/).disabled).toBe(true)
    expect(host.textContent).toContain('Esperando la pregunta')
    await act(async () => btn(/Aprobar/).click())
    expect(decidePlan).not.toHaveBeenCalled()
  })

  it('avisa si el plan viene truncado', async () => {
    await mount({ plan: { ...PLAN, truncado: true, bytes: 100_000 } })
    expect(host.textContent).toContain('El plan es largo')
  })
})
