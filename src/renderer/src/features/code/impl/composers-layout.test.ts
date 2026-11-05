// 1.8.9 · P2 (E6–E8): los tres cuadros de escribir (Code, Chat y Tareas) no se pisan con «Enviar» ni se salen de su caja.
// La medida real (getBoundingClientRect + elementFromPoint a 1280/900/820 px, con y sin panel) se hace en la app (scripts/shot-desktop.mjs,
// escenarios p2-*); esta prueba protege las clases que lo garantizan, porque jsdom no calcula el diseño.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(join(__dirname, '../../../', p), 'utf8')
const controls = read('features/code/impl/ComposerControls.tsx')
const code = read('features/code/impl/Composer.tsx')
const chat = read('features/chat/ChatComposer.tsx')
const tasks = read('features/tasks/impl/TasksComposer.tsx')
const scope = read('features/tasks/impl/ScopePicker.tsx')
const auto = read('features/tasks/impl/AutoModeChip.tsx')
const project = read('features/projects/ProjectChip.tsx')
const picker = read('components/ModelPicker.tsx')
const meter = read('components/UsageMeter.tsx')

describe('cuadro de escribir de Code (E6)', () => {
  it('el modo de permisos pasa a la etiqueta corta y luego al icono antes de pisar al modelo', () => {
    expect(controls).toContain('collapseClass="inline desk:@max-[40rem]:sr-only"')
    expect(controls).toContain('shortClass="hidden desk:@max-[40rem]:inline desk:@max-[28rem]:sr-only"')
  })
  it('«Comparar» y el medidor de uso se esconden antes de que falte sitio; el modelo conserva un mínimo legible', () => {
    expect(controls).toContain('desk:@max-[40rem]:hidden">\n        <CompareControls')
    expect(controls).toContain('desk:@max-[34rem]:hidden">\n        <UsageMeter')
    expect(controls).toContain('desk:min-w-[4.5rem]')
  })
  it('«Mencionar» y «Adjuntar» pasan al «⋯» con la misma anchura con la que éste aparece', () => {
    expect(controls).toContain('relative hidden desk:@max-[34rem]:block')
    expect(code.match(/desk:@max-\[34rem\]:hidden/g) ?? []).toHaveLength(2)
    expect(code).not.toContain('desk:@max-[24rem]:hidden')
  })
})

describe('cuadro de escribir del Chat (E7)', () => {
  it('la fila es contenedor, así «Comparar», el proyecto y el medidor se adaptan a SU ancho (no al de la ventana)', () => {
    expect(chat).toContain("'flex items-center gap-1.5 px-2 pb-2 desk:@container desk:flex-wrap'")
    expect(chat).toContain('flex-[1_1_6rem]')
  })
  it('el medidor y el botón de traducir se esconden cuando no cabe; «Enviar» no se toca', () => {
    expect(chat).toContain('desk:@max-[26rem]:[&_[data-usage-meter]]:hidden')
    expect(chat).toContain('desk:@max-[24rem]:hidden')
    expect(meter).toContain('data-usage-meter')
  })
  it('el chip del proyecto queda solo con el icono con poco ancho', () => {
    expect(project).toContain('collapseClass="inline desk:@max-[30rem]:sr-only"')
  })
  it('el selector de modelo nunca se encoge hasta ser un punto', () => {
    expect(picker).toContain('desk:min-w-[4rem]')
  })
})

describe('cuadro de escribir de Overdrive / Tareas (E8)', () => {
  it('los chips van en UNA fila (sin envolver) y se acortan a su icono en vez de bajar de renglón', () => {
    expect(tasks).toContain('flex min-w-0 flex-1 flex-nowrap items-center gap-1.5')
    expect(tasks).not.toContain('flex-1 flex-wrap items-center gap-1.5')
    expect(scope).toContain('collapseClass="inline desk:@max-[40rem]:sr-only"')
    expect(auto).toContain('desk:@max-[40rem]:sr-only')
  })
  it('el medidor de uso se esconde con poco ancho', () => {
    expect(tasks).toContain('desk:@max-[26rem]:[&_[data-usage-meter]]:hidden')
  })
})

// Windows, panel lateral fijo (cuadro de ~300 px): el chip del modelo cubría «Enviar» y un clic en «Enviar» abría el menú «Modelo».
describe('«Enviar» de Code siempre libre (fallo B de Windows)', () => {
  it('el modelo se encoge a un mínimo corto y el proyecto y el micrófono se esconden antes de que falte sitio', () => {
    expect(controls).toContain('desk:min-w-[4.5rem]')
    expect(controls).toContain('desk:max-w-[13rem] desk:@max-[20rem]:hidden')
    expect(code).toContain('desk:@max-[17rem]:hidden')
  })
  it('«Enviar» va por encima (z-10): aunque algo se desborde, el clic llega a «Enviar»', () => {
    expect(code).toContain('className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-accent')
  })
})
