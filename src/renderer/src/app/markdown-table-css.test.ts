import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8')
const rule = (sel: string): string => {
  const m = new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)
  return m?.[1] ?? ''
}

describe('tablas del Markdown (E1)', () => {
  it('las celdas no se parten letra por letra: overflow-wrap normal y un ancho mínimo, para que la tabla se desplace en horizontal', () => {
    const cell = rule('.markdown th,\n.markdown td')
    expect(cell).toMatch(/overflow-wrap:\s*normal/)
    expect(cell).toMatch(/min-width:\s*\d+ch/)
  })
  it('la tabla sigue teniendo desplazamiento horizontal propio', () => {
    expect(rule('.markdown table')).toMatch(/overflow-x:\s*auto/)
  })
})
