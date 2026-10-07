import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { capsFor } from '@shared/platform-caps'
import { resolveTasksWin, tasksWinDevEnv, type TasksWinDeps } from './tasks-win-flag'

const base: TasksWinDeps = { platform: 'win32', build: true, optIn: false, env: {}, isPackaged: true, policy: null }

describe('TASKS_WIN_BUILD', () => {
  it('es el literal booleano true en el repositorio (beta opcional, decisión del dueño 2026-10-07)', () => {
    expect(TASKS_WIN_BUILD).toBe(true)
    const src = readFileSync(join(__dirname, '../../shared/feature-flags.ts'), 'utf8')
    expect(src).toMatch(/^export const TASKS_WIN_BUILD = true$/m)
  })
  it('con la constante real (encendida) sigue apagada sin consentimiento beta: ni entorno de desarrollo empaquetado, ni sin política', () => {
    const real = { ...base, build: undefined, optIn: false, env: {}, isPackaged: true }
    expect(resolveTasksWin(real)).toBe(false)
    expect(resolveTasksWin({ ...real, env: { LAZUNOX_TASKS_WIN: '1' } })).toBe(false) // empaquetada ignora la variable
  })
  it('con la constante real (encendida) el consentimiento beta la enciende, y la política la cierra', () => {
    const real = { ...base, build: undefined, optIn: true, isPackaged: true }
    expect(resolveTasksWin(real)).toBe(true)
    expect(resolveTasksWin({ ...real, policy: { disableWslTasks: true } as never })).toBe(false)
  })
})

describe('resolveTasksWin (build encendido inyectado)', () => {
  it('apagada por defecto y sin pedirla', () => {
    expect(resolveTasksWin(base)).toBe(false)
  })
  it('opt-in del usuario la enciende solo en win32', () => {
    expect(resolveTasksWin({ ...base, optIn: true })).toBe(true)
    for (const platform of ['darwin', 'linux', 'remote']) expect(resolveTasksWin({ ...base, platform, optIn: true })).toBe(false)
  })
  it('el opt-in exige booleano estricto', () => {
    for (const optIn of ['true', 1, 'si', null, undefined, {}]) expect(resolveTasksWin({ ...base, optIn })).toBe(false)
  })
  it('LAZUNOX_TASKS_WIN=1 solo cuenta con la app sin empaquetar', () => {
    const env = { LAZUNOX_TASKS_WIN: '1' }
    expect(resolveTasksWin({ ...base, env, isPackaged: false })).toBe(true)
    expect(resolveTasksWin({ ...base, env, isPackaged: true })).toBe(false)
    expect(resolveTasksWin({ ...base, env, isPackaged: undefined })).toBe(false)
    expect(tasksWinDevEnv({ LAZUNOX_TASKS_WIN: 'true' }, false)).toBe(false)
    expect(tasksWinDevEnv({ LAZUNOX_TASKS_WIN: '0' }, false)).toBe(false)
    expect(tasksWinDevEnv({}, false)).toBe(false)
  })
  it('la política disableWslTasks gana sobre opt-in y entorno', () => {
    const on = { ...base, optIn: true, env: { LAZUNOX_TASKS_WIN: '1' }, isPackaged: false }
    expect(resolveTasksWin({ ...on, policy: { disableWslTasks: true } })).toBe(false)
    expect(resolveTasksWin({ ...on, policy: { disableWslTasks: false } })).toBe(true)
    expect(resolveTasksWin({ ...on, policy: {} })).toBe(true)
  })
  it('la puerta de compilación apagada gana sobre todo', () => {
    expect(resolveTasksWin({ ...base, build: false, optIn: true, env: { LAZUNOX_TASKS_WIN: '1' }, isPackaged: false })).toBe(false)
  })
  it('alimenta capsFor: solo win32 + bandera efectiva enciende Tareas', () => {
    const tasksWin = resolveTasksWin({ ...base, optIn: true })
    expect(capsFor('win32', { tasksWin }).tasks).toBe(true)
    expect(capsFor('win32', { tasksWin: resolveTasksWin(base) }).tasks).toBe(false)
  })
})

describe('optIn = consentimiento beta de main (no el ajuste del renderer)', () => {
  it('el ajuste legado settings.tasksWinBeta no es una entrada de resolveTasksWin: solo cuenta el booleano que main pasa', () => {
    // `index.ts` pasa `readTasksWinBetaConsent(...)`; aunque el renderer guarde `tasksWinBeta: true`, ese valor no llega aquí.
    expect(resolveTasksWin({ ...base, optIn: false, tasksWinBeta: true } as TasksWinDeps)).toBe(false)
    expect(resolveTasksWin({ ...base, optIn: true })).toBe(true)
  })
})
