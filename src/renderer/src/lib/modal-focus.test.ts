// @ts-expect-error jsdom no trae tipos en este repositorio (solo se usa en pruebas)
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { FOCUSABLE, tabTarget } from './modal-focus'

describe('tabTarget (trampa de foco de los diálogos)', () => {
  it('sin controles no hace nada', () => {
    expect(tabTarget(0, -1, false)).toBeNull()
  })
  it('Tab en el último vuelve al primero; Mayús+Tab en el primero va al último', () => {
    expect(tabTarget(3, 2, false)).toBe(0)
    expect(tabTarget(3, 0, true)).toBe(2)
  })
  it('en medio lo resuelve el navegador', () => {
    expect(tabTarget(3, 1, false)).toBeNull()
    expect(tabTarget(3, 1, true)).toBeNull()
  })
  it('con el foco fuera de los controles, entra por el primero (Tab) o el último (Mayús+Tab)', () => {
    expect(tabTarget(3, -1, false)).toBe(0)
    expect(tabTarget(3, -1, true)).toBe(2)
  })
  it('con un solo control, Tab y Mayús+Tab se quedan en él', () => {
    expect(tabTarget(1, 0, false)).toBe(0)
    expect(tabTarget(1, 0, true)).toBe(0)
  })
})

describe('FOCUSABLE (qué controles cuentan dentro de un diálogo)', () => {
  it('incluye <summary> y los campos editables, para que los botones de abajo no queden fuera del recorrido con Tab', () => {
    // La configuración global de pruebas sustituye `document`; se usa un DOM propio solo para evaluar el selector.
    const dom = new JSDOM(`<div id="d" role="dialog" aria-modal="true">
      <button id="a">Usar</button>
      <details><summary id="s">Otras formas</summary><p>texto</p></details>
      <div id="e" contenteditable="true"></div>
      <button id="z">Continuar</button>
      <button id="x" disabled>no</button>
    </div>`)
    const ids = Array.from(dom.window.document.querySelectorAll(FOCUSABLE)).map((el) => (el as Element).id)
    expect(ids).toEqual(['a', 's', 'e', 'z'])
  })
})
