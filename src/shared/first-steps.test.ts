import { describe, expect, it } from 'vitest'
import {
  EMPTY_FIRST_STEPS,
  FIRST_STEP_IDS,
  firstStepsComplete,
  firstStepsProgress,
  firstStepsVisible,
  markFirstStep,
  parseFirstSteps,
  seedForExistingUser,
  serializeFirstSteps,
  showFirstStepsAgain
} from './first-steps'

describe('primeros pasos (lógica)', () => {
  it('empieza en 0 de 4 y visible', () => {
    expect(firstStepsProgress(EMPTY_FIRST_STEPS)).toEqual({ done: 0, total: 4 })
    expect(firstStepsVisible(EMPTY_FIRST_STEPS)).toBe(true)
  })

  it('marcar un paso suma una vez (idempotente) y avanza el progreso', () => {
    let s = markFirstStep(EMPTY_FIRST_STEPS, 'model')
    s = markFirstStep(s, 'model')
    expect(s.done).toEqual(['model'])
    expect(firstStepsProgress(s).done).toBe(1)
    s = markFirstStep(s, 'message')
    expect(firstStepsProgress(s).done).toBe(2)
  })

  it('completa con los 4 pasos, en cualquier orden', () => {
    const s = [...FIRST_STEP_IDS].reverse().reduce(markFirstStep, EMPTY_FIRST_STEPS)
    expect(firstStepsComplete(s)).toBe(true)
  })

  it('guardar y leer devuelve lo mismo; basura o ids desconocidos se descartan', () => {
    const s = markFirstStep(markFirstStep(EMPTY_FIRST_STEPS, 'attach'), 'settings')
    expect(parseFirstSteps(serializeFirstSteps(s))).toEqual({ ...s })
    expect(parseFirstSteps('{no es json').done).toEqual([])
    expect(parseFirstSteps(null).hidden).toBe(false)
    expect(parseFirstSteps('{"done":["model","x",3,"model"],"hidden":true}')).toMatchObject({ done: ['model'], hidden: true, seeded: true })
  })

  it('ocultar y despedirse la hacen invisible', () => {
    expect(firstStepsVisible({ ...EMPTY_FIRST_STEPS, hidden: true })).toBe(false)
    expect(firstStepsVisible({ ...EMPTY_FIRST_STEPS, finished: true })).toBe(false)
  })

  it('quien ya tenía conversaciones queda oculto; una instalación nueva no', () => {
    expect(seedForExistingUser(EMPTY_FIRST_STEPS, true)).toMatchObject({ hidden: true, seeded: true })
    expect(seedForExistingUser(EMPTY_FIRST_STEPS, false)).toEqual(EMPTY_FIRST_STEPS)
    // ya actuó en esta instalación: tener conversaciones (las suyas de ahora) no la oculta
    const acted = markFirstStep(EMPTY_FIRST_STEPS, 'message')
    expect(seedForExistingUser(acted, true).hidden).toBe(false)
  })

  it('volver a mostrarla: conserva el progreso a medias y reinicia lo completado', () => {
    const half = { ...markFirstStep(EMPTY_FIRST_STEPS, 'model'), hidden: true }
    expect(showFirstStepsAgain(half)).toMatchObject({ hidden: false, done: ['model'] })
    const full = { ...[...FIRST_STEP_IDS].reduce(markFirstStep, EMPTY_FIRST_STEPS), finished: true }
    expect(showFirstStepsAgain(full)).toMatchObject({ hidden: false, finished: false, done: [] })
  })
})
