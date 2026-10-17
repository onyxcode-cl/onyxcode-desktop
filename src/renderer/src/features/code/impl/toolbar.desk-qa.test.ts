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
    expect(ws).toContain('lg:flex desk:flex desk:min-w-[5rem] desk:flex-1 desk:shrink-[4]')
    // H13: el título nunca desaparece por ancho; se trunca con elipsis y lleva el título completo en el tooltip.
    expect(ws).not.toContain('desk:@max-[16rem]:hidden')
    expect(ws).toContain('data-testid="toolbar-session-title"')
  })
  it('H13: con la barra estrecha la rama cede su sitio y las acciones secundarias pasan a un menú «…» con etiquetas', () => {
    expect(ws).toContain('<span className="contents desk:@max-[40rem]:hidden">')
    expect(ws).toContain('<span className="contents desk:@max-[44rem]:hidden">')
    const more = readFileSync(join(__dirname, 'ToolbarMore.tsx'), 'utf8')
    expect(more).toContain('desk:@max-[44rem]:flex')
    for (const k of [
      'instr.open',
      'conv.export.copy',
      'conv.export.saveMd',
      'conv.export.savePdf',
      'code.toolbar.fork',
      'code.toolbar.compact'
    ])
      expect(more).toContain(`t('${k}')`)
    expect(more).toContain("aria-label={t('code.toolbar.more')}")
  })
  it('H12: los iconos de la barra van en grupos con nombre (conversación / revisión / herramientas) y cada botón con aria-label', () => {
    for (const g of ['conversation', 'review', 'tools']) expect(ws).toContain(`code.toolbar.group.${g}`)
    expect(ws).toContain("aria-label={t('code.toolbar.fork')}")
    expect(ws).toContain("aria-label={t('code.toolbar.compact')}")
    expect(ws).toContain('aria-label={t(p.label)}')
    expect(ws).toContain("aria-label={t('code.toolbar.stop')}")
  })
  it('con un aviso arriba no se reserva el hueco de los semáforos (mismo margen izquierdo que con la lista abierta)', () => {
    expect(app).toContain("'--header-inset': !listInFlow && !noticeShown && isMacPlatform() ? '24px' : '0px'")
    expect(app).toContain('data-testid="app-notices"')
  })
})
