/**
 * Encabezado de proyecto de Code: el «+» (nueva sesión) queda al borde derecho, separado de la «X», y no responde a un
 * Return/Espacio sin foco de teclado real. Se comprueba sobre el código fuente (el render completo necesita el almacén entero).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = readFileSync(new URL('./SessionList.tsx', import.meta.url), 'utf8')
const header = src.slice(src.indexOf('<span className="absolute top-1/2 right-1'), src.indexOf('{!compact && !desktop'))

describe('encabezado de proyecto: «+» separado de la «X»', () => {
  it('orden: X, worktree, buscar y «+» al final; la «X» solo sale al pasar el mouse', () => {
    const iX = header.indexOf('closeProject')
    const iWt = header.indexOf('newWorktree')
    const iSearch = header.indexOf('searchTitle')
    const iPlus = header.indexOf('project-new-session')
    expect(iX).toBeGreaterThan(-1)
    expect(iX).toBeLessThan(iWt)
    expect(iWt).toBeLessThan(iSearch)
    expect(iSearch).toBeLessThan(iPlus)
    const xBtn = header.slice(iX, iWt)
    expect(xBtn).toContain('hidden')
    expect(xBtn).toContain('group-hover/proj:flex')
  })

  it('el «+» siempre visible, con margen de 8 px (ml-2) y exige foco de teclado real al activarse sin ratón', () => {
    const plusBtn = header.slice(header.indexOf('data-testid="project-new-session"'))
    expect(plusBtn).toContain('ml-2')
    expect(plusBtn).not.toMatch(/\bhidden\b/)
    expect(plusBtn).toContain('e.detail === 0 && !hasKeyboardFocus(e.currentTarget)')
  })

  it('tras cerrar proyecto o el diálogo de worktree el foco va a un sitio neutro', () => {
    expect(src).toContain('data-session-list-root')
    expect(src.match(/focusNeutral\(\)/g)?.length).toBeGreaterThanOrEqual(3)
  })
})
