// E3/E4 (1.8.9, P1): la cabecera del Chat reserva solo el ancho real de los iconos y no los pone encima del título ni del panel de documento.
// La medida real (elementFromPoint a 1280/900/820 px) se hace en la app; esta prueba protege las clases que la garantizan
// (jsdom no calcula el diseño).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, 'ChatView.tsx'), 'utf8')
const header = src.slice(src.indexOf('<header\n          data-mobile="hide"'), src.indexOf('</header>'))

describe('cabecera del Chat (E3/E4)', () => {
  it('los iconos van en el flujo (rejilla), no con «absolute», y el título puede encogerse', () => {
    expect(header).toContain('grid')
    expect(header).not.toMatch(/\babsolute\b/)
    expect(header).not.toMatch(/px-\[max\(15rem/)
    expect(header).toContain('min-w-0 truncate')
  })
  it('la cabecera NO recorta (no repetir F8-B262)', () => {
    expect(header).not.toContain('overflow-hidden')
  })
  it('el margen de los botones de ventana solo se aplica si no hay panel debajo (el panel lo pone en su cabecera)', () => {
    expect(header).toMatch(/docPanel\.open \? 'pr-3' : 'pr-3 desk:pr-\[calc\(var\(--controls-inset,0px\)\+12px\)\]'/)
  })
  it('con el panel superpuesto, los iconos que quedarían debajo se esconden (no se ven ni se pueden pulsar a medias)', () => {
    expect(header).toContain("docPanel.open && narrowRoot ? 'desk:hidden!' : ''")
  })
  it('con poco ancho el panel de documento se superpone al chat en vez de apretarlo', () => {
    expect(src).toContain('DOC_OVERLAY_BELOW = 832')
    expect(src).toContain("narrowRoot ? 'absolute inset-y-0 right-0 z-20 w-[min(100%,28rem)]")
    expect(src.match(/ref=\{rootRef\} className="relative flex h-full"/g) ?? []).toHaveLength(2)
  })
})
