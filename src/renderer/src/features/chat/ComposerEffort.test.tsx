// @vitest-environment jsdom
import { vi } from 'vitest'
vi.hoisted(() => vi.unstubAllGlobals())
vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useLang } from '../../lib/i18n'
import { useProviders } from '../../stores/providers'
import { useSettings } from '../../stores/settings'
import { useExtrasPrefs } from '../settings/impl/extras'
import { ModelControls } from '../code/impl/ComposerControls'
import { useCode } from '../code/impl/store'
import { TasksComposer } from '../tasks/impl/TasksComposer'
import { useTasks } from '../tasks/impl/store'
import { ChatView } from './ChatView'
import { useChat } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = () => undefined
const MODEL = { providerID: 'p', modelID: 'm' }
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  useLang.setState({ lang: 'es' })
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, defaultModel: MODEL } })
  useProviders.setState({
    providers: [
      {
        id: 'p',
        name: 'Proveedor',
        models: { m: { id: 'm', name: 'Modelo', status: 'active', variants: { medium: {} }, capabilities: { reasoning: true } } }
      }
    ] as unknown as Provider[],
    loaded: true,
    loading: false,
    client: null
  })
  useExtrasPrefs.setState((s) => ({ prefs: { ...s.prefs, modelsByMode: {}, planExecModels: {} } }))
  useCode.setState({ model: MODEL, variant: 'medium', activeSessionID: null, roleModels: {}, directory: null })
  useTasks.setState({ taskModel: MODEL, taskVariant: 'medium', activeTaskId: null })
  useChat.setState({ activeSessionId: null, variants: {}, lastVariant: 'medium' })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('esfuerzo junto al modelo en los tres modos', () => {
  it.each(['Code', 'Overdrive', 'Chat'])('%s muestra ambos controles contiguos con el nivel actual', (mode) => {
    act(() =>
      root.render(
        mode === 'Code'
          ? createElement(ModelControls)
          : mode === 'Overdrive'
            ? createElement(TasksComposer, { onSend: vi.fn(), busy: false })
            : createElement(ChatView)
      )
    )
    const effort = host.querySelector<HTMLButtonElement>('[data-testid="effort-picker"]')!
    const model = host.querySelector('[data-model-picker]')!
    expect(effort?.textContent).toBe('Medio')
    const modelContainer = mode === 'Code' ? model.parentElement!.parentElement! : model.parentElement!
    expect(modelContainer.nextElementSibling).toBe(effort.parentElement)
  })

  it('Code con modelo propio de rol conserva el selector sin esfuerzo', () => {
    useCode.setState({ agent: 'plan', roleModels: { '': { plan: MODEL } } })
    act(() => root.render(createElement(ModelControls)))
    expect(host.querySelector('[data-model-picker]')).not.toBeNull()
    expect(host.querySelector('[data-testid="effort-picker"]')).toBeNull()
  })
})
