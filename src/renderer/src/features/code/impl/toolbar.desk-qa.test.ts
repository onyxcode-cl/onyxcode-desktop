// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** QA visual de la barra superior de Code (escritorio): sin hueco muerto tras la rama y título visible por ancho real. */
const ws = readFileSync(join(__dirname, 'CodeWorkspace.tsx'), 'utf8')
const app = readFileSync(join(__dirname, '../../../app/App.tsx'), 'utf8')

describe('barra superior de Code (escritorio, QA)', () => {
  it('la píldora de rama no reserva un ancho mínimo mayor que su contenido (antes 6,5 rem dejaban un hueco antes de «/»)', () => {
    expect(ws).toContain('<Tip label={tip} className="no-drag desk:max-w-40 desk:shrink-0">')
    expect(ws).not.toContain('desk:min-w-[6.5rem]')
  })
  it('el título de la sesión depende del ancho de la barra (consulta de contenedor), no del punto de quiebre md de la ventana', () => {
    expect(ws).not.toContain('md:desk:flex')
    expect(ws).toContain('lg:flex desk:flex desk:min-w-0 desk:flex-1 desk:shrink-[4] desk:@max-[16rem]:hidden')
  })
  it('con un aviso arriba no se reserva el hueco de los semáforos (mismo margen izquierdo que con la lista abierta)', () => {
    expect(app).toContain("'--header-inset': !listInFlow && !noticeShown && isMacPlatform() ? '24px' : '0px'")
    expect(app).toContain('data-testid="app-notices"')
  })
})
