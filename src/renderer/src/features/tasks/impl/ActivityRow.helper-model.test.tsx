// @vitest-environment jsdom
import { act } from 'react'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'
import { toolPart, assistantMessage } from '../../../../../test/fixtures/events'
import { useSessions } from '../../../stores/sessions'
import { useProviders } from '../../../stores/providers'
import { useLang } from '../../../lib/i18n'
import { ActivityRow } from './ProgressPanel'
let mounted: Mounted | undefined
beforeEach(() => {
  useLang.setState({ lang: 'es' })
  useSessions.setState({ messages: {} })
  useProviders.setState({ providers: [{ id: 'p', models: { kimi: { id: 'kimi', name: 'Kimi visible' } } }] as never })
})
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})
describe('modelo de las subtareas de Overdrive', () => {
  it('muestra modelName en la subtarea como texto, y traduce la etiqueta', () => {
    const part = toolPart('task', 'm1', 'root', 'task', {
      status: 'completed',
      input: { description: 'Construir' },
      metadata: { sessionId: 'kid', modelName: '<b>Kimi</b>' }
    }) as ToolPart
    mounted = mount(
      <ul>
        <ActivityRow part={part} />
      </ul>
    )
    const note = mounted.host.querySelector('[data-testid="helper-model"]')!
    expect(note.textContent).toBe('Modelo: <b>Kimi</b>')
    expect(note.querySelector('b')).toBeNull()
    act(() => useLang.setState({ lang: 'en' }))
    expect(note.textContent).toBe('Model: <b>Kimi</b>')
  })
  it('sin metadata de modelo usa el nombre del catálogo para la sesión hija, también mientras trabaja', () => {
    const part = toolPart('task', 'm1', 'root', 'task', { status: 'running', input: {}, metadata: { sessionId: 'kid' } }) as ToolPart
    mounted = mount(
      <ul>
        <ActivityRow part={part} />
      </ul>
    )
    expect(mounted.host.querySelector('[data-testid="helper-model"]')).toBeNull()
    act(() =>
      useSessions.setState({
        messages: { kid: [{ info: assistantMessage('a1', 'kid', { providerID: 'p', modelID: 'kimi' }), parts: [] }] }
      })
    )
    expect(mounted.host.textContent).toContain('Modelo: Kimi visible')
  })
})
