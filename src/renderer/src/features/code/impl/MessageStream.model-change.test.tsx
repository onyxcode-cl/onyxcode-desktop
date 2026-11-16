// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'
import { makeSession, nextEventId, textPart, userMessage } from '../../../../../test/fixtures/events'
import type { OcEvent } from '../../../lib/opencode'
import { useProviders } from '../../../stores/providers'
import { useExtrasPrefs } from '../../settings/impl/extras'
import { useLang } from '../../../lib/i18n'
import { MessageStream } from './MessageStream'
import { ModelControls } from './ComposerControls'
import { useCode } from './store'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
const old = { providerID: 'p', modelID: 'old' }
const next = { providerID: 'p', modelID: 'new' }
const D = '/work/code'
const base = { busy: true, error: null, root: D, permissions: [], questions: [], onUnrevert: () => undefined, loading: false }
const entries = (id: string) => [{ info: userMessage('m1', id, { model: old }), parts: [textPart('p1', 'm1', id, 'hola')] }]
;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
let mounted: Mounted | undefined
const change = (sessionID = 's1') =>
  act(() =>
    useCode.getState().applyEvent(
      {
        id: nextEventId(),
        type: 'session.modelo.cambiado',
        properties: { sessionID, anterior: old, nuevo: next, motivo: '<script>no se interpreta</script>' }
      } as unknown as OcEvent,
      D
    )
  )
beforeEach(() => {
  useLang.setState({ lang: 'es' })
  useCode.setState({
    directory: D,
    activeSessionID: 's1',
    model: old,
    variant: null,
    sessionProject: { s1: D, s2: D },
    sessions: { s1: makeSession('s1', D), s2: makeSession('s2', D) },
    sessionModels: {},
    modelChanges: {},
    messages: {},
    roleModels: {},
    runState: {}
  })
  useProviders.setState({
    loaded: true,
    providers: [
      {
        id: 'p',
        name: 'Proveedor',
        models: {
          old: { id: 'old', name: 'Modelo anterior' },
          new: { id: 'new', name: 'Modelo visible' }
        }
      }
    ] as never
  })
  useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { exec: old } } })
})
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})

describe('selector y línea del cambio de modelo', () => {
  it('actualiza el selector real y muestra la línea con el nombre visible, sin tarjeta', () => {
    mounted = mount(
      <>
        <ModelControls />
        <MessageStream {...base} entries={entries('s1')} />
      </>
    )
    expect(mounted.host.textContent).toContain('Modelo anterior')
    change()
    const note = mounted.host.querySelector('[data-testid="model-change-note"]')!
    expect(note.textContent).toBe('Cambié a Modelo visible porque lo pediste.')
    expect(note.className).toContain('text-xs text-muted')
    expect(note.children).toHaveLength(0)
    expect(mounted.host.querySelector('script')).toBeNull()
    expect(mounted.host.querySelector('button[title="p/new"]')?.textContent).toContain('Modelo visible')
    expect(mounted.host.querySelector('button[title="p/old"]')).toBeNull()
    expect(mounted.host.textContent).toContain('Modelo visible')
  })
  it('la línea de otra conversación no aparece aquí ni cambia el selector', () => {
    mounted = mount(
      <>
        <ModelControls />
        <MessageStream {...base} entries={entries('s1')} />
      </>
    )
    change('s2')
    expect(mounted.host.querySelector('[data-testid="model-change-note"]')).toBeNull()
    expect(mounted.host.textContent).toContain('Modelo anterior')
    mounted.rerender(<MessageStream {...base} entries={entries('s2')} />)
    expect(mounted.host.querySelector('[data-testid="model-change-note"]')?.textContent).toBe('Cambié a Modelo visible porque lo pediste.')
  })
  it('trata nombres como texto plano y cambia el idioma sin guardar una traducción en el store', () => {
    useProviders.setState({ providers: [{ id: 'p', name: 'Proveedor', models: { new: { id: 'new', name: '<b>Modelo</b>' } } }] as never })
    mounted = mount(<MessageStream {...base} entries={entries('s1')} />)
    change()
    const note = mounted.host.querySelector('[data-testid="model-change-note"]')!
    expect(note.textContent).toBe('Cambié a <b>Modelo</b> porque lo pediste.')
    expect(note.children).toHaveLength(0)
    act(() => useLang.setState({ lang: 'en' }))
    expect(note.textContent).toBe('I switched to <b>Modelo</b> because you asked.')
  })
})
