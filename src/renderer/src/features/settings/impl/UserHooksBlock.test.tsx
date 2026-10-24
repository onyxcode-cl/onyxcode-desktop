// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { HOOKS_EXAMPLE } from '@shared/user-hooks'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const callMock = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/api', () => ({ call: callMock, api: { on: () => () => undefined } }))

import { UserHooksBlock } from './UserHooksBlock'
import { useSettings } from '../../../stores/settings'
import { applyLangPref } from '../../../lib/i18n'

let host: HTMLDivElement
let root: Root
let update: ReturnType<typeof vi.fn>

const sw = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('button[role="switch"]')!
const area = (): HTMLTextAreaElement => host.querySelector('textarea')!
const btn = (re: RegExp): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!

/** Escribe en un textarea controlado por React. */
function type(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function mount(userHooksEnabled: boolean | undefined = false, stored = { text: '', exists: false }): Promise<void> {
  callMock.mockImplementation(async (channel: string) => (channel === 'settings:hooksRead' ? stored : { ok: true }))
  update = vi.fn(async () => undefined)
  act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, userHooksEnabled: userHooksEnabled as boolean }, update }))
  await act(async () => root.render(createElement(UserHooksBlock)))
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

describe('UserHooksBlock', () => {
  it('por defecto está APAGADO, con nombre accesible y la advertencia siempre visible', async () => {
    expect(DEFAULT_SETTINGS.userHooksEnabled).toBe(false)
    await mount()
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(sw().getAttribute('aria-label')).toBe('Activar ganchos')
    expect(host.querySelector('[role="note"]')?.textContent).toBe(
      'Los ganchos ejecutan comandos con tus permisos. Solo pon aquí lo que tú entiendas.'
    )
  })

  it('el interruptor envía userHooksEnabled true / false', async () => {
    await mount(false)
    act(() => sw().click())
    expect(update).toHaveBeenLastCalledWith({ userHooksEnabled: true })
    await mount(true)
    expect(sw().getAttribute('aria-checked')).toBe('true')
    act(() => sw().click())
    expect(update).toHaveBeenLastCalledWith({ userHooksEnabled: false })
  })

  it('carga el archivo guardado en el editor', async () => {
    await mount(true, { text: '{"hooks":{}}\n', exists: true })
    expect(callMock).toHaveBeenCalledWith('settings:hooksRead')
    expect(area().value).toBe('{"hooks":{}}\n')
  })

  it('muestra el ejemplo como ayuda y «Usar el ejemplo» lo pasa al editor sin guardarlo', async () => {
    await mount()
    expect(host.textContent).toContain('rm -rf')
    act(() => btn(/Usar el ejemplo/).click())
    expect(area().value).toBe(HOOKS_EXAMPLE)
    expect(callMock).not.toHaveBeenCalledWith('settings:hooksWrite', expect.anything())
  })

  it('un JSON inválido muestra el error en español y NO llama a main', async () => {
    await mount()
    type(area(), '{ roto')
    await act(async () => btn(/^Guardar$/).click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('El texto no es un JSON válido.')
    expect(callMock).not.toHaveBeenCalledWith('settings:hooksWrite', expect.anything())
  })

  it('las cotas se explican con evento y número de gancho, sin repetir el comando', async () => {
    await mount()
    type(
      area(),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { command: 'echo secreto-xyz', timeout: 99 },
            { command: 'ok', matcher: '(' }
          ]
        }
      })
    )
    await act(async () => btn(/^Guardar$/).click())
    const txt = host.querySelector('[role="alert"]')!.textContent!
    expect(txt).toContain('PreToolUse, gancho 1: «timeout» debe ser un número entero de 1 a 60.')
    expect(txt).toContain('PreToolUse, gancho 2: «matcher» no es una expresión regular válida.')
    expect(txt).not.toContain('secreto-xyz')
    expect(callMock).not.toHaveBeenCalledWith('settings:hooksWrite', expect.anything())
  })

  it('un contenido válido se guarda por settings:hooksWrite y lo confirma', async () => {
    await mount()
    const text = JSON.stringify({ hooks: { Stop: [{ command: 'echo fin' }] } })
    type(area(), text)
    await act(async () => btn(/^Guardar$/).click())
    expect(callMock).toHaveBeenCalledWith('settings:hooksWrite', { text })
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Guardado. Ganchos configurados: 1')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('si main rechaza (o falla el disco) lo dice', async () => {
    await mount()
    type(area(), '{"hooks":{}}')
    callMock.mockImplementation(async (c: string) =>
      c === 'settings:hooksWrite' ? { ok: false, issues: [{ code: 'writeFailed' }] } : { text: '', exists: false }
    )
    await act(async () => btn(/^Guardar$/).click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No se pudo escribir el archivo en este equipo.')
    callMock.mockImplementation(async () => {
      throw new Error('canal caído')
    })
    await act(async () => btn(/^Guardar$/).click())
    expect(host.textContent).toContain('canal caído')
  })

  it('si no se puede leer el archivo lo avisa', async () => {
    callMock.mockRejectedValue(new Error('x'))
    update = vi.fn()
    act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, update }))
    await act(async () => root.render(createElement(UserHooksBlock)))
    expect(host.textContent).toContain('No se pudo leer el archivo de ganchos.')
  })

  it('en inglés usa los textos en inglés', async () => {
    applyLangPref('en')
    await mount()
    expect(host.textContent).toContain('Hooks run commands with your permissions. Only put here what you understand.')
    expect(sw().getAttribute('aria-label')).toBe('Turn on hooks')
    type(area(), '{')
    await act(async () => btn(/^Save$/).click())
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('The text is not valid JSON.')
  })
})
