import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { capsFor } from '@shared/platform-caps'
import { resolveTasksWin, tasksWinDevEnv, type TasksWinDeps } from './tasks-win-flag'

const base: TasksWinDeps = { platform: 'win32', build: true, optIn: false, env: {}, isPackaged: true, policy: null }

describe('TASKS_WIN_BUILD', () => {
  it('es el literal booleano false en el repositorio', () => {
    expect(TASKS_WIN_BUILD).toBe(false)
    const src = readFileSync(join(__dirname, '../../shared/feature-flags.ts'), 'utf8')
    expect(src).toMatch(/^export const TASKS_WIN_BUILD = false$/m)
  })
  it('con la constante real (apagada) nada la enciende: ni opt-in, ni entorno, ni sin política', () => {
    const real = { ...base, build: undefined, optIn: true, env: { LAZUNOX_TASKS_WIN: '1' }, isPackaged: false }
    expect(resolveTasksWin(real)).toBe(false)
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
