// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * QA visual del panel Cambios en escritorio (el marcado completo necesita el estado git; aquí se fija la decisión en el código):
 * recuentos sin repetir y cabecera del archivo en una sola fila. El celular conserva lo de siempre (todo va con `desk:`).
 */
const src = readFileSync(join(__dirname, 'ChangesPanel.tsx'), 'utf8')

describe('panel Cambios (escritorio, QA)', () => {
  it('«N archivos» de la cabecera solo en el celular (la pestaña y «N por revisar» ya lo dicen)', () => {
    expect(src).toMatch(/<span className="inline desk:hidden">\{status \? t\('code\.changes\.fileCount'/)
  })
  it('el recuento de la sección se oculta en escritorio cuando es la única sección', () => {
    expect(src).toContain("${sole ? ' desk:hidden' : ''}")
    expect(src).toContain('sole={staged.length === 0}')
  })
  it('cabecera del archivo: nombre y acciones en una fila (sin salto) con la ruta truncada', () => {
    expect(src).toContain('desk:min-h-10 desk:flex-nowrap desk:px-4')
    expect(src).toContain('flex min-w-0 flex-1 basis-44 items-center gap-2 desk:basis-0')
  })
  it('diff de escritorio sin ajuste de línea', () => {
    expect(src).toContain('wrap={mobile ? wrap : false}')
  })
})
