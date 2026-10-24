// @vitest-environment jsdom
import '../../../../../test/jsdom-first'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { ENGINE_LIMIT_SPECS, type EngineLimits } from '@shared/engine-limits'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { EngineLimitsBlock } from './EngineLimitsBlock'
import { useSettings } from '../../../stores/settings'
import { applyLangPref } from '../../../lib/i18n'

let host: HTMLDivElement
let root: Root
let update: ReturnType<typeof vi.fn>

const input = (key: string): HTMLInputElement => host.querySelector<HTMLInputElement>(`input[data-limit="${key}"]`)!
const resetBtn = (): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => /Restablecer|Restore/.test(b.textContent ?? ''))!

function mount(engineLimits: EngineLimits | undefined = {}): void {
  update = vi.fn(async () => undefined)
  act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, engineLimits: engineLimits as EngineLimits }, update }))
  act(() => root.render(createElement(EngineLimitsBlock)))
}

function type(el: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const blur = (el: HTMLInputElement): void => {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
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

describe('EngineLimitsBlock', () => {
  it('muestra los ocho campos con los defectos, mínimo/máximo y nombre accesible (sin el campo guardado también)', () => {
    for (const stored of [{}, undefined]) {
      mount(stored)
      for (const s of ENGINE_LIMIT_SPECS) {
        const el = input(s.key)
        expect(el, s.key).toBeTruthy()
        expect(el.type).toBe('number')
        expect(el.value).toBe(String(s.def))
        expect(el.min).toBe(String(s.min))
        expect(el.max).toBe(String(s.max))
        // Nombre accesible directo (axe exige una etiqueta que pueda resolver): «<título> (<unidad>)».
        expect((el.getAttribute('aria-label') ?? '').length).toBeGreaterThan(5)
        expect(el.getAttribute('aria-label')).toMatch(/\(.+\)$/)
        expect(document.getElementById(el.getAttribute('aria-describedby')!)?.textContent).toBeTruthy()
      }
      expect(host.textContent).toContain('Por defecto 10 min; permitido de 1 a 120.')
      act(() => root.render(createElement('div')))
    }
  })

  it('refleja lo guardado', () => {
    mount({ codeTimeoutMin: 45, shellOutputMb: 20 })
    expect(input('codeTimeoutMin').value).toBe('45')
    expect(input('shellOutputMb').value).toBe('20')
    expect(input('codeMaxCells').value).toBe('3')
  })

  it('al confirmar un valor guarda solo ese campo (objeto escaso)', () => {
    mount({ shellLifeMin: 60 })
    const el = input('codeTimeoutMin')
    type(el, '25')
    expect(update).not.toHaveBeenCalled() // no guarda a cada tecla
    blur(el)
    expect(update).toHaveBeenLastCalledWith({ engineLimits: { shellLifeMin: 60, codeTimeoutMin: 25 } })
  })

  it('también confirma con Enter', () => {
    mount()
    const el = input('codeMaxCells')
    type(el, '4')
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(update).toHaveBeenLastCalledWith({ engineLimits: { codeMaxCells: 4 } })
  })

  it('acerca al mínimo o máximo lo que queda fuera de rango', () => {
    mount()
    type(input('codeTimeoutMin'), '999')
    blur(input('codeTimeoutMin'))
    expect(update).toHaveBeenLastCalledWith({ engineLimits: { codeTimeoutMin: 120 } })
    expect(input('codeTimeoutMin').value).toBe('120')
    type(input('codeMaxCalls'), '1')
    blur(input('codeMaxCalls'))
    expect(update).toHaveBeenLastCalledWith({ engineLimits: { codeMaxCalls: 10 } })
    expect(input('codeMaxCalls').value).toBe('10')
  })

  it('un valor igual al defecto quita la clave; vacío o texto restaura lo mostrado sin guardar', () => {
    mount({ codeMaxCells: 5 })
    type(input('codeMaxCells'), '3')
    blur(input('codeMaxCells'))
    expect(update).toHaveBeenLastCalledWith({ engineLimits: {} })
    update.mockClear()
    type(input('codeYieldSec'), '')
    blur(input('codeYieldSec'))
    expect(update).not.toHaveBeenCalled()
    expect(input('codeYieldSec').value).toBe('30')
  })

  it('sin cambiar el valor no guarda nada', () => {
    mount()
    blur(input('codeMaxCells'))
    expect(update).not.toHaveBeenCalled()
  })

  it('«Restablecer valores por defecto» está apagado sin cambios y, con ellos, envía el objeto vacío', () => {
    mount()
    expect(resetBtn().disabled).toBe(true)
    mount({ codeTimeoutMin: 45, codeMaxCells: 2 })
    expect(resetBtn().disabled).toBe(false)
    act(() => resetBtn().click())
    expect(update).toHaveBeenLastCalledWith({ engineLimits: {} })
  })

  it('en inglés usa los textos en inglés', () => {
    applyLangPref('en')
    mount()
    expect(host.textContent).toContain('Limits')
    expect(host.textContent).toContain('Restore default values')
    expect(host.textContent).toContain('Default 10 min; allowed from 1 to 120.')
    expect(host.textContent).not.toContain('Restablecer')
  })
})
