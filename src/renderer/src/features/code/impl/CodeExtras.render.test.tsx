// @vitest-environment jsdom
// Objetivo, Presupuesto y Revisar cambios de Code: menú (solo con la bandera), diálogos accesibles, texto plano y errores en llano.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const h = vi.hoisted(() => ({
  impl: null as null | ((ch: string, req?: Record<string, unknown>) => unknown),
  calls: [] as Array<{ ch: string; req?: Record<string, unknown> }>,
  abort: vi.fn(async () => undefined)
}))
vi.mock('../../../lib/api', () => ({
  call: async (ch: string, req?: Record<string, unknown>) => {
    h.calls.push({ ch, req })
    if (!h.impl) throw new Error('sin implementación')
    return h.impl(ch, req)
  }
}))
vi.mock('./store', () => ({ useCode: { getState: () => ({ model: { providerID: 'opencode', modelID: 'big-pickle' }, abort: h.abort }) } }))
vi.mock('../../settings/impl/extras', () => ({ resolveModelForMode: () => ({ providerID: 'p', modelID: 'm' }) }))

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineGoal } from '@shared/engine-code-extras'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useLang } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { BudgetDialog } from './BudgetDialog'
import { GoalDialog } from './GoalDialog'
import { ReviewDialog } from './ReviewDialog'
import { SessionToolsMenu } from './SessionToolsMenu'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const render = async (el: React.ReactElement): Promise<void> => {
  await act(async () => root.render(el))
  await flush()
}
const button = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
const click = async (el: Element | undefined): Promise<void> => {
  await act(async () => (el as HTMLElement).click())
  await flush()
}
const type = async (el: Element, value: string): Promise<void> => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const goal = (over: Partial<EngineGoal> = {}): EngineGoal => ({
  condition: 'Las pruebas pasan',
  cap: 10,
  state: 'activo',
  iterations: 3,
  updatedAt: 1,
  ...over
})

beforeEach(() => {
  useLang.setState({ lang: 'es' })
  h.impl = null
  h.calls = []
  h.abort.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('SessionToolsMenu', () => {
  const withExtras = (codeExtras: { goal: boolean; budget: boolean; review: boolean }): void =>
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, engineExperiments: { ...DEFAULT_SETTINGS.engineExperiments, codeExtras } } })

  it('con todo apagado (por defecto) no pinta nada', async () => {
    withExtras({ goal: false, budget: false, review: false })
    await render(createElement(SessionToolsMenu, { sessionId: 'ses_1', directory: '/p', busy: false }))
    expect(host.querySelector('[data-testid="session-tools"]')).toBeNull()
  })

  it('sin conversación abierta no pinta nada aunque haya funciones encendidas', async () => {
    withExtras({ goal: true, budget: true, review: true })
    await render(createElement(SessionToolsMenu, { sessionId: null, busy: false }))
    expect(host.querySelector('[data-testid="session-tools"]')).toBeNull()
  })

  it('solo ofrece las funciones encendidas y abre su diálogo', async () => {
    withExtras({ goal: false, budget: true, review: true })
    h.impl = (ch) => (ch === 'budget:get' ? { config: { continueOnCut: false } } : { available: false })
    await render(createElement(SessionToolsMenu, { sessionId: 'ses_1', directory: '/p', busy: false }))
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    expect(trigger.getAttribute('aria-label')).toBe('Objetivo, presupuesto y revisión')
    await click(trigger)
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)
    expect(items).toEqual(['Presupuesto…', 'Revisar cambios'])
    await click([...document.querySelectorAll('[role="menuitem"]')][0])
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    expect(h.calls[0]).toEqual({ ch: 'budget:get', req: { sessionID: 'ses_1', directory: '/p' } })
  })
})

describe('GoalDialog', () => {
  const onClose = vi.fn()
  beforeEach(() => onClose.mockClear())
  const mount = (): Promise<void> => render(createElement(GoalDialog, { sessionId: 'ses_1', directory: '/p', onClose }))

  it('sin objetivo: formulario con texto llano sobre el permiso del comando y que no empieza solo; crea con los nombres del contrato', async () => {
    h.impl = (ch) => {
      if (ch === 'goal:get') return { available: true, goal: null }
      if (ch === 'goal:set') return { available: true, ok: true, goal: goal() }
      return { available: true, ok: true }
    }
    await mount()
    const dlg = document.querySelector('[role="dialog"]')!
    expect(dlg.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dlg.textContent).toContain('No empieza solo')
    expect(dlg.textContent).toContain('pide permiso como cualquier otra orden')
    const create = button('Fijar objetivo')!
    expect(create.disabled).toBe(true) // sin condición
    await type(host.querySelector('textarea')!, '  Las pruebas pasan  ')
    await type(host.querySelector('input[placeholder*="npm test"]')!, 'npm test')
    await click(create)
    const set = h.calls.find((c) => c.ch === 'goal:set')!
    expect(set.req).toEqual({ sessionID: 'ses_1', directory: '/p', condition: 'Las pruebas pasan', verify: 'npm test', cap: 10 })
    expect(host.textContent).toContain('Objetivo fijado')
  })

  it('el tope fuera de 1..25 bloquea el botón', async () => {
    h.impl = () => ({ available: true, goal: null })
    await mount()
    await type(host.querySelector('textarea')!, 'x')
    const cap = host.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!
    await type(cap, '26')
    expect(button('Fijar objetivo')!.disabled).toBe(true)
    await type(cap, '25')
    expect(button('Fijar objetivo')!.disabled).toBe(false)
  })

  it('con objetivo: estado, motivo y progreso como TEXTO (sin marcado), con Quitar y Reanudar cuando está en pausa', async () => {
    h.impl = (ch) => {
      if (ch === 'goal:get')
        return {
          available: true,
          goal: goal({
            state: 'pausado',
            reason: 'Rechazaste <b>un permiso</b> [x](http://evil.example)',
            verify: 'npm test',
            lastVerification: { code: 1, output: '<img src=x onerror=alert(1)>' }
          })
        }
      if (ch === 'goal:set') return { available: true, ok: true, goal: goal() }
      return { available: true, ok: true }
    }
    await mount()
    const status = host.querySelector('[data-testid="goal-status"]')!
    expect(status.textContent).toContain('En pausa')
    expect(status.textContent).toContain('Continuaciones automáticas: 3 de 10')
    expect(status.textContent).toContain('Rechazaste <b>un permiso</b> [x](http://evil.example)')
    expect(host.querySelector('a')).toBeNull()
    expect(host.querySelector('b')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
    await click(button('Reanudar'))
    expect(h.calls.find((c) => c.ch === 'goal:set')!.req).toEqual({
      sessionID: 'ses_1',
      directory: '/p',
      condition: 'Las pruebas pasan',
      verify: 'npm test',
      cap: 10,
      resume: true
    })
    await click(button('Quitar objetivo'))
    expect(h.calls.some((c) => c.ch === 'goal:clear')).toBe(true)
  })

  it('un objetivo cumplido no ofrece Reanudar', async () => {
    h.impl = () => ({ available: true, goal: goal({ state: 'cumplido' }) })
    await mount()
    expect(button('Reanudar')).toBeUndefined()
    expect(button('Quitar objetivo')).toBeDefined()
  })

  it('motor sin la ruta: lo dice en llano', async () => {
    h.impl = () => ({ available: false })
    await mount()
    expect(host.textContent).toContain('Este motor no tiene esta función')
    expect(button('Fijar objetivo')).toBeUndefined()
  })

  it('error de red: mensaje en llano con Reintentar (que vuelve a preguntar); Esc cierra', async () => {
    h.impl = () => {
      throw new Error('boom')
    }
    await mount()
    expect(host.textContent).toContain('No se pudo consultar al motor: boom')
    h.impl = () => ({ available: true, goal: null })
    await click(button('Reintentar'))
    expect(host.textContent).toContain('Qué debe cumplirse')
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('la entrada rechazada por el motor se explica en llano', async () => {
    h.impl = (ch) => (ch === 'goal:get' ? { available: true, goal: null } : { available: true, ok: false, error: 'invalid' })
    await mount()
    await type(host.querySelector('textarea')!, 'algo')
    await click(button('Fijar objetivo'))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('El motor no aceptó ese objetivo')
  })
})

describe('BudgetDialog', () => {
  const onClose = vi.fn()
  const mount = (): Promise<void> => render(createElement(BudgetDialog, { sessionId: 'ses_1', onClose }))
  const field = (label: string): HTMLInputElement => host.querySelector<HTMLInputElement>(`input[id$="-${label}"]`)!

  it('carga lo guardado, valida y guarda con la configuración exacta', async () => {
    h.impl = (ch, req) =>
      ch === 'budget:get' ? { config: { steps: 5, continueOnCut: true } } : { config: (req as { config: unknown }).config }
    await mount()
    expect(field('steps').value).toBe('5')
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true)
    await type(field('tokens'), '40000')
    await type(field('minutes'), '30')
    await click(button('Guardar'))
    expect(h.calls.find((c) => c.ch === 'budget:set')!.req).toEqual({
      sessionID: 'ses_1',
      config: { tokens: 40000, steps: 5, minutes: 30, continueOnCut: true }
    })
    expect(host.textContent).toContain('Presupuesto guardado')
  })

  it('números inválidos desactivan Guardar y avisan; «Quitar límites» envía la configuración vacía', async () => {
    h.impl = (ch, req) =>
      ch === 'budget:get' ? { config: { tokens: 20000, continueOnCut: false } } : { config: (req as { config: unknown }).config }
    await mount()
    await type(field('steps'), '0')
    expect(button('Guardar')!.disabled).toBe(true)
    expect(host.textContent).toContain('Revisa los números')
    await type(field('steps'), '')
    expect(button('Guardar')!.disabled).toBe(false)
    await click(button('Quitar límites'))
    expect(h.calls.find((c) => c.ch === 'budget:set')!.req).toEqual({ sessionID: 'ses_1', config: { continueOnCut: false } })
    expect(host.textContent).toContain('Límites quitados')
  })

  it('un fallo al guardar se muestra y no cierra el diálogo', async () => {
    h.impl = (ch) => {
      if (ch === 'budget:get') return { config: { continueOnCut: false } }
      throw new Error('El motor respondió 500')
    }
    await mount()
    await type(field('steps'), '4')
    await click(button('Guardar'))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('500')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})

describe('ReviewDialog', () => {
  const onClose = vi.fn()
  const mount = (busy = false): Promise<void> => render(createElement(ReviewDialog, { sessionId: 'ses_1', directory: '/p', busy, onClose }))
  const finding = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: 'Desfase de uno',
    body: 'Trae un elemento de más. [mira](http://evil.example) <script>alert(1)</script>',
    priority: 'P1',
    confidence: 0.85,
    file: 'src/a.ts',
    line: 12,
    ...over
  })

  it('lanza la revisión con el modelo elegido y pinta los hallazgos por archivo y línea como texto plano', async () => {
    h.impl = () => ({
      status: 'ok',
      skipped: 1,
      report: {
        correct: false,
        explanation: 'Hay un error.',
        findings: [
          { ...finding(), lineEnd: undefined },
          { ...finding({ line: 3, priority: 'P3', title: 'Menor' }), lineEnd: 5 },
          { ...finding({ file: 'src/b.ts', line: 1, priority: 'P0', title: 'Grave' }) }
        ]
      }
    })
    await mount()
    await click(button('Empezar revisión'))
    expect(h.calls[0]).toEqual({ ch: 'review:run', req: { sessionID: 'ses_1', directory: '/p', model: 'opencode/big-pickle' } })
    const report = host.querySelector('[data-testid="review-report"]')!
    expect(report.textContent).toContain('El revisor encontró problemas en el cambio.')
    expect(report.textContent).toContain('línea 12')
    expect(report.textContent).toContain('líneas 3 a 5')
    expect(report.textContent).toContain('Certeza: 85 %')
    expect(report.textContent).toContain('P0 · Rompe el programa o pierde datos')
    expect(report.textContent).toContain('Se descartó 1 hallazgo mal formado.')
    expect(report.textContent).toContain('lo escribió una IA')
    expect([...report.querySelectorAll('h3')].map((x) => x.textContent)).toEqual(['src/a.ts', 'src/b.ts'])
    // Texto plano: ni enlaces, ni elementos creados desde el texto del modelo.
    expect(report.querySelector('a')).toBeNull()
    expect(report.querySelector('script')).toBeNull()
    expect(report.textContent).toContain('[mira](http://evil.example) <script>alert(1)</script>')
  })

  it('sin hallazgos, ilegible, sin comando y error se dicen en llano', async () => {
    h.impl = () => ({ status: 'ok', skipped: 0, report: { correct: true, explanation: '', findings: [] } })
    await mount()
    await click(button('Empezar revisión'))
    expect(host.textContent).toContain('No se encontraron problemas')
    h.impl = () => ({ status: 'unreadable' })
    await click(button('Empezar revisión'))
    expect(host.textContent).toContain('No se pudo leer el resultado de la revisión')
    h.impl = () => ({ status: 'unavailable' })
    await click(button('Empezar revisión'))
    expect(host.textContent).toContain('Este motor no tiene esta función')
    h.impl = () => {
      throw new Error('El motor respondió 500')
    }
    await click(button('Empezar revisión'))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('500')
  })

  it('mientras revisa se puede cancelar (aborta la sesión) y el resultado tardío se ignora; con la IA ocupada no deja empezar', async () => {
    let release: (v: unknown) => void = () => undefined
    h.impl = () => new Promise((r) => (release = r))
    await mount()
    await click(button('Empezar revisión'))
    expect(host.textContent).toContain('Revisando los cambios')
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite')
    await click(button('Cancelar revisión'))
    expect(h.abort).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Revisión cancelada')
    await act(async () => release({ status: 'ok', skipped: 0, report: { correct: true, explanation: '', findings: [] } }))
    await flush()
    expect(host.querySelector('[data-testid="review-report"]')).toBeNull()
    await mount(true)
    expect(button('Empezar revisión')!.disabled).toBe(true)
    expect(host.textContent).toContain('Espera a que la IA termine')
  })
})
