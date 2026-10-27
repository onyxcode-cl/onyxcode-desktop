// @vitest-environment jsdom
/**
 * Tarjeta «¿Permitir que Lazunox use {App}?»: textos es/en, Mac/Windows, atajos (Esc CANCELA y nunca concede; ⌘↵ / Ctrl+↵ concede
 * con scope 'session' solo con el foco en la tarjeta, armada a los 600 ms, sin repetición ni IME y nunca da Control total),
 * «Bloquear siempre» por app (alsoBlock), nivel que se puede bajar, varias apps, motivo largo.
 */
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const respondAccessRequest = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const dismissAccessRequest = vi.hoisted(() => vi.fn())
vi.mock('./actions', () => ({
  respondAccessRequest,
  dismissAccessRequest,
  switchPlanToFolderMode: vi.fn()
}))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import type { AccessRequest } from '@shared/ipc-tasks'
import { useLang } from '../../../lib/i18n'
import { APP_CARD_ARM_MS, AppPermissionCard, isAllowShortcut } from './AppAccessCard'

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
/** Pasa el armado de la tarjeta (600 ms desde que se muestra). */
const arm = (): void => {
  act(() => {
    vi.advanceTimersByTime(APP_CARD_ARM_MS + 10)
  })
}
const radio = (re: RegExp, within: ParentNode = host): HTMLElement =>
  Array.from(within.querySelectorAll('[role="radio"]')).find((b) => re.test(b.textContent ?? '')) as HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  respondAccessRequest.mockClear()
  dismissAccessRequest.mockClear()
  setPlatform('darwin')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('AppPermissionCard', () => {
  it('es/Mac: pregunta, motivo, segundo plano, advertencia del nivel y atajos escritos (sin avisar de ventanas ocultas)', () => {
    render(REQ())
    const txt = host.textContent ?? ''
    expect(txt).toContain('¿Permitir que Lazunox use Hojas?')
    expect(txt).toContain('Para abrir tu hoja y leer los totales')
    expect(txt).toContain('mientras sigues usando tu Mac')
    expect(txt).not.toContain('Tus otras ventanas')
    expect(txt).toContain('Puede ver y hacer clic en esta app')
    expect(btn(/Cancelar/).textContent).toContain('Esc')
    expect(btn(/Denegar/).textContent).not.toContain('Esc')
    expect(btn(/Permitir para esta sesión/).textContent).toContain('⌘↵')
    expect(txt).toContain('Bloquear siempre')
    expect(txt).not.toContain('Pidiendo permiso')
    expect(host.querySelector('[role="radiogroup"]')?.textContent).not.toContain('Denegar')
  })

  it('en/Windows: textos en inglés, PC y Ctrl+↵', () => {
    setPlatform('win32')
    render(REQ(), 'en')
    const txt = host.textContent ?? ''
    expect(txt).toContain('Allow Lazunox to use Hojas?')
    expect(txt).toContain('keep using your PC')
    expect(btn(/Allow for this session/).textContent).toContain('Ctrl+↵')
    expect(btn(/Cancel/).textContent).toContain('Esc')
    expect(btn(/Deny/)).toBeTruthy()
    expect(txt).toContain('Block always')
  })

  it('no dice «Pidiendo permiso…» al responder: la persona ya contestó', () => {
    render(REQ())
    act(() => btn(/Permitir para esta sesión/).click())
    expect(host.textContent).not.toContain('Pidiendo permiso')
  })

  it('Control total: nunca viene elegido aunque el agente lo pida; se elige a propósito y entonces avisa en tono de peligro', () => {
    render(REQ({ apps: [{ bundleId: 'a', name: 'Term', requested: 'full' }] }))
    expect(radio(/Ver y clic/).getAttribute('aria-checked')).toBe('true')
    expect(radio(/Control total/).getAttribute('aria-checked')).toBe('false')
    expect(host.querySelector('[data-testid="app-access-full-hint"]')?.textContent).toContain('El agente pidió Control total')
    act(() => radio(/Control total/).click())
    expect(host.querySelector('[data-tier="full"]')?.className).toContain('text-danger')
    expect(host.textContent).toContain('eliminar cualquier archivo')
    expect(host.querySelector('[data-testid="app-access-full-hint"]')).toBeNull()
    act(() => btn(/Permitir para esta sesión/).click())
    expect(respondAccessRequest).toHaveBeenCalledWith([{ bundleId: 'a', name: 'Term', decision: 'full' }], { scope: 'session' })
  })

  it('pedir Control total y dar Permitir sin tocar nada concede «Ver y clic», no Control total', () => {
    render(REQ({ apps: [{ bundleId: 'a', name: 'Term', requested: 'full' }] }))
    act(() => btn(/Permitir para esta sesión/).click())
    expect((respondAccessRequest.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([{ bundleId: 'a', name: 'Term', decision: 'click' }])
  })

  it('«Solo ver» no muestra aviso de ventanas ni de Control total', () => {
    render(REQ({ apps: [{ bundleId: 'a', name: 'Term', requested: 'view' }] }))
    expect(host.textContent).not.toContain('Tus otras ventanas')
    expect(host.querySelector('[data-testid="app-access-full-hint"]')).toBeNull()
  })

  it('varias apps: título genérico y una fila por app; motivo vacío y motivo largo con scroll', () => {
    render(
      REQ({
        reason: undefined,
        apps: [
          { bundleId: 'a', name: 'A' },
          { bundleId: 'b', name: 'B' }
        ]
      })
    )
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
    act(() => radio(/Solo ver/).click())
    expect(host.textContent).toContain('Puede ver la pantalla de esta app')
    act(() => btn(/Permitir para esta sesión/).click())
    expect((respondAccessRequest.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([
      { bundleId: 'com.x.sheet', name: 'Hojas', decision: 'view' }
    ])
  })

  it('aprobar no sube el nivel sin querer: lo ya concedido se avisa y la preselección no baja de ahí', () => {
    render(REQ({ apps: [{ bundleId: 'a', name: 'A', requested: 'view', current: 'full' }] }))
    act(() => btn(/Permitir para esta sesión/).click())
    expect((respondAccessRequest.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([{ bundleId: 'a', name: 'A', decision: 'full' }])
  })

  it('Denegar deniega todas las apps solo en esta tarea (sin alsoBlock)', () => {
    render(
      REQ({
        apps: [
          { bundleId: 'a', name: 'A' },
          { bundleId: 'b', name: 'B' }
        ]
      })
    )
    act(() => btn(/Denegar/).click())
    expect(respondAccessRequest).toHaveBeenLastCalledWith([
      { bundleId: 'a', name: 'A', decision: 'deny' },
      { bundleId: 'b', name: 'B', decision: 'deny' }
    ])
  })

  it('«Bloquear siempre» va por app: con una sola app bloquea esa app', () => {
    render(REQ())
    act(() => btn(/Bloquear siempre/).click())
    expect(respondAccessRequest).toHaveBeenLastCalledWith([{ bundleId: 'com.x.sheet', name: 'Hojas', decision: 'deny' }], {
      alsoBlock: true
    })
  })

  it('«Bloquear siempre» por fila manda alsoBlock SOLO de esa app, con aria-label con su nombre', () => {
    render(
      REQ({
        apps: [
          { bundleId: 'a', name: 'Alfa' },
          { bundleId: 'b', name: 'Beta' },
          { bundleId: 'c', name: 'Gama' }
        ]
      })
    )
    const links = host.querySelectorAll('li button[aria-label*="siempre"]')
    expect(links.length).toBe(3)
    const beta = host.querySelector('[aria-label="Bloquear Beta siempre (no se le volverá a pedir)"]') as HTMLButtonElement
    act(() => beta.click())
    expect(respondAccessRequest).toHaveBeenCalledTimes(1)
    expect(respondAccessRequest).toHaveBeenLastCalledWith([{ bundleId: 'b', name: 'Beta', decision: 'deny' }], { alsoBlock: true })
  })

  it('«Bloquear siempre» por fila en inglés', () => {
    render(
      REQ({
        apps: [
          { bundleId: 'a', name: 'Alpha' },
          { bundleId: 'b', name: 'Beta' }
        ]
      }),
      'en'
    )
    const beta = host.querySelector('[aria-label="Block Beta always (it will not be asked again)"]') as HTMLButtonElement
    expect(beta.textContent).toBe('Block always')
  })

  describe('Esc = Cancelar', () => {
    it('con el foco en la tarjeta cancela (no concede ni deniega)', () => {
      render(REQ())
      arm()
      key(btn(/Denegar/), { key: 'Escape' })
      expect(dismissAccessRequest).toHaveBeenCalledTimes(1)
      expect(respondAccessRequest).not.toHaveBeenCalled()
    })
    it('el botón Cancelar hace lo mismo', () => {
      render(REQ())
      act(() => btn(/Cancelar/).click())
      expect(dismissAccessRequest).toHaveBeenCalledTimes(1)
      expect(respondAccessRequest).not.toHaveBeenCalled()
    })
    it('un Esc fuera de la tarjeta (otro diálogo, el documento) no hace nada', () => {
      render(REQ())
      arm()
      key(document.body, { key: 'Escape' })
      expect(dismissAccessRequest).not.toHaveBeenCalled()
      expect(respondAccessRequest).not.toHaveBeenCalled()
    })
    it('el Esc de un IME (isComposing) o ya atendido (defaultPrevented) no cancela, ni deniega', () => {
      render(REQ())
      arm()
      key(btn(/Denegar/), { key: 'Escape', isComposing: true })
      expect(dismissAccessRequest).not.toHaveBeenCalled()
      // Un <select> o un diálogo hijo que ya atendió el Esc lo marca con preventDefault antes de que suba a la tarjeta.
      const inner = document.createElement('select')
      card().appendChild(inner)
      inner.addEventListener('keydown', (e) => e.preventDefault())
      key(inner, { key: 'Escape' })
      expect(dismissAccessRequest).not.toHaveBeenCalled()
      expect(respondAccessRequest).not.toHaveBeenCalled()
      inner.remove()
    })
    it('no responde antes del armado ni con la tecla mantenida', () => {
      render(REQ())
      key(btn(/Denegar/), { key: 'Escape' })
      expect(dismissAccessRequest).not.toHaveBeenCalled()
      arm()
      key(btn(/Denegar/), { key: 'Escape', repeat: true })
      expect(dismissAccessRequest).not.toHaveBeenCalled()
    })
  })

  describe('atajo ⌘↵ / Ctrl+↵', () => {
    it('Mac: concede con scope session solo con el foco en la tarjeta; Ctrl+↵ no hace nada en Mac', () => {
      render(REQ())
      arm()
      key(document.body, { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).not.toHaveBeenCalled()
      key(card(), { key: 'Enter', ctrlKey: true })
      expect(respondAccessRequest).not.toHaveBeenCalled()
      key(card(), { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).toHaveBeenCalledWith(expect.any(Array), { scope: 'session' })
    })

    it('Windows: Ctrl+↵ concede con scope session', () => {
      setPlatform('win32')
      render(REQ())
      arm()
      key(btn(/Denegar/), { key: 'Enter', ctrlKey: true })
      expect(respondAccessRequest).toHaveBeenCalledWith(expect.any(Array), { scope: 'session' })
    })

    it('con repeat:true (tecla mantenida) no concede', () => {
      render(REQ())
      arm()
      key(card(), { key: 'Enter', metaKey: true, repeat: true })
      expect(respondAccessRequest).not.toHaveBeenCalled()
    })

    it('dentro de los primeros 600 ms no concede; justo después sí', () => {
      render(REQ())
      act(() => {
        vi.advanceTimersByTime(APP_CARD_ARM_MS - 50)
      })
      key(card(), { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(60)
      })
      key(card(), { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).toHaveBeenCalledTimes(1)
    })

    it('una tarjeta nueva montada justo después de responder otra no se aprueba con la tecla mantenida', () => {
      render(REQ({ id: 'primera' }))
      arm()
      key(card(), { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).toHaveBeenCalledTimes(1)
      // La segunda aparece enseguida (otra app del mismo agente) y la persona sigue sujetando ⌘↵.
      render(REQ({ id: 'segunda', apps: [{ bundleId: 'b', name: 'Otra', requested: 'click' }] }))
      key(card(), { key: 'Enter', metaKey: true })
      key(card(), { key: 'Enter', metaKey: true, repeat: true })
      expect(respondAccessRequest).toHaveBeenCalledTimes(1)
      arm()
      key(card(), { key: 'Enter', metaKey: true, repeat: true })
      expect(respondAccessRequest).toHaveBeenCalledTimes(1)
    })

    it('con un IME componiendo (isComposing) o una tecla ya atendida (defaultPrevented) no concede', () => {
      render(REQ())
      arm()
      key(card(), { key: 'Enter', metaKey: true, isComposing: true })
      const inner = document.createElement('input')
      card().appendChild(inner)
      inner.addEventListener('keydown', (e) => e.preventDefault())
      key(inner, { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).not.toHaveBeenCalled()
      inner.remove()
    })

    it('la tarjeta no roba el foco: el Enter pensado para el compositor no concede nada', () => {
      const composer = document.createElement('textarea')
      document.body.appendChild(composer)
      composer.focus()
      render(REQ())
      arm()
      expect(document.activeElement).toBe(composer)
      key(composer, { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).not.toHaveBeenCalled()
      composer.remove()
      // Sin nadie enfocado tampoco: la tarjeta no se enfoca sola.
      render(REQ({ id: 'otra' }))
      expect(document.activeElement).toBe(document.body)
      key(document.body, { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).not.toHaveBeenCalled()
    })

    it('requested:full sin Control total concedido: el atajo concede «Ver y clic», nunca full', () => {
      render(REQ({ apps: [{ bundleId: 'a', name: 'Term', requested: 'full', current: null }] }))
      arm()
      key(card(), { key: 'Enter', metaKey: true })
      expect((respondAccessRequest.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([
        { bundleId: 'a', name: 'Term', decision: 'click' }
      ])
    })

    it('si la persona eligió Control total (no concedido antes), el atajo no lo envía: hay que pulsar el botón', () => {
      render(REQ({ apps: [{ bundleId: 'a', name: 'Term', requested: 'full', current: 'click' }] }))
      act(() => radio(/Control total/).click())
      arm()
      key(card(), { key: 'Enter', metaKey: true })
      expect(respondAccessRequest).not.toHaveBeenCalled()
      act(() => btn(/Permitir para esta sesión/).click())
      expect((respondAccessRequest.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([
        { bundleId: 'a', name: 'Term', decision: 'full' }
      ])
    })

    it('si Control total ya estaba concedido, el atajo lo mantiene', () => {
      render(REQ({ apps: [{ bundleId: 'a', name: 'Term', requested: 'full', current: 'full' }] }))
      arm()
      key(card(), { key: 'Enter', metaKey: true })
      expect((respondAccessRequest.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([
        { bundleId: 'a', name: 'Term', decision: 'full' }
      ])
    })
  })

  it('isAllowShortcut: ni Mayús ni Alt ni la tecla equivocada', () => {
    const e = { key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }
    expect(isAllowShortcut(e, true)).toBe(true)
    expect(isAllowShortcut({ ...e, shiftKey: true }, true)).toBe(false)
    expect(isAllowShortcut({ ...e, key: 'a' }, true)).toBe(false)
    expect(isAllowShortcut(e, false)).toBe(false)
  })
})
