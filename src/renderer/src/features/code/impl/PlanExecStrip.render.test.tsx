// @vitest-environment jsdom
// D2: franja «Planear / Ejecutar» y aviso cuando el modelo elegido ya no está.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'
import { useProviders } from '../../../stores/providers'
import { useExtrasPrefs } from '../../settings/impl/extras'
import { PlanExecStrip } from './PlanExecStrip'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const strong = { providerID: 'anthropic', modelID: 'big' }
const cheap = { providerID: 'deepseek', modelID: 'cheap' }
const prov = (id: string, m: string): never => ({ id, name: id, models: { [m]: { id: m, name: m } } }) as never
const setPE = (planExecModels: object): void =>
  useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels } as never })
const render = (): Promise<void> => act(async () => root.render(createElement(PlanExecStrip, { sessionID: 's1' })))

beforeEach(() => {
  useLang.setState({ lang: 'es' })
  useProviders.setState({ loaded: true, providers: [prov('anthropic', 'big'), prov('deepseek', 'cheap')] })
  useCode.setState({ agent: 'plan', roleModels: {}, roleNotices: {} })
  setPE({})
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('PlanExecStrip', () => {
  it('sin ajustes ni aviso no pinta nada', async () => {
    await render()
    expect(host.innerHTML).toBe('')
  })

  it('muestra qué modelo planea y cuál ejecuta', async () => {
    setPE({ plan: strong, exec: cheap })
    await render()
    const txt = host.querySelector('[data-plan-exec-strip]')?.textContent ?? ''
    expect(txt).toContain('Planear: big')
    expect(txt).toContain('Ejecutar: cheap')
  })

  it('un cambio hecho en la conversación se ve en la franja', async () => {
    setPE({ plan: strong, exec: cheap })
    useCode.setState({ roleModels: { s1: { exec: strong } } })
    await render()
    expect(host.querySelector('[data-plan-exec-strip]')?.textContent).toContain('Ejecutar: big')
  })

  it('avisa (y se puede cerrar) si el modelo elegido ya no estaba disponible', async () => {
    useCode.setState({ roleNotices: { s1: { role: 'exec', wanted: { providerID: 'gone', modelID: 'x' }, used: cheap } } })
    await render()
    const n = host.querySelector('[data-plan-exec-notice]')
    expect(n?.textContent).toMatch(/ya no está disponible o no tiene clave/)
    await act(async () => host.querySelector<HTMLButtonElement>('[data-plan-exec-notice] button')?.click())
    expect(host.querySelector('[data-plan-exec-notice]')).toBeNull()
  })
})
