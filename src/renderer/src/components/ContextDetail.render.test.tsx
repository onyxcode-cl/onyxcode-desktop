import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '@opencode-ai/sdk/v2/client'
import { contextTone, contextUsage } from '../lib/context-usage'

const providers = vi.hoisted(() => ({
  list: [{ id: 'p', models: { m: { name: 'Haiku 5.5', limit: { context: 200_000 } }, sinVentana: { name: 'X', limit: { context: 0 } } } }]
}))
vi.mock('../stores/providers', () => ({ useProviders: (sel: (s: unknown) => unknown) => sel({ providers: providers.list }) }))
vi.mock('../stores/server', () => ({ useServer: (sel: (s: unknown) => unknown) => sel({ client: null }) }))

import { ContextDetail } from './ContextDetail'

const model = { providerID: 'p', modelID: 'm' }
const asst = (input: number, modelID = 'm', cache = 0): { info: Message } =>
  ({
    info: {
      id: `a${input}${modelID}`,
      sessionID: 's',
      role: 'assistant',
      providerID: 'p',
      modelID,
      cost: 0,
      tokens: { input, output: 5, reasoning: 0, cache: { read: cache, write: 0 } }
    }
  }) as unknown as { info: Message }
const render = (messages: { info: Message }[]): string => renderToStaticMarkup(<ContextDetail messages={messages} model={model} />)

describe('medidor de Contexto', () => {
  it('con datos: barra, «X de Y tokens», porcentaje y nombre del modelo', () => {
    const h = render([asst(40_000, 'm', 20_000)])
    expect(h).toContain('data-testid="context-meter"')
    expect(h).toContain('data-tone="ok"')
    expect(h).toContain('>30 %<')
    expect(h).toContain('60 k de 200 k tokens')
    expect(h).toContain('Haiku 5.5')
    expect(h).toContain('role="progressbar"')
  })
  it('mientras el modelo trabaja (último mensaje aún sin tokens) usa el último con datos', () => {
    const h = render([asst(100_000), asst(0)])
    expect(h).toContain('data-testid="context-meter"')
    expect(h).toContain('>50 %<')
  })
  it('al 95 %: rojo', () => {
    const h = render([asst(190_000)])
    expect(h).toContain('data-tone="danger"')
    expect(h).toContain('bg-danger')
    expect(h).toContain('>95 %<')
  })
  it('72 %: ámbar', () => {
    expect(render([asst(144_000)])).toContain('data-tone="warn"')
  })
  it('modelo sin ventana declarada: «No disponible para este modelo»', () => {
    expect(render([asst(1000, 'sinVentana')])).toContain('No disponible para este modelo')
    expect(render([asst(1000, 'noExiste')])).toContain('No disponible para este modelo')
  })
  it('sin respuestas todavía: lo dice, no queda vacío', () => {
    expect(render([])).toContain('data-testid="context-empty"')
    expect(render([asst(0)])).toContain('Todavía sin datos')
  })
  it('umbrales de color', () => {
    expect([70, 71, 90, 91].map(contextTone)).toEqual(['ok', 'warn', 'warn', 'danger'])
    expect(contextUsage([], model, []).kind).toBe('waiting')
  })
})
