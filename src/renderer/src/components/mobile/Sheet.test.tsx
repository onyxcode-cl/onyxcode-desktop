import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SHEET_CLOSE_DISTANCE, SheetView, createSheetStack, sheetStyle, shouldCloseOnDrag } from './Sheet'

const html = (size?: 'half' | 'full'): string =>
  renderToStaticMarkup(
    createElement(SheetView, { onClose: () => undefined, title: 'Modelo', size, children: createElement('button', null, 'Uno') })
  )

describe('Sheet (hoja inferior modal)', () => {
  it('es un diálogo modal accesible con título enlazado y botón de cerrar de 44 px', () => {
    const out = html()
    expect(out).toContain('role="dialog"')
    expect(out).toContain('aria-modal="true"')
    const id = /aria-labelledby="([^"]+)"/.exec(out)?.[1]
    expect(id).toBeTruthy()
    expect(out).toContain(`id="${id}"`)
    expect(out).toContain('>Modelo</h2>')
    expect(out).toMatch(/aria-label="[^"]+"[^>]*class="[^"]*h-11 w-11/)
  })

  it('el botón de cerrar es el primer control (modal-focus enfoca el primero al abrir)', () => {
    const out = html()
    expect(out.indexOf('<button')).toBeLessThan(out.indexOf('Uno'))
  })

  it('respeta el tamaño y deja la zona segura', () => {
    expect(html('half')).toContain('data-size="half"')
    expect(html('full')).toContain('data-size="full"')
    expect(sheetStyle('full').height).toContain('--vv-height')
    expect(sheetStyle('half').maxHeight).toContain('0.6')
    expect(html()).toContain('safe-area-inset-bottom')
  })

  it('Esc solo cierra la hoja de más arriba', () => {
    const s = createSheetStack()
    const a = s.open()
    const b = s.open()
    expect(s.isTop(a)).toBe(false)
    expect(s.isTop(b)).toBe(true)
    s.close(b)
    expect(s.isTop(a)).toBe(true)
    s.close(a)
    expect(s.isTop(a)).toBe(false)
  })

  it('el gesto de arrastrar cierra por distancia o por velocidad, nunca hacia arriba', () => {
    expect(shouldCloseOnDrag(SHEET_CLOSE_DISTANCE, 800)).toBe(true)
    expect(shouldCloseOnDrag(SHEET_CLOSE_DISTANCE - 10, 800)).toBe(false)
    expect(shouldCloseOnDrag(40, 40)).toBe(true) // rápido y corto
    expect(shouldCloseOnDrag(-200, 50)).toBe(false)
    expect(shouldCloseOnDrag(0, 10)).toBe(false)
  })

  it('con prefers-reduced-motion se anula la animación (regla global)', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8')
    expect(css).toContain('--animate-sheet-up')
    const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(rm).toContain('animation-duration: 0.01ms !important')
  })
})
