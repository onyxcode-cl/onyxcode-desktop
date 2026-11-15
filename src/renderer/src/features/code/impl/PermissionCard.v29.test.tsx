// @vitest-environment jsdom
/**
 * V29: la tarjeta de Código en todos los modos: el comando completo y las carpetas de fuera una sola vez; «Permitir»,
 * «Permitir y no volver a preguntar en este proyecto» (con las reglas de `subcommands`, oculto si no hay ninguna) y «No»
 * con el campo opcional «¿Qué hacer distinto?», que viaja como `message`.
 */
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingPermission } from './types'
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const command = 'cat /tmp/registro.log && npm test && rm -rf dist'
const request = (metadata: Record<string, unknown> = {}): PendingPermission => ({
  id: 'per_v29',
  sessionID: 'ses_1',
  permission: 'bash',
  patterns: [command],
  metadata: {
    command,
    shell: 'zsh',
    externalDirectories: ['/tmp'],
    subcommands: [
      { command: 'cat /tmp/registro.log', rule: 'cat *' },
      { command: 'npm test', rule: 'npm test *' },
      { command: 'rm -rf dist', rule: null }
    ],
    ...metadata
  },
  always: ['cat *'],
  api: 'v1'
})

let host: HTMLDivElement
let root: Root
let createRoot: (typeof import('react-dom/client'))['createRoot']
let PermissionCardDesk: (typeof import('./PermissionCardDesk'))['PermissionCardDesk']
let useCode: (typeof import('./store'))['useCode']
const reply = vi.fn(() => Promise.resolve())
beforeAll(async () => {
  // El arranque de pruebas deja un `document` de mentira: react-dom se carga después, ya con el de jsdom.
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'language', { value: 'es', configurable: true })
  Object.defineProperty(window.navigator, 'languages', { value: ['es'], configurable: true })
  vi.resetModules()
  ;({ createRoot } = await import('react-dom/client'))
  ;({ PermissionCardDesk } = await import('./PermissionCardDesk'))
  ;({ useCode } = await import('./store'))
  ;(await import('@shared/i18n')).setLang('es')
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  reply.mockClear()
  useCode.setState({ replyPermission: reply as never, reviewNotes: {}, messages: {} })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const mount = (r: PendingPermission): void => {
  act(() => root.render(<PermissionCardDesk request={r} root="/proyecto" />))
  // Sin IntersectionObserver la tarjeta se arma por tiempo.
  act(() => vi.advanceTimersByTime(700))
}
const button = (label: string): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.replace(/⌘↵|Ctrl\+↵|Esc/g, '').trim() === label) as HTMLButtonElement

describe('V29: tarjeta de permiso de Código', () => {
  it('muestra una vez el comando completo y las carpetas de fuera', () => {
    mount(request())
    expect(host.textContent!.split(command)).toHaveLength(2)
    expect(host.textContent).toContain('Fuera del proyecto: /tmp')
    expect(button('Permitir')).toBeTruthy()
    expect(button('No')).toBeTruthy()
    expect(host.querySelector('input[data-perm-note]')?.getAttribute('placeholder')).toBe('¿Qué hacer distinto? (opcional)')
  })

  it('«Permitir y no volver a preguntar en este proyecto» manda las reglas no nulas', () => {
    mount(request())
    const always = button('Permitir y no volver a preguntar en este proyecto')
    expect(always.title).toBe('No volverá a preguntar por: cat *, npm test *')
    act(() => always.click())
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ id: 'per_v29' }), 'always', false, { rules: ['cat *', 'npm test *'] })
  })

  it('sin ninguna regla sugerida no aparece', () => {
    mount(request({ subcommands: [{ command: 'rm -rf dist', rule: null }] }))
    expect(button('Permitir y no volver a preguntar en este proyecto')).toBeUndefined()
    expect(button('Permitir')).toBeTruthy()
  })

  it('motor viejo (sin `subcommands`): se conserva el «no volver a preguntar» de antes', () => {
    mount(request({ subcommands: undefined }))
    act(() => button('Permitir y no volver a preguntar en este proyecto').click())
    expect(reply).toHaveBeenCalledWith(expect.anything(), 'always', false, undefined)
  })

  it('«No» con comentario lo manda como `message`; sin comentario, un «No» simple', async () => {
    mount(request())
    await act(async () => button('No').click())
    expect(reply).toHaveBeenLastCalledWith(expect.anything(), 'reject', false, undefined)
    const input = host.querySelector('input[data-perm-note]') as HTMLInputElement
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'usa una carpeta del proyecto')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(reply).toHaveBeenLastCalledWith(expect.anything(), 'reject', false, { message: 'usa una carpeta del proyecto' })
  })

  it('con el tope de bloqueos, el motivo del revisor queda a la vista', () => {
    useCode.setState({ reviewNotes: { per_v29: 'la persona no pidió borrar dist' } })
    mount(request())
    expect(host.textContent).toContain('Revisión automática: la persona no pidió borrar dist')
  })

  it('motor viejo: la salida exterior con comando muestra el comando y la carpeta', () => {
    mount({ ...request(), permission: 'external_directory', patterns: ['/tmp/*'], metadata: { command } })
    expect(host.textContent).toContain('Fuera del proyecto: /tmp')
    expect(host.textContent!.split(command)).toHaveLength(2)
  })
})
