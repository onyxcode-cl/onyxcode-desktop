// @vitest-environment jsdom
// Último paso del asistente («Todo listo»): ya no instala nada ni repite la lista de piezas (eso vive solo en «Preparando»); ofrece el ejemplo.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bridge = vi.fn()
vi.mock('../tasks/impl/bridge', () => ({
  hasTasksBridge: () => true,
  cw: (...a: unknown[]) => bridge(...a)
}))

import { StepSetup } from './Wizard'

let host: HTMLDivElement
let root: Root
const mount = async (platform: string, onTryExample = vi.fn()): Promise<typeof onTryExample> => {
  ;(window as unknown as { api: unknown }).api = { platform, capsFlags: { tasksWin: true } }
  await act(async () => {
    root.render(createElement(StepSetup, { onTryExample }))
  })
  return onTryExample
}

beforeEach(() => {
  vi.unstubAllGlobals()
  bridge.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('«Todo listo»: cierre del asistente', () => {
  it('no instala ni revisa nada, y no repite casillas ni «Preparar todo»', async () => {
    await mount('darwin')
    expect(bridge).not.toHaveBeenCalled()
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    expect(host.textContent).not.toContain('Preparar todo')
  })
  it('dice dónde instalar después lo que se dejó para más tarde (Ajustes › Diagnóstico)', async () => {
    await mount('win32')
    expect(host.textContent).toContain('Ajustes › Diagnóstico')
  })
  it('«Probar con un ejemplo» sigue a la vista', async () => {
    const onTry = await mount('win32')
    await act(async () =>
      ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Probar con un ejemplo') as HTMLButtonElement).click()
    )
    expect(onTry).toHaveBeenCalledTimes(1)
  })
  it('en macOS recuerda que los permisos se piden al usar «Control total»; en Windows no menciona permisos de macOS', async () => {
    await mount('darwin')
    expect(host.querySelector('[role="note"]')?.textContent).toContain('Permisos de macOS')
    await act(async () => root.render(createElement('div')))
    await mount('win32')
    expect(host.querySelector('[role="note"]')).toBeNull()
  })
})
