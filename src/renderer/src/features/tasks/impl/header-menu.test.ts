// F8-B261: el «⋯» de la cabecera de la tarea debe quedar siempre a la vista, también con «Terminado con avisos» y el panel abierto.
// La medida real (elementFromPoint a 1280/900/820 px) se hace en la app empaquetada; esta prueba protege las clases que lo garantizan
// (jsdom no calcula el diseño).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, 'TasksWorkspace.tsx'), 'utf8')

describe('cabecera de la tarea (F8-B261)', () => {
  it('la cabecera NO recorta (el menú desplegable del «⋯» cuelga fuera de sus 48 px)', () => {
    expect(src).toMatch(/className=\{`flex h-12 min-w-0 shrink-0 items-center gap-2\.5 border-b/)
    expect(src).not.toMatch(/className=\{`flex h-12 [^`]*overflow-hidden/)
  })
  it('la píldora de estado (normal y con avisos) se encoge y su texto se esconde en ancho chico', () => {
    const pills = src.match(/flex min-w-0 shrink items-center gap-1\.5 overflow-hidden whitespace-nowrap rounded-full/g) ?? []
    expect(pills).toHaveLength(2)
    expect(src.match(/min-w-0 truncate @max-\[26rem\]:hidden/g) ?? []).toHaveLength(2)
  })
  it('el cronómetro se esconde en ancho chico y el grupo del «⋯» no se encoge', () => {
    expect(src).toContain('@max-[30rem]:hidden')
    expect(src).toContain('<span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted">')
  })
})
