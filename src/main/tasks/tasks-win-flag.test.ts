import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { capsFor } from '@shared/platform-caps'
import { resolveTasksWin, type TasksWinDeps } from './tasks-win-flag'

const base: TasksWinDeps = { platform: 'win32', build: true, policy: null }

describe('TASKS_WIN_BUILD', () => {
  it('es el literal booleano true en el repositorio (sin beta ni consentimiento, decisión del dueño 2026-10-07)', () => {
    expect(TASKS_WIN_BUILD).toBe(true)
    const src = readFileSync(join(__dirname, '../../shared/feature-flags.ts'), 'utf8')
    expect(src).toMatch(/^export const TASKS_WIN_BUILD = true$/m)
  })
  it('con la constante real (encendida) Tareas queda activa de entrada en win32, y la política la cierra', () => {
    const real = { ...base, build: undefined }
    expect(resolveTasksWin(real)).toBe(true)
    expect(resolveTasksWin({ ...real, policy: { disableWslTasks: true } })).toBe(false)
  })
})

describe('resolveTasksWin (build encendido inyectado)', () => {
  it('encendida por defecto en win32, sin pedir nada', () => {
    expect(resolveTasksWin(base)).toBe(true)
  })
  it('solo en win32', () => {
    for (const platform of ['darwin', 'linux', 'remote']) expect(resolveTasksWin({ ...base, platform })).toBe(false)
  })
  it('la política disableWslTasks gana sobre todo', () => {
    expect(resolveTasksWin({ ...base, policy: { disableWslTasks: true } })).toBe(false)
    expect(resolveTasksWin({ ...base, policy: { disableWslTasks: false } })).toBe(true)
    expect(resolveTasksWin({ ...base, policy: {} })).toBe(true)
  })
  it('la puerta de compilación apagada gana sobre todo', () => {
    expect(resolveTasksWin({ ...base, build: false })).toBe(false)
  })
  it('alimenta capsFor: solo win32 + bandera efectiva enciende Tareas', () => {
    expect(capsFor('win32', { tasksWin: resolveTasksWin(base) }).tasks).toBe(true)
    expect(capsFor('win32', { tasksWin: resolveTasksWin({ ...base, build: false }) }).tasks).toBe(false)
  })
})
