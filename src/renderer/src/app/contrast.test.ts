// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Contraste WCAG 2.x de los tokens de globals.css contra los fondos reales de cada tema. Se calcula la razón
 * (L1 + 0.05) / (L2 + 0.05) con la luminancia relativa sRGB: sin dependencias ni navegador, así que falla en
 * `npm test` en cuanto alguien baja un color por debajo del umbral (texto normal 4,5:1; texto grande/iconos 3:1).
 */
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8')

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  const end = css.indexOf('}', start)
  return Object.fromEntries([...css.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]))
}

const THEMES: Record<string, Record<string, string>> = {
  light: tokens(":root,\n[data-theme='light']"),
  dark: tokens("[data-theme='dark'] {")
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Superficies donde puede caer texto de la interfaz. */
const SURFACES = ['bg', 'bg-sidebar', 'bg-elevated', 'bg-hover', 'bg-code', 'bg-inset', 'user-bubble']
const TEXT = ['fg', 'fg-muted', 'fg-subtle', 'accent', 'success', 'warning', 'danger', 'gold-text']

describe('contraste de tokens (WCAG AA)', () => {
  it('lee los tokens de ambos temas', () => {
    for (const t of Object.values(THEMES)) expect(Object.keys(t).length).toBeGreaterThan(20)
  })
  for (const [theme, t] of Object.entries(THEMES)) {
    for (const fg of TEXT) {
      for (const bg of SURFACES) {
        it(`${theme}: ${fg} sobre ${bg} >= 4,5`, () => {
          expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
    it(`${theme}: texto sobre fondos suaves y botón primario >= 4,5`, () => {
      expect(contrast(t['accent'], t['accent-soft'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['gold-text'], t['gold-soft'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['accent-fg'], t['accent'])).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: sobre la fila seleccionada (bg-active) el texto secundario usa --fg-muted >= 4,5`, () => {
      expect(css).toContain('.bg-active .text-subtle')
      expect(contrast(t['fg-muted'], t['bg-active'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['fg'], t['bg-active'])).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: --gold (iconos/decoración) >= 3 sobre las superficies`, () => {
      for (const bg of ['bg', 'bg-elevated']) expect(contrast(t['gold'], t[bg])).toBeGreaterThanOrEqual(3)
    })
    it(`${theme}: la jerarquía se mantiene (fg > muted > subtle)`, () => {
      expect(contrast(t['fg'], t['bg'])).toBeGreaterThan(contrast(t['fg-muted'], t['bg']))
      expect(contrast(t['fg-muted'], t['bg'])).toBeGreaterThan(contrast(t['fg-subtle'], t['bg']))
    })
  }
})
