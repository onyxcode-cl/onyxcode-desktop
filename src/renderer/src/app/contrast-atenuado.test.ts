// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * H22: pares clave de texto atenuado (--fg-subtle / --fg-muted, placeholders, etiquetas pequeñas) en ambos temas y en
 * CADA acento (el fondo suave del acento cambia con él), más reglas de código que impiden bajar el contraste con
 * opacidad. Complementa a `contrast.test.ts` (que cubre texto y semánticos contra las superficies base).
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
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const ACCENTS = ['violet', 'green', 'teal', 'rose']
const variants: [string, Record<string, string>][] = [
  ['light', THEMES.light],
  ['dark', THEMES.dark],
  ...ACCENTS.flatMap((a): [string, Record<string, string>][] => [
    [`light/${a}`, { ...THEMES.light, ...tokens(`[data-accent='${a}'] {`) }],
    [`dark/${a}`, { ...THEMES.dark, ...tokens(`[data-theme='dark'][data-accent='${a}'] {`) }]
  ])
]

describe('texto atenuado (H22)', () => {
  for (const [name, t] of variants) {
    it(`${name}: --fg-subtle y --fg-muted sobre --accent-soft >= 4,5`, () => {
      expect(contrast(t['fg-subtle'], t['accent-soft'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['fg-muted'], t['accent-soft'])).toBeGreaterThanOrEqual(4.5)
    })
    it(`${name}: el acento como texto sobre --accent-soft y las superficies >= 4,5`, () => {
      expect(contrast(t['accent'], t['accent-soft'])).toBeGreaterThanOrEqual(4.5)
      for (const bg of ['bg', 'bg-elevated']) expect(contrast(t['accent'], t[bg])).toBeGreaterThanOrEqual(4.5)
    })
  }
  for (const [theme, t] of Object.entries(THEMES)) {
    it(`${theme}: placeholders y etiquetas pequeñas sobre campo, tarjeta, barra lateral, hover e inset >= 4,5`, () => {
      for (const bg of ['bg', 'bg-elevated', 'bg-sidebar', 'bg-hover', 'bg-inset', 'bg-code']) {
        expect(contrast(t['fg-subtle'], t[bg])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t['fg-muted'], t[bg])).toBeGreaterThanOrEqual(4.5)
      }
    })
    it(`${theme}: iconos atenuados (--fg-subtle) sobre la fila seleccionada >= 3`, () => {
      expect(contrast(t['fg-subtle'], t['bg-active'])).toBeGreaterThanOrEqual(3)
    })
  }

  it('el texto no se atenúa con un modificador de opacidad (text-subtle/70 baja a ~3:1)', () => {
    const root = join(__dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        // DiffView: la variante táctil usa /70 en números de línea y la de escritorio lo anula con `desk:text-subtle`.
        else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) && e.name !== 'DiffView.tsx') {
          if (/(?:text|placeholder)-(?:subtle|muted)\/\d+/.test(readFileSync(p, 'utf8'))) offenders.push(p.slice(root.length))
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })

  it('el texto pequeño sobre `desk:bg-active` usa --fg-muted (subtle ahí queda en ~4:1)', () => {
    const src = readFileSync(join(__dirname, '..', 'components/ModelPicker.tsx'), 'utf8')
    expect(src).toContain('desk:text-muted desk:bg-active')
  })
})
