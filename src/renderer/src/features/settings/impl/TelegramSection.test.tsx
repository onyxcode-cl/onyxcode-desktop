// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyLangPref } from '../../../lib/i18n'
import { TELEGRAM_DEFAULT_STATE, type TelegramState } from '@shared/telegram'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.hoisted(() => vi.fn())
const listeners = vi.hoisted(() => new Map<string, (s: unknown) => void>())
const openExternal = vi.hoisted(() => vi.fn())
vi.mock('./extras', () => ({
  getExtras: () => ({
    invoke,
    on: (ch: string, fn: (s: unknown) => void) => {
      listeners.set(ch, fn)
      return () => listeners.delete(ch)
    }
  })
}))
vi.mock('../../../lib/open-external', () => ({ openExternalUrl: openExternal }))

import { TelegramSection } from './TelegramSection'

const S = (over: Partial<TelegramState>): TelegramState => ({ ...TELEGRAM_DEFAULT_STATE, ...over })
// Clave de mentira armada en tiempo de ejecución.
const FAKE_KEY = ['123456789', 'q'.repeat(7) + '-' + 'Zk3'.repeat(9)].join(':')

let host: HTMLDivElement
let root: Root
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(TelegramSection))
  })
  await flush()
}
const click = async (el: Element | null): Promise<void> => {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}
const byText = (txt: string): HTMLButtonElement | null =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(txt)) ?? null

beforeEach(() => {
  vi.unstubAllGlobals()
  applyLangPref('es')
  invoke.mockReset()
  openExternal.mockReset()
  listeners.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Ajustes › Telegram', () => {
  it('muestra «cargando» y luego el estado; el aviso de privacidad siempre está', async () => {
    invoke.mockResolvedValue(S({}))
    await mount()
    expect(host.textContent).toContain('Telegram no cifra de extremo a extremo')
    expect(host.textContent).toContain('El computador debe estar encendido con Lazunox abierto')
    expect(host.querySelector('[data-telegram-status="off"]')).not.toBeNull()
    expect(host.querySelector('[aria-live="polite"][role="status"]')?.textContent).toContain('Apagado')
    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('error al leer el estado: mensaje y botón para reintentar', async () => {
    invoke.mockRejectedValueOnce(new Error('x'))
    await mount()
    expect(host.textContent).toContain('No se pudo leer el estado de Telegram')
    invoke.mockResolvedValueOnce(S({}))
    await click(byText('Reintentar'))
    expect(host.querySelector('[data-telegram-status]')).not.toBeNull()
  })

  it('«Abrir @BotFather» abre el enlace oficial por el navegador del sistema', async () => {
    invoke.mockResolvedValue(S({}))
    await mount()
    await click(byText('Abrir @BotFather'))
    expect(openExternal).toHaveBeenCalledWith('https://t.me/BotFather')
  })

  it('guardar la clave: la manda una vez, limpia el campo y nunca la pinta', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'telegram:getState') return S({})
      if (ch === 'telegram:saveToken') return { ok: true, botUsername: 'mi_bot' }
      return S({})
    })
    await mount()
    const input = host.querySelector('input[type="password"]') as HTMLInputElement
    expect(input).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, FAKE_KEY)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(byText('Guardar clave'))
    expect(invoke).toHaveBeenCalledWith('telegram:saveToken', { token: FAKE_KEY })
    expect((host.querySelector('input[type="password"]') as HTMLInputElement | null)?.value ?? '').toBe('')
    expect(host.innerHTML).not.toContain(FAKE_KEY.split(':')[1])
  })

  it('una clave rechazada muestra el motivo en lenguaje llano', async () => {
    invoke.mockImplementation(async (ch: string) => (ch === 'telegram:saveToken' ? { ok: false, error: 'invalid-token' } : S({})))
    await mount()
    const input = host.querySelector('input[type="password"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, FAKE_KEY)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(byText('Guardar clave'))
    expect(host.textContent).toContain('Esa clave no es válida')
    // El campo queda vacío (y la clave fuera del estado del componente): para reintentar se escribe de nuevo.
    expect((host.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('')
    expect(host.innerHTML).not.toContain(FAKE_KEY.split(':')[1])
    // «Guardar clave» queda apagado hasta que haya algo escrito: no se reenvía la clave rechazada.
    const save = byText('Guardar clave') as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('tras un rechazo se puede escribir otra clave y se manda esa, no la anterior', async () => {
    const OTHER = '999999:OtraClaveDePruebaQueNoEsReal'
    let n = 0
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'telegram:saveToken') return ++n === 1 ? { ok: false, error: 'invalid-token' } : { ok: true, botUsername: 'mi_bot' }
      return S({})
    })
    await mount()
    const type = async (v: string): Promise<void> => {
      const input = host.querySelector('input[type="password"]') as HTMLInputElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await type(FAKE_KEY)
    await click(byText('Guardar clave'))
    await type(OTHER)
    await click(byText('Guardar clave'))
    const sent = invoke.mock.calls.filter((c) => c[0] === 'telegram:saveToken').map((c) => (c[1] as { token: string }).token)
    expect(sent).toEqual([FAKE_KEY, OTHER])
  })

  it('esperando el código: lo muestra con su cuenta regresiva', async () => {
    invoke.mockResolvedValue(
      S({
        enabled: true,
        phase: 'linking',
        botConfigured: true,
        tokenTail: 'Zk3Z',
        botUsername: 'mi_bot',
        code: '482915',
        codeExpiresAt: Date.now() + 9 * 60_000,
        attemptsLeft: 3
      })
    )
    await mount()
    expect(host.querySelector('[data-telegram-code]')?.textContent).toContain('482915')
    expect(host.textContent).toContain('Caduca en')
    expect(host.textContent).toContain('Quedan 3 intentos')
    expect(host.textContent).toContain('termina en Zk3Z')
    expect(host.querySelector('[data-telegram-status="linking"]')?.textContent).toContain('Esperando el código')
    await click(byText('Abrir mi bot'))
    expect(openExternal).toHaveBeenCalledWith('https://t.me/mi_bot')
  })

  it('vinculado: muestra a quién, mensaje de prueba, Desvincular y Quitar el bot (con confirmación)', async () => {
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'telegram:sendTest') return { ok: true }
      if (ch === 'telegram:removeBot') return S({})
      return S({ enabled: true, phase: 'linked', botConfigured: true, tokenTail: 'abcd', botUsername: 'mi_bot', ownerLabel: 'Ana' })
    })
    await mount()
    expect(host.querySelector('[data-telegram-status="linked"]')?.textContent).toContain('Vinculado a Ana')
    await click(byText('Enviar mensaje de prueba'))
    expect(host.textContent).toContain('Enviado. Revisa tu Telegram')
    // Quitar el bot pide confirmar y solo entonces llama a main.
    await click(byText('Quitar el bot'))
    expect(invoke).not.toHaveBeenCalledWith('telegram:removeBot')
    expect(host.textContent).toContain('borra la clave del bot')
    await click(byText('Sí, quitar'))
    expect(invoke).toHaveBeenCalledWith('telegram:removeBot')
  })

  it('un cambio de estado que llega de main se refleja sin recargar', async () => {
    invoke.mockResolvedValue(S({}))
    await mount()
    await act(async () => {
      listeners.get('telegram:state-changed')!(S({ enabled: true, phase: 'no-bot' }))
    })
    expect(host.querySelector('[data-telegram-status="no-bot"]')).not.toBeNull()
  })

  it('un error del puente se anuncia en la zona de estado', async () => {
    invoke.mockResolvedValue(S({ enabled: true, phase: 'linked', botConfigured: true, error: 'network', ownerLabel: 'Ana' }))
    await mount()
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('no se pudo hablar con Telegram')
  })

  it('en inglés tiene los mismos textos clave', async () => {
    applyLangPref('en')
    invoke.mockResolvedValue(S({}))
    await mount()
    expect(host.textContent).toContain('does not end-to-end encrypt bot messages')
    expect(byText('Open @BotFather')).not.toBeNull()
    applyLangPref('es')
  })
})
