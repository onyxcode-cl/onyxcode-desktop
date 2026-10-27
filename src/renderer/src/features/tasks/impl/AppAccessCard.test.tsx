// @vitest-environment jsdom
/**
 * Tarjeta «¿Permitir que Lazunox use {App}?»: textos es/en, Mac/Windows, atajos (Esc nunca concede; ⌘↵ / Ctrl+↵ concede con
 * scope 'session' solo con el foco en la tarjeta), «Bloquear siempre» (alsoBlock), nivel que se puede bajar, varias apps, motivo largo.
 */
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const respondAccessRequest = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('./actions', () => ({
  respondAccessRequest,
  dismissAccessRequest: vi.fn(),
  switchPlanToFolderMode: vi.fn()
}))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import type { AccessRequest } from '@shared/ipc-tasks'
import { useLang } from '../../../lib/i18n'
import { AppPermissionCard, isAllowShortcut } from './AppAccessCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const REQ = (over: Partial<AccessRequest> = {}): AccessRequest =>
  ({
    id: 'r1',
    reason: 'Para abrir tu hoja y leer los totales',
    apps: [{ bundleId: 'com.x.sheet', name: 'Hojas', requested: 'click' }],
    ...over
  }) as AccessRequest

const setPlatform = (p: 'darwin' | 'win32'): void => {
  ;(window as unknown as { api: unknown }).api = { platform: p, capsFlags: {} }
}
const render = (req: AccessRequest, lang: 'es' | 'en' = 'es'): void => {
  setLang(lang)
  useLang.setState({ lang })
  act(() => root.render(createElement(AppPermissionCard, { req, key: `${req.id}-${JSON.stringify(req.apps)}` })))
}
const btn = (re: RegExp): HTMLButtonElement =>
  Array.from(host.querySelectorAll('button')).find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement
const card = (): HTMLElement => host.querySelector('[role="alertdialog"]') as HTMLElement
const key = (el: Element, init: KeyboardEventInit): void => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

beforeEach(() => {
  respondAccessRequest.mockClear()
  setPlatform('darwin')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('AppPermissionCard', () => {
  it('es/Mac: pregunta, motivo, aviso de segundo plano, ventanas, advertencia del nivel y atajos escritos', () => {
    render(REQ())
    const txt = host.textContent ?? ''
    expect(txt).toContain('¿Permitir que Lazunox use Hojas?')
    expect(txt).toContain('Para abrir tu hoja y leer los totales')
    expect(txt).toContain('mientras sigues usando tu Mac')
    expect(txt).toContain('Tus otras ventanas se ocultarán')
    expect(txt).toContain('Puede ver y hacer clic en esta app')
    expect(btn(/Denegar/).textContent).toContain('Esc')
    expect(btn(/Permitir para esta sesión/).textContent).toContain('⌘↵')
    expect(txt).toContain('Bloquear siempre')
    expect(host.querySelector('[role="radiogroup"]')?.textContent).not.toContain('Denegar')
  })

  it('en/Windows: textos en inglés, PC y Ctrl+↵', () => {
    setPlatform('win32')
    render(REQ(), 'en')
    const txt = host.textContent ?? ''
    expect(txt).toContain('Allow Lazunox to use Hojas?')
    expect(txt).toContain('keep using your PC')
    expect(btn(/Allow for this session/).textContent).toContain('Ctrl+↵')
    expect(btn(/Deny/).textContent).toContain('Esc')
    expect(txt).toContain('Block always')
  })

  it('Control total: advertencia en tono de peligro; Solo ver oculta el aviso de ventanas', () => {
    render(REQ({ apps: [{ bundleId: 'a', name: 'Term', requested: 'full' }] }))
    expect(host.querySelector('[data-tier="full"]')?.className).toContain('text-danger')
    expect(host.textContent).toContain('eliminar cualquier archivo')
    render(REQ({ apps: [{ bundleId: 'a', name: 'Term', requested: 'view' }] }))
    expect(host.textContent).not.toContain('Tus otras ventanas')
  })

  it('varias apps: título genérico y una fila por app; motivo vacío y motivo largo con scroll', () => {
    render(REQ({ reason: undefined, apps: [{ bundleId: 'a', name: 'A' }, { bundleId: 'b', name: 'B' }] }))
    expect(host.textContent).toContain('¿Permitir que Lazunox use estas aplicaciones?')
    expect(host.querySelectorAll('li').length).toBe(2)
    expect(host.textContent).toContain('Sin motivo indicado')
    render(REQ({ reason: 'x '.repeat(500) }))
    expect(host.querySelector('[data-testid="app-access-reason"]')?.className).toContain('overflow-y-auto')
  })

  it('Permitir: scope session explícito, con el nivel pedido', () => {
    render(REQ())
    act(() => btn(/Permitir para esta sesión/).click())
    expect(respondAccessRequest).toHaveBeenCalledWith([{ bundleId: 'com.x.sheet', name: 'Hojas', decision: 'click' }], { scope: 'session' })
  })

  it('el nivel se puede bajar y Permitir manda el nivel elegido', () => {
    render(REQ())
    const verOnly = Array.from(host.querySelectorAll('[role="radio"]')).find((b) => /Solo ver/.test(b.textContent ?? '')) as HTMLElement
    act(() => verOnly.click())
    expect(host.textContent).toContain('Puede ver la pantalla de esta app')
    act(() => btn(/Permitir para esta sesión/).click())
    expect((respondAccessRequest.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([{ bundleId: 'com.x.sheet', name: 'Hojas', decision: 'view' }])
  })

  it('aprobar no sube el nivel sin querer: lo ya concedido se avisa y la preselección no baja de ahí', () => {
    render(REQ({ apps: [{ bundleId: 'a', name: 'A', requested: 'view', current: 'full' }] }))
    act(() => btn(/Permitir para esta sesión/).click())
    expect((respondAccessRequest.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([{ bundleId: 'a', name: 'A', decision: 'full' }])
  })

  it('Denegar deniega solo en esta tarea; Bloquear siempre manda alsoBlock', () => {
    render(REQ())
    act(() => btn(/Denegar/).click())
    expect(respondAccessRequest).toHaveBeenLastCalledWith([{ bundleId: 'com.x.sheet', name: 'Hojas', decision: 'deny' }])
    render(REQ({ id: 'r2' }))
    act(() => btn(/Bloquear siempre/).click())
    expect(respondAccessRequest).toHaveBeenLastCalledWith([{ bundleId: 'com.x.sheet', name: 'Hojas', decision: 'deny' }], { alsoBlock: true })
  })

  it('Esc deniega y NUNCA concede', () => {
    render(REQ())
    key(document.body, { key: 'Escape' })
    expect(respondAccessRequest).toHaveBeenCalledTimes(1)
    const [decisions, opts] = respondAccessRequest.mock.calls[0] as unknown as [Array<{ decision: string }>, unknown]
    expect(decisions.every((d) => d.decision === 'deny')).toBe(true)
    expect(opts).toBeUndefined()
  })

  it('⌘↵ (Mac) concede con scope session solo con el foco en la tarjeta; Ctrl+↵ no hace nada en Mac', () => {
    render(REQ())
    key(document.body, { key: 'Enter', metaKey: true })
    expect(respondAccessRequest).not.toHaveBeenCalled()
    key(card(), { key: 'Enter', ctrlKey: true })
    expect(respondAccessRequest).not.toHaveBeenCalled()
    key(card(), { key: 'Enter', metaKey: true })
    expect(respondAccessRequest).toHaveBeenCalledWith(expect.any(Array), { scope: 'session' })
  })

  it('Ctrl+↵ (Windows) concede con scope session', () => {
    setPlatform('win32')
    render(REQ())
    key(btn(/Denegar/), { key: 'Enter', ctrlKey: true })
    expect(respondAccessRequest).toHaveBeenCalledWith(expect.any(Array), { scope: 'session' })
  })

  it('isAllowShortcut: ni Mayús ni Alt ni la tecla equivocada', () => {
    const e = { key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }
    expect(isAllowShortcut(e, true)).toBe(true)
    expect(isAllowShortcut({ ...e, shiftKey: true }, true)).toBe(false)
    expect(isAllowShortcut({ ...e, key: 'a' }, true)).toBe(false)
    expect(isAllowShortcut(e, false)).toBe(false)
  })
})
