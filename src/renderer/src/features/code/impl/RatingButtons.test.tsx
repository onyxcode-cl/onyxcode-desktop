// @vitest-environment jsdom
// Botones de valoración de una respuesta: estado inicial, marcado, comentario, cambio y quitar.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'

const calls: Array<[string, unknown]> = []
let stored: Array<{ messageId: string; value: string; comment?: string }> = []
vi.mock('../../../lib/api', () => ({
  call: vi.fn(async (channel: string, req: unknown) => {
    calls.push([channel, req])
    if (channel === 'rating:list') return stored
    return { saved: true }
  })
}))

import { RatingButtons, ratingContextOf, resetRatingCache, type RatingContext } from './RatingButtons'
import type { CodeMessage } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ctx: RatingContext = { sessionId: 'ses_1', messageId: 'msg_1', model: 'm', service: 's', mode: 'build' }
let host: HTMLDivElement
let root: Root

const mount = async (): Promise<void> => act(async () => root.render(createElement(RatingButtons, { context: ctx })))
const btn = (v: 'good' | 'bad'): HTMLButtonElement => host.querySelector(`[data-testid="rate-${v}"]`)!
const click = async (el: Element): Promise<void> => act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const sets = (): Array<Record<string, unknown>> => calls.filter(([c]) => c === 'rating:set').map(([, r]) => r as Record<string, unknown>)

beforeEach(() => {
  useLang.setState({ lang: 'es' })
  calls.length = 0
  stored = []
  resetRatingCache()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('RatingButtons', () => {
  it('estado inicial: dos botones con etiqueta, sin marcar y sin campo de comentario', async () => {
    await mount()
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Valorar esta respuesta')
    expect(btn('good').getAttribute('aria-label')).toBe('Buena respuesta')
    expect(btn('bad').getAttribute('aria-label')).toBe('Mala respuesta')
    expect(btn('good').getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('input')).toBeNull()
  })
  it('muestra la valoración ya guardada', async () => {
    stored = [{ messageId: 'msg_1', value: 'good' }]
    await mount()
    expect(btn('good').getAttribute('aria-pressed')).toBe('true')
  })
  it('marcar «buena» guarda; volver a pulsar la quita', async () => {
    await mount()
    await click(btn('good'))
    expect(btn('good').getAttribute('aria-pressed')).toBe('true')
    expect(sets()[0]).toMatchObject({ value: 'good', messageId: 'msg_1' })
    await click(btn('good'))
    expect(btn('good').getAttribute('aria-pressed')).toBe('false')
    expect(sets()[1]).toMatchObject({ value: null })
  })
  it('«mala» pide un comentario opcional de una línea y lo guarda; cambiar a «buena» cierra el campo', async () => {
    await mount()
    await click(btn('bad'))
    const input = host.querySelector('input')!
    expect(input.getAttribute('aria-label')).toBe('¿Qué salió mal? (opcional)')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'no compila')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => void host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(sets().at(-1)).toMatchObject({ value: 'bad', comment: 'no compila' })
    await click(btn('good'))
    expect(btn('good').getAttribute('aria-pressed')).toBe('true')
    expect(btn('bad').getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('input')).toBeNull()
  })
})

describe('ratingContextOf', () => {
  const asst = (id: string, created: number, completed: number | undefined, input: number): CodeMessage =>
    ({
      info: {
        id,
        sessionID: 'ses_1',
        role: 'assistant',
        time: { created, completed },
        modelID: 'mod',
        providerID: 'prov',
        mode: 'build',
        agent: 'build',
        tokens: { input, output: 2, reasoning: 0, cache: { read: 1, write: 0 } }
      },
      parts: []
    }) as unknown as CodeMessage
  it('suma tokens, mide la duración del turno y usa la última respuesta', () => {
    const c = ratingContextOf([asst('a', 1000, 2000, 10), asst('b', 2000, 5000, 20)])!
    expect(c).toMatchObject({ messageId: 'b', model: 'mod', service: 'prov', mode: 'build', durationMs: 4000 })
    expect(c.tokens).toEqual({ input: 30, output: 4, reasoning: 0, cacheRead: 2, cacheWrite: 0 })
  })
  it('sin respuestas del asistente no hay contexto', () => {
    expect(ratingContextOf([])).toBeNull()
  })
})
