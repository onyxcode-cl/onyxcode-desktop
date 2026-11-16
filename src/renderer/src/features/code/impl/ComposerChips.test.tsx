// @vitest-environment jsdom
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useLang } from '../../../lib/i18n'
import { useProviders } from '../../../stores/providers'
import { useSettings } from '../../../stores/settings'
import { useExtrasPrefs } from '../../settings/impl/extras'
import { AgentChip, ModelControls, PermissionChip } from './ComposerControls'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const setPermissionMode = vi.fn(() => Promise.resolve())
const onAgent = vi.fn()

beforeEach(() => {
  useLang.setState({ lang: 'es' })
  setPermissionMode.mockClear()
  onAgent.mockClear()
  useCode.setState({ permissionMode: 'manual', setPermissionMode } as never)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (el: React.ReactElement): void => act(() => root.render(el))
const trigger = (): HTMLButtonElement => host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
const items = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))

describe('PermissionChip (Code)', () => {
  it('muestra el modo de permisos con texto y su nombre accesible; solo se oculta por clase de contenedor', () => {
    render(createElement(PermissionChip))
    expect(trigger().textContent).toContain('Preguntar siempre')
    expect(trigger().getAttribute('aria-label')).toBe('Modo de permisos: Preguntar siempre')
    const label = Array.from(trigger().querySelectorAll('span')).find((s) => s.textContent === 'Preguntar siempre')!
    expect(label.className).toContain('desk:@max-[56rem]:sr-only')
    expect(trigger().title).toBe('Modo de permisos: Preguntar siempre')
  })

  it('al no caber la etiqueta completa queda una etiqueta corta («Preguntar») en el mismo punto de corte, sin cambiar el nombre accesible', () => {
    render(createElement(PermissionChip))
    const short = Array.from(trigger().querySelectorAll('span')).find((x) => x.textContent === 'Preguntar')!
    expect(short.className).toContain('desk:@max-[56rem]:inline')
    expect(short.className).toContain('desk:@max-[48rem]:sr-only')
    expect(trigger().querySelector('svg:last-child')?.classList.contains('desk:@max-[48rem]:hidden')).toBe(true)
    expect(short.className).toContain('hidden')
    expect(short.getAttribute('aria-hidden')).toBe('true')
    expect(trigger().getAttribute('aria-label')).toBe('Modo de permisos: Preguntar siempre')
  })

  it('el menú explica cada modo con una frase, marca el actual y mantiene el orden y los valores', () => {
    render(createElement(PermissionChip))
    act(() => trigger().click())
    expect(items().map((i) => i.dataset.option)).toEqual(['manual', 'acceptEdits', 'plan', 'auto', 'bypass'])
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    expect(items()[0]!.textContent).toContain('Te pregunta antes de editar archivos, ejecutar comandos')
    expect(items()[2]!.textContent).toContain('Solo lee y propone un plan')
    expect(items()[4]!.className).toContain('text-danger')
  })

  it('elegir «Automático» cambia el permiso (store) y el número 2 es atajo de «Editar sin preguntar»', () => {
    render(createElement(PermissionChip))
    act(() => trigger().click())
    act(() => items()[3]!.click())
    expect(setPermissionMode).toHaveBeenCalledWith('auto')
    act(() => trigger().click())
    act(() => {
      items()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }))
    })
    expect(setPermissionMode).toHaveBeenLastCalledWith('acceptEdits')
  })

  it('«Todo sin preguntar» se pinta de peligro en el chip', () => {
    useCode.setState({ permissionMode: 'bypass' } as never)
    render(createElement(PermissionChip))
    expect(trigger().className).toContain('text-danger')
  })
})

describe('AgentChip (Build / Plan)', () => {
  it('Build y Plan con su frase; el atajo ⇧Tab está en el title', () => {
    render(createElement(AgentChip, { agent: 'build', onChange: onAgent }))
    expect(trigger().title).toBe('Modo de trabajo: Hacer (⇧Tab)')
    act(() => trigger().click())
    expect(items().map((i) => i.dataset.option)).toEqual(['build', 'plan'])
    expect(items()[1]!.textContent).toContain('no edita archivos mientras planifica')
    act(() => items()[1]!.click())
    expect(onAgent).toHaveBeenCalledWith('plan')
  })

  it('en Plan el chip se destaca con el acento', () => {
    render(createElement(AgentChip, { agent: 'plan', onChange: onAgent }))
    expect(trigger().className).toContain('text-accent')
    expect(trigger().textContent).toContain('Planear')
  })

  it.each(['build', 'plan'] as const)('%s cede texto y flecha después de permisos, conservando nombre y tooltip', (agent) => {
    render(createElement(AgentChip, { agent, onChange: onAgent }))
    expect(trigger().querySelector('span')?.classList.contains('desk:@max-[36rem]:sr-only')).toBe(true)
    expect(trigger().querySelector('svg:last-child')?.classList.contains('desk:@max-[36rem]:hidden')).toBe(true)
    const name = `Modo de trabajo: ${agent === 'build' ? 'Hacer' : 'Planear'}`
    expect(trigger().getAttribute('aria-label')).toBe(name)
    expect(trigger().title).toBe(`${name} (⇧Tab)`)
  })
})

describe('ModelControls (Code)', () => {
  it.each(['Claude Haiku 5.5', 'DeepSeek V4.1 Flash 1017'])(
    'reserva espacio para %s y conserva Estándar hasta después de Hacer/Planear',
    (name) => {
      const model = { providerID: 'p', modelID: 'm' }
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS, defaultModel: model } })
      useProviders.setState({
        providers: [
          { id: 'p', name: 'Proveedor', models: { m: { id: 'm', name, status: 'active', variants: { medium: {} } } } }
        ] as unknown as Provider[],
        loaded: true,
        loading: false,
        client: null
      })
      useExtrasPrefs.setState((s) => ({ prefs: { ...s.prefs, modelsByMode: {}, planExecModels: {} } }))
      useCode.setState({ model, variant: null, activeSessionID: null, roleModels: {}, directory: null })
      render(createElement(ModelControls))
      const picker = host.querySelector<HTMLButtonElement>('[data-model-picker]')!
      expect(picker.textContent).toBe(name)
      const modelBox = picker.parentElement!.parentElement!
      expect(modelBox.classList.contains('desk:shrink')).toBe(true)
      expect(modelBox.classList.contains('desk:min-w-[4.5rem]')).toBe(true)
      expect(modelBox.classList.contains('desk:flex-1')).toBe(false)
      const effort = host.querySelector<HTMLButtonElement>('[data-testid="effort-picker"]')!
      expect(effort.textContent).toBe('Estándar')
      expect(effort.querySelector('span')?.classList.contains('desk:@max-[24rem]:sr-only')).toBe(true)
      expect(effort.querySelector('svg:last-child')?.classList.contains('desk:@max-[24rem]:hidden')).toBe(true)
      expect(effort.getAttribute('aria-label')).toBe('Esfuerzo del modelo: Estándar')
      expect(effort.title).toBe('Esfuerzo del modelo: Estándar (⌘E)')
    }
  )
})
