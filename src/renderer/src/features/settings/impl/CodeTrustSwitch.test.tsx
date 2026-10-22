// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { CodeTrustSwitch } from './CodeTrustSwitch'
import { useSettings } from '../../../stores/settings'

let host: HTMLDivElement
let root: Root
let update: ReturnType<typeof vi.fn>

const sw = (): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>('button[role="switch"]')

function mount(name: string, codeTrustedMcp: unknown = []): void {
  update = vi.fn(async () => undefined)
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, codeTrustedMcp: codeTrustedMcp as string[] }, update })
  act(() => root.render(createElement(CodeTrustSwitch, { name })))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('CodeTrustSwitch', () => {
  it('apagado por defecto, con nombre accesible y texto en llano', () => {
    mount('gmail')
    expect(sw()?.getAttribute('aria-checked')).toBe('false')
    expect(sw()?.getAttribute('aria-label')).toBe('Sin preguntar en Code')
    expect(host.textContent).toContain('sin pedirte permiso en cada uso')
    expect(host.querySelector('[role="group"][aria-describedby]')).not.toBeNull()
  })
  it('al encenderlo guarda el nombre en codeTrustedMcp', () => {
    mount('gmail', ['crm'])
    act(() => sw()!.click())
    expect(update).toHaveBeenCalledWith({ codeTrustedMcp: ['crm', 'gmail'] })
  })
  it('encendido: refleja el estado y al apagarlo lo quita', () => {
    mount('crm', ['crm', 'otro'])
    expect(sw()?.getAttribute('aria-checked')).toBe('true')
    act(() => sw()!.click())
    expect(update).toHaveBeenCalledWith({ codeTrustedMcp: ['otro'] })
  })
  it('un valor corrupto en ajustes no rompe: apagado', () => {
    mount('gmail', 'todos')
    expect(sw()?.getAttribute('aria-checked')).toBe('false')
  })
  it('un conector interno no es configurable: no se dibuja', () => {
    mount('browser')
    expect(sw()).toBeNull()
  })
})
