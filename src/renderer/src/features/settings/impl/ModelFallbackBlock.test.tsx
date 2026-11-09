// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { DEFAULT_SETTINGS } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const callMock = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api', () => ({ call: callMock, api: { on: () => () => undefined } }))

import { freeProviders, ModelFallbackBlock } from './ModelFallbackBlock'
import { useSettings } from '../../../stores/settings'
import { applyLangPref } from '../../../lib/i18n'

const model = (id: string, cost?: { input: number; output: number }, status = 'active'): unknown => ({
  id,
  name: `Modelo ${id}`,
  status,
  cost
})
const providers = [
  {
    id: 'opencode',
    name: 'OpenCode',
    models: { 'big-free': model('big-free', { input: 0, output: 0 }), caro: model('caro', { input: 1, output: 2 }), sin: model('sin') }
  },
  {
    id: 'otro',
    name: 'Otro',
    models: { gratis: model('gratis', { input: 0, output: 0 }), viejo: model('viejo', { input: 0, output: 0 }, 'deprecated') }
  }
] as unknown as Provider[]

let host: HTMLDivElement
let root: Root
let update: ReturnType<typeof vi.fn>

function mount(modelFallback = DEFAULT_SETTINGS.modelFallback): void {
  update = vi.fn(async () => undefined)
  act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, modelFallback }, update }))
  act(() => root.render(createElement(ModelFallbackBlock, { providers })))
}
beforeEach(() => {
  applyLangPref('es')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('ModelFallbackBlock', () => {
  it('solo ofrece modelos de coste 0 declarado, sin retirados ni los ya elegidos', () => {
    const all = freeProviders(providers, [])
    expect(all.flatMap((p) => Object.keys(p.models).map((m) => `${p.id}/${m}`))).toEqual(['opencode/big-free', 'otro/gratis'])
    expect(freeProviders(providers, ['otro/gratis']).map((p) => p.id)).toEqual(['opencode'])
  })

  it('«otro servicio» está apagado por defecto y el aviso solo sale al encenderlo; al encender guarda true', () => {
    mount()
    const sw = host.querySelector<HTMLButtonElement>('button[role="switch"]')!
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).not.toContain('se enviará al otro servicio')
    expect(host.textContent).toContain('Ninguno elegido')
    act(() => sw.click())
    expect(update).toHaveBeenLastCalledWith({ modelFallback: { models: [], otherProvider: true } })
  })

  it('muestra el aviso de privacidad cuando está encendido', () => {
    mount({ models: ['opencode/big-free'], otherProvider: true })
    expect(host.textContent).toContain('se enviará al otro servicio')
    expect(host.textContent).toContain('Modelo big-free')
  })

  it('quitar un modelo guarda la lista sin él', () => {
    mount({ models: ['opencode/big-free', 'otro/gratis'], otherProvider: false })
    const rm = host.querySelector<HTMLButtonElement>('button[aria-label^="Quitar Modelo big-free"]')!
    act(() => rm.click())
    expect(update).toHaveBeenLastCalledWith({ modelFallback: { models: ['otro/gratis'], otherProvider: false } })
  })

  it('con 3 elegidos ya no se ofrece añadir más', () => {
    mount({ models: ['a/x', 'b/y', 'c/z'], otherProvider: false })
    expect(host.querySelector('[aria-label="Añadir un modelo de respaldo"]')).toBeNull()
  })
})
