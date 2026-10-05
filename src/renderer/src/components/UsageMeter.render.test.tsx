/** Medidor de uso: en escritorio no se pinta sin turnos del asistente y muestra el % junto al anillo; el celular no cambia. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '@opencode-ai/sdk/v2/client'
import { UsageMeter } from './UsageMeter'

// El render del servidor de zustand lee el estado inicial: se sustituye el almacén por uno fijo.
vi.mock('../stores/providers', () => ({
  useProviders: (sel: (s: unknown) => unknown) => sel({ providers: [{ id: 'p', models: { m: { limit: { context: 1000 } } } }] })
}))

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
const model = { providerID: 'p', modelID: 'm' }
const assistant = (input: number): { info: Message } =>
  ({
    info: {
      id: 'a1',
      role: 'assistant',
      modelID: 'm',
      providerID: 'p',
      cost: 0,
      tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    }
  }) as unknown as { info: Message }

afterEach(() => surface(null))

describe('UsageMeter', () => {
  it('escritorio sin turnos: no pinta nada', () => {
    surface('darwin')
    expect(renderToStaticMarkup(<UsageMeter messages={[]} model={model} />)).toBe('')
  })
  it('escritorio con turnos: anillo, % visible y etiqueta con el porcentaje', () => {
    surface('darwin')
    const h = renderToStaticMarkup(<UsageMeter messages={[assistant(250)]} model={model} />)
    expect(h).toContain('25\u00a0%')
    expect(h).toContain('aria-label=')
    expect(h).toContain('stroke-linecap="butt"')
  })
  it('escritorio con turnos pero sin tokens ni uso real: no pinta nada', () => {
    surface('darwin')
    expect(renderToStaticMarkup(<UsageMeter messages={[assistant(0)]} model={model} />)).toBe('')
  })
  it('escritorio con uso que redondea a 0 %: no pinta nada', () => {
    surface('darwin')
    expect(renderToStaticMarkup(<UsageMeter messages={[assistant(2)]} model={model} />)).toBe('')
  })
  it('celular sin turnos: no pinta el anillo vacío (como en escritorio)', () => {
    surface('remote')
    expect(renderToStaticMarkup(<UsageMeter messages={[]} model={model} />)).toBe('')
  })
  it('celular con uso: se conserva el anillo con arco mínimo redondo y sin porcentaje a un lado', () => {
    surface('remote')
    const h = renderToStaticMarkup(<UsageMeter messages={[assistant(250)]} model={model} />)
    expect(h).toContain('stroke-linecap="round"')
    expect(h).not.toContain('\u00a0%</span>')
  })
})
