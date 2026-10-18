// @vitest-environment jsdom
/** Recetas de Rutinas (F8-B188): lista, detalle, preguntas y paso al formulario sin crear nada. */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECIPES } from '@shared/routine-recipes'
import { click, mount, pressKey, typeInto, type Mounted } from '../../../../../test/dom-render'

const caps = vi.hoisted(() => ({ tasks: true }))
const bridge = vi.hoisted(() => ({ cw: vi.fn() }))
vi.mock('../../../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/platform')>()),
  platformCaps: () => ({ tasks: caps.tasks })
}))
vi.mock('../../tasks/impl/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tasks/impl/bridge')>()),
  cw: bridge.cw,
  hasTasksBridge: () => true
}))
vi.mock('../../settings/impl/extras', () => ({ resolveModelForMode: () => ({ providerID: 'p', modelID: 'm' }) }))

import { RecipesDialog } from './RecipesDialog'
import { useRoutines } from './store'

let m: Mounted | null = null
let closed = 0
const open = (initialId?: string | null): void => {
  m = mount(createElement(RecipesDialog, { initialId, onClose: () => void closed++ }))
}
const dialog = (): HTMLElement => m!.q('[data-testid="recipes-dialog"]')!
const card = (id: string): HTMLElement | null => m!.q(`[data-testid="recipe-${id}"]`)
const useButton = (): HTMLButtonElement => m!.qa<HTMLButtonElement>('button').find((b) => b.textContent === 'Usar esta receta')!

beforeEach(() => {
  vi.unstubAllGlobals() // jsdom real en vez del window de setup.ts
  delete (window as unknown as { api?: unknown }).api
  caps.tasks = true
  closed = 0
  bridge.cw.mockReset()
  useRoutines.setState({ editing: null, editingHint: null })
})
afterEach(() => {
  m?.unmount()
  m = null
})

describe('RecipesDialog', () => {
  it('lista todas las recetas en dos grupos, con título, descripción, horario y modo', () => {
    open()
    const d = dialog()
    expect(d.getAttribute('role')).toBe('dialog')
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Recetas')
    expect(d.textContent).toContain('Para todos')
    expect(d.textContent).toContain('Para quien programa')
    for (const r of RECIPES) {
      const c = card(r.id)!
      expect(c, r.id).not.toBeNull()
      expect(c.textContent).toContain(r.title.es)
      expect(c.textContent).toContain(r.description.es)
    }
    expect(card('noticias-diarias')!.textContent).toContain('Todos los días a las 08:00')
    expect(card('archivos-nuevos')!.textContent).toContain('archivo nuevo')
    expect(m!.q('h3#recipes-group-everyone')).not.toBeNull()
  })

  it('sin Overdrive en la plataforma, no ofrece las recetas que lo necesitan', () => {
    caps.tasks = false
    open()
    expect(card('descargas-resumen')).toBeNull()
    expect(card('noticias-diarias')).not.toBeNull()
    expect(card('repo-estado')).not.toBeNull()
  })

  it('el detalle dice qué hace, qué NO hace, el acceso, qué sale del equipo y que no se crea nada solo', () => {
    open()
    click(card('descargas-ordenar'))
    const d = dialog().textContent!
    expect(d).toContain('Ordenar Descargas por tipo (solo propone)')
    for (const h of ['Qué hace', 'Qué no hace', 'Acceso que necesita', 'Qué sale de tu equipo', 'Cuándo se ejecuta', 'Antes de empezar'])
      expect(d).toContain(h)
    expect(d).toContain('No mueve, renombra, copia ni borra nada: solo propone')
    expect(d).toContain('Solo la carpeta que elijas')
    expect(d).toContain('Cada viernes a las 17:00')
    expect(d).toContain('Nada se ejecuta solo sin que tú crees la rutina')
    expect(d).toContain('No se crea nada hasta que pulses')
    expect(m!.q('[data-testid="recipe-detail"]')).not.toBeNull()
  })

  it('usar una receta con carpeta abre el formulario prellenado y editable, con la carpeta vacía, y NO guarda nada', () => {
    open()
    click(card('descargas-ordenar'))
    click(useButton())
    const s = useRoutines.getState()
    expect(s.editing).toMatchObject({
      name: 'Propuesta para ordenar Descargas',
      mode: 'tasks',
      folder: null,
      enabled: true,
      onAsk: 'reject'
    })
    expect(s.editing!.prompt).toContain('SOLO PROPONES')
    expect(s.editing!.schedule).toEqual({ kind: 'weekly', day: 5, time: '17:00' })
    expect(s.editingHint).toContain('elige la carpeta')
    expect(closed).toBe(1)
    // Ninguna llamada al planificador: solo el formulario.
    expect(bridge.cw).not.toHaveBeenCalled()
  })

  it('las preguntas obligatorias bloquean el paso, avisan, y al responder rellenan la instrucción', () => {
    open('seguir-tema')
    expect(m!.q('input')!.getAttribute('aria-invalid')).toBeNull()
    click(useButton())
    expect(useRoutines.getState().editing).toBeNull()
    expect(closed).toBe(0)
    expect(dialog().textContent).toContain('Falta responder: ¿Qué tema quieres seguir?')
    expect(m!.q('input')!.getAttribute('aria-invalid')).toBe('true')
    typeInto(m!.q<HTMLInputElement>('input'), 'abejas de Chile')
    click(useButton())
    const e = useRoutines.getState().editing!
    expect(e.prompt).toContain('abejas de Chile')
    expect(e.prompt).not.toContain('{{')
    expect(e).toMatchObject({ mode: 'chat', folder: null })
    expect(useRoutines.getState().editingHint).toBe('Receta «Seguir un tema»: revisa todo antes de crear la rutina.')
    expect(closed).toBe(1)
  })

  it('cada pregunta de texto tiene su etiqueta, las opcionales llegan con valor y Enter equivale a «Usar»', () => {
    open('gastos-semana')
    const inputs = m!.qa<HTMLInputElement>('input')
    expect(inputs).toHaveLength(2)
    for (const i of inputs) expect(m!.q(`label[for="${i.id}"]`)?.textContent, i.id).toBeTruthy()
    expect(dialog().textContent).toContain('(opcional)')
    expect(inputs[0].value).toBe('gastos.csv')
    typeInto(inputs[0], 'abril.csv')
    pressKey(inputs[0], 'Enter')
    expect(useRoutines.getState().editing!.prompt).toContain('«abril.csv»')
  })

  it('Escape vuelve del detalle a la lista y luego cierra', () => {
    open()
    click(card('repo-estado'))
    expect(m!.q('[data-testid="recipe-detail"]')).not.toBeNull()
    pressKey(document, 'Escape')
    expect(m!.q('[data-testid="recipe-detail"]')).toBeNull()
    expect(card('repo-estado')).not.toBeNull()
    expect(closed).toBe(0)
    pressKey(document, 'Escape')
    expect(closed).toBe(1)
  })

  it('abierto directo en una receta, Escape cierra y no ofrece «volver»', () => {
    open('noticias-diarias')
    expect(dialog().textContent).not.toContain('Volver a las recetas')
    pressKey(document, 'Escape')
    expect(closed).toBe(1)
  })
})
