import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AssistantMessage, Part } from '@opencode-ai/sdk/v2/client'
import { buildWatchdogMark, readWatchdogMark } from '@shared/watchdog-mark'
import { AssistantError } from './AssistantError'

const aborted = { error: { name: 'MessageAbortedError', data: { message: 'x' } } } as unknown as AssistantMessage
const markPart = (limit: 'time' | 'calls' | 'output', value: number): Part =>
  ({ id: 'p', type: 'text', text: 't', synthetic: true, metadata: buildWatchdogMark({ limit, value }) }) as unknown as Part
const render = (parts?: Part[]): string =>
  renderToStaticMarkup(createElement(AssistantError, { info: aborted, abortedLabel: 'Detenido por el usuario.', parts }))

describe('AssistantError: aborto', () => {
  it('aborto de la persona: texto genérico de siempre', () => {
    expect(render()).toContain('Detenido por el usuario.')
    expect(render([{ id: 'q', type: 'text', text: 'hola' } as unknown as Part])).toContain('Detenido por el usuario.')
  })

  it('aborto del vigilante: dice la causa real, no «Detenido por el usuario»', () => {
    const time = render([markPart('time', 60)])
    expect(time).toContain('límite de tiempo (60 s)')
    expect(time).not.toContain('Detenido por el usuario')
    expect(render([markPart('calls', 200)])).toContain('más de 200')
    expect(render([markPart('output', 256)])).toContain('más de 256 KB')
  })
})

describe('readWatchdogMark', () => {
  it('ignora marcas mal formadas', () => {
    expect(readWatchdogMark(undefined)).toBeNull()
    expect(readWatchdogMark([{ metadata: { lazunoxWatchdog: { limit: 'otro', value: 1 } } }])).toBeNull()
    expect(readWatchdogMark([{ metadata: { lazunoxWatchdog: { limit: 'time', value: '60' } } }])).toBeNull()
  })
})
