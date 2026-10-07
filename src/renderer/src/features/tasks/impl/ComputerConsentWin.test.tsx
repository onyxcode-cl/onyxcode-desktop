/**
 * Consentimiento de Control del PC en Windows (C5): la tarjeta, el botón armado (casilla + 600 ms), la ausencia de atajos de teclado
 * y los textos es/en sin símbolos del Mac. Se prueba la vista pura (el repo prueba con `renderToStaticMarkup`, sin DOM).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DICTIONARIES, setI18nPlatform, translate, type MsgKey, type Params } from '@shared/i18n'
import { CONSENT_UI_ARM_MS, ConsentCardView, ConsentOnView, consentUiArmed } from './ComputerConsentWin'

const tEs = (k: MsgKey, p?: Params): string => translate('es', k, p)
const tEn = (k: MsgKey, p?: Params): string => translate('en', k, p)

const card = (o: Partial<Parameters<typeof ConsentCardView>[0]> = {}, t = tEs): string =>
  renderToStaticMarkup(
    createElement(ConsentCardView, {
      t,
      stale: false,
      version: 1,
      checked: false,
      armed: false,
      busy: false,
      message: null,
      onCheck: vi.fn(),
      onActivate: vi.fn(),
      ...o
    })
  )

/** ¿El primer botón tiene el atributo `disabled`? (no las clases `disabled:` de Tailwind). */
const isDisabled = (html: string): boolean => /<button[^>]*\sdisabled(=""|\s|>)/.test(html)

describe('armado del botón (casilla + 600 ms)', () => {
  it('solo con la casilla marcada y pasados 600 ms desde que se mostró', () => {
    expect(CONSENT_UI_ARM_MS).toBe(600)
    expect(consentUiArmed(true, 1_000, 1_599)).toBe(false)
    expect(consentUiArmed(true, 1_000, 1_600)).toBe(true)
    expect(consentUiArmed(false, 1_000, 5_000)).toBe(false)
    expect(consentUiArmed(true, null, 5_000)).toBe(false)
  })
})

describe('tarjeta de consentimiento', () => {
  it('el botón está desactivado hasta que está armado', () => {
    expect(isDisabled(card({ armed: false }))).toBe(true)
    expect(isDisabled(card({ armed: true }))).toBe(false)
    expect(isDisabled(card({ armed: true, busy: true }))).toBe(true)
  })

  it('lista lo que puede y lo que nunca podrá, con la casilla «Entiendo»', () => {
    const h = card()
    for (const k of ['can1', 'can2', 'can3', 'never1', 'never2', 'never3', 'never4', 'check', 'stop', 'audit']) {
      expect(h).toContain(tEs(`tasksComputer.consent.${k}` as MsgKey).replace(/&/g, '&amp;'))
    }
    expect(h).toContain('type="checkbox"')
    expect(h).toContain('administrador')
    expect(h).toContain('contraseñas')
  })

  it('es accesible: grupo con título y descripción, pista enlazada al botón y estado anunciado', () => {
    const h = card({ message: 'Espera' })
    expect(h).toContain('role="group"')
    expect(h).toContain('aria-labelledby="win-consent-title"')
    expect(h).toContain('aria-describedby="win-consent-hint"')
    expect(h).toMatch(/role="status"[^>]*aria-live="polite"[^>]*>Espera</)
    expect(h).not.toContain('aria-hidden="false"')
  })

  it('un permiso de otra versión explica por qué se pide de nuevo', () => {
    expect(card({ stale: false })).not.toContain('role="note"')
    expect(card({ stale: true, version: 2 })).toContain('versión 2')
  })

  it('ningún texto con símbolos del Mac, en español ni en inglés, y el atajo de parada es el de Windows', () => {
    setI18nPlatform('win32')
    try {
      for (const t of [tEs, tEn]) {
        const h = card({}, t) + renderToStaticMarkup(createElement(ConsentOnView, { t, busy: false, onRevoke: vi.fn() }))
        expect(h).not.toMatch(/[⌘⌥⌃]/)
        expect(h).not.toMatch(/\bMac\b|Finder|Spotlight/)
      }
      expect(card()).toContain('Ctrl+Alt+Mayús+Esc')
      expect(card({}, tEn)).toContain('Ctrl+Alt+Shift+Esc')
    } finally {
      setI18nPlatform('darwin')
    }
  })

  it('en inglés también está completa', () => {
    const h = card({}, tEn)
    expect(h).toContain('Turn on PC control')
    expect(h).toContain('There is no keyboard shortcut to accept')
  })

  it('estado activado: avisa y ofrece retirar el permiso', () => {
    const h = renderToStaticMarkup(createElement(ConsentOnView, { t: tEs, busy: false, onRevoke: vi.fn() }))
    expect(h).toContain('Control del PC está activado')
    expect(h).toContain('Retirar permiso')
  })
})

describe('sin atajo de teclado para aceptar', () => {
  const src = readFileSync(join(__dirname, 'ComputerConsentWin.tsx'), 'utf8')
  it('el componente no escucha teclas, no es un formulario y no enfoca el botón solo', () => {
    expect(src).not.toMatch(/onKeyDown|onKeyUp|onKeyPress|addEventListener\(\s*['"]key/)
    expect(src).not.toMatch(/<form|autoFocus|accessKey|\.focus\(/)
  })
})

describe('claves de texto', () => {
  it('todas las claves del consentimiento existen en es y en en', () => {
    const keys = Object.keys(DICTIONARIES.es).filter((k) => /^tasksComputer\.(consent|winStatus|audit)\./.test(k))
    expect(keys.length).toBeGreaterThan(40)
    for (const k of keys) expect(DICTIONARIES.en[k], k).toBeDefined()
  })
})
