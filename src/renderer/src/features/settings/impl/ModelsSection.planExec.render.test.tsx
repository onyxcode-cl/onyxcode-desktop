// @vitest-environment jsdom
// D2: Ajustes › Modelos trae «Modelo para planear» y «Modelo para ejecutar» (vacíos por defecto) y los guarda.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'
import { useProviders } from '../../../stores/providers'
import { useExtrasPrefs } from './extras'
import { ModelsSection } from './ModelsSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const update = vi.fn(() => Promise.resolve())

beforeEach(() => {
  useLang.setState({ lang: 'es' })
  useProviders.setState({
    loaded: true,
    providers: [{ id: 'anthropic', name: 'Anthropic', models: { big: { id: 'big', name: 'Big' } } } as never]
  })
  useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: {} } as never, update })
  update.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Ajustes › Modelos: planear y ejecutar', () => {
  it('muestra los dos selectores, vacíos («El de la conversación»)', async () => {
    await act(async () => root.render(createElement(ModelsSection)))
    const plan = host.querySelector('[aria-label="Modelo para planear"]')
    const exec = host.querySelector('[aria-label="Modelo para ejecutar"]')
    expect(plan?.textContent).toContain('El de la conversación')
    expect(exec?.textContent).toContain('El de la conversación')
  })

  it('elegir uno lo guarda en planExecModels sin tocar el otro', async () => {
    useExtrasPrefs.setState({
      prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { exec: { providerID: 'anthropic', modelID: 'big' } } } as never
    })
    await act(async () => root.render(createElement(ModelsSection)))
    const plan = host.querySelector<HTMLButtonElement>('[aria-label="Modelo para planear"]')!
    await act(async () => plan.click())
    const opt = [...host.querySelectorAll<HTMLElement>('[role="option"], li, button')].find(
      (e) => /Big/.test(e.textContent ?? '') && e !== plan
    )
    expect(opt).toBeTruthy()
    await act(async () => opt!.click())
    expect(update).toHaveBeenCalledWith({
      planExecModels: { exec: { providerID: 'anthropic', modelID: 'big' }, plan: { providerID: 'anthropic', modelID: 'big' } }
    })
  })
})
