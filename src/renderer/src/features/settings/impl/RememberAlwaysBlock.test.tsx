// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const callMock = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api', () => ({ call: callMock, api: { on: () => () => undefined } }))

import { RememberAlwaysBlock } from './RememberAlwaysBlock'
import { useSettings } from '../../../stores/settings'
import { applyLangPref } from '../../../lib/i18n'

let host: HTMLDivElement
let root: Root
let update: ReturnType<typeof vi.fn>

const sw = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('button[role="switch"]')!
const forgetBtn = (): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((b) => /Olvidar los permisos|Forget saved/.test(b.textContent ?? ''))!

function mount(rememberAlways: boolean | undefined = true): void {
  update = vi.fn(async () => undefined)
  act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, rememberAlways: rememberAlways as boolean }, update }))
  act(() => root.render(createElement(RememberAlwaysBlock)))
}

beforeEach(() => {
  callMock.mockReset()
  applyLangPref('es')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  applyLangPref('es')
})

describe('RememberAlwaysBlock', () => {
  it('por defecto está encendido y tiene nombre accesible', () => {
    expect(DEFAULT_SETTINGS.rememberAlways).toBe(true)
    mount()
    expect(sw().getAttribute('aria-checked')).toBe('true')
    expect(sw().getAttribute('aria-label')).toContain('Recordar mis «siempre» entre sesiones')
  })

  it('al apagarlo envía rememberAlways:false; al encenderlo, true', () => {
    mount(true)
    act(() => sw().click())
    expect(update).toHaveBeenLastCalledWith({ rememberAlways: false })
    mount(false)
    expect(sw().getAttribute('aria-checked')).toBe('false')
    act(() => sw().click())
    expect(update).toHaveBeenLastCalledWith({ rememberAlways: true })
  })

  it('«Olvidar los permisos guardados» llama al canal y dice cuántos borró', async () => {
    callMock.mockResolvedValue({ removed: 3 })
    mount()
    await act(async () => forgetBtn().click())
    expect(callMock).toHaveBeenCalledWith('settings:forgetAlways')
    expect(host.textContent).toContain('se borraron 3 elementos guardados')
  })

  it('sin nada guardado lo dice; si falla, muestra el error', async () => {
    callMock.mockResolvedValueOnce({ removed: 0 })
    mount()
    await act(async () => forgetBtn().click())
    expect(host.textContent).toContain('No había permisos guardados')
    callMock.mockRejectedValueOnce(new Error('no se pudo'))
    await act(async () => forgetBtn().click())
    expect(host.textContent).toContain('no se pudo')
  })

  it('en inglés usa los textos en inglés', () => {
    applyLangPref('en')
    mount()
    expect(host.textContent).toContain('Remember my “always” answers between sessions')
    expect(host.textContent).toContain('Forget saved permissions')
  })
})
