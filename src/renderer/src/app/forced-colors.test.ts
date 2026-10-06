import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectors } from '../../../test/css-selectors'

/** Alto contraste de Windows (Forced Colors): las reglas de `app/desktop/base.css` existen y no se filtran fuera del escritorio. */
const read = (p: string): string => readFileSync(join(__dirname, p), 'utf8')
const base = read('desktop/base.css')
const block = base.slice(base.indexOf('@media (forced-colors: active)'))
const S = ":root[data-shell='desktop']"

describe('forced-colors en escritorio', () => {
  it('hay un bloque @media (forced-colors: active)', () => {
    expect(base).toContain('@media (forced-colors: active)')
  })
  it('foco visible con Highlight', () => {
    expect(block).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight/)
  })
  it('botones con borde ButtonText', () => {
    expect(block).toMatch(/button[^{]*\{[^}]*border:\s*1px solid ButtonText/)
  })
  it('ítem seleccionado con Highlight/HighlightText', () => {
    expect(block).toMatch(/aria-current='page'[^{]*\{[^}]*background-color:\s*Highlight;[^}]*color:\s*HighlightText/)
  })
  it('forced-color-adjust:none solo en el logo y en los marcadores +/- del diff', () => {
    const rules = [...block.matchAll(/([^{}]+)\{[^}]*forced-color-adjust:\s*none[^}]*\}/g)].map((m) => m[1].trim())
    const nonSelection = rules.filter((r) => !r.includes('aria-current'))
    expect(nonSelection).toHaveLength(2)
    expect(nonSelection.some((r) => r.includes('svg[viewBox'))).toBe(true)
    expect(nonSelection.some((r) => r.includes('[data-diff]'))).toBe(true)
  })
  it('todo bajo el ámbito de escritorio', () => {
    const heads = selectors(block)
    expect(heads.length).toBeGreaterThan(4)
    for (const h of heads) expect(h.startsWith(S), h).toBe(true)
  })
  it('--font-mono nombra Cascadia antes de Consolas', () => {
    const g = read('globals.css')
    const line = g.split('\n').find((l) => l.includes('--font-mono:')) ?? ''
    expect(line.indexOf("'Cascadia Mono'")).toBeGreaterThan(-1)
    expect(line.indexOf("'Cascadia Code'")).toBeGreaterThan(line.indexOf("'Cascadia Mono'"))
    expect(line.indexOf('Consolas')).toBeGreaterThan(line.indexOf("'Cascadia Code'"))
  })
  it('la PWA no importa el CSS de escritorio ni data-shell', () => {
    expect(read('globals.css')).not.toContain('forced-colors')
  })
})
