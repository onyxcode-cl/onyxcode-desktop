/** Rutinas sin modo Tareas (Windows en la v1): Chat/Code se guardan; modo Tareas se rechaza al guardar y al ejecutar. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getAppPath: () => state.dir, isPackaged: false, getVersion: () => '0' },
  Notification: class {
    static isSupported = (): boolean => false
  },
  powerMonitor: { on: () => undefined, removeListener: () => undefined }
}))

import type { RoutineInput } from '@shared/ipc-tasks'
import { noTasksPort } from './no-tasks-port'
import { SchedulerService } from './service'

const input = (over: Partial<RoutineInput> = {}): RoutineInput =>
  ({
    name: 'Diaria',
    prompt: 'hola',
    mode: 'chat',
    folder: null,
    model: { providerID: 'p', modelID: 'm' },
    schedule: { kind: 'interval', hours: 1 },
    enabled: true,
    ...over
  }) as RoutineInput

const make = (): SchedulerService =>
  new SchedulerService({
    getMainConnection: () => Promise.reject(new Error('sin servidor')),
    chatDirectory: state.dir,
    tasks: noTasksPort,
    tasksSupported: false
  })

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'sched-plat-'))
})
afterEach(() => rmSync(state.dir, { recursive: true, force: true }))

describe('planificador con tasksSupported=false', () => {
  it('guarda rutinas de Chat y de Code', () => {
    const svc = make()
    expect(svc.saveRoutine(input()).mode).toBe('chat')
    expect(svc.saveRoutine(input({ name: 'Code', mode: 'code', folder: state.dir })).mode).toBe('code')
    expect(svc.list()).toHaveLength(2)
  })

  it('rechaza guardar una rutina en modo Tareas con el mensaje de plataforma', () => {
    const svc = make()
    expect(() => svc.saveRoutine(input({ mode: 'tasks', folder: state.dir }))).toThrow(/Tareas|Tasks/)
    expect(svc.list()).toHaveLength(0)
  })

  it('rechaza ejecutar una rutina en modo Tareas ya guardada, sin llamar al puerto de Tareas', async () => {
    const svc = make()
    const perform = (svc as unknown as { perform: (r: unknown, rec: unknown, s: AbortSignal) => Promise<string> }).perform.bind(svc)
    const start = vi.spyOn(noTasksPort, 'start')
    await expect(perform({ mode: 'tasks', folder: state.dir, name: 'x' }, {}, new AbortController().signal)).rejects.toThrow(/Tareas|Tasks/)
    expect(start).not.toHaveBeenCalled()
  })
})
