import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectors } from '../../../test/css-selectors'

/** Las reglas del diseño de Ajustes (lista, rejilla, mosaicos) solo existen sobre el vidrio. */
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8')
const mine = selectors(css).filter((s) => /data-settings-layout|data-settings-tiles|data-theme-grid/.test(s))

describe('Ajustes de vidrio: alcance del CSS', () => {
  it('hay reglas de diseño de Ajustes', () => {
    expect(mine.length).toBeGreaterThan(0)
  })
  it('todas empiezan por html[data-glass]', () => {
    const bad = mine.filter((s) => !s.startsWith('html[data-glass]'))
    expect(bad).toEqual([])
  })
})
