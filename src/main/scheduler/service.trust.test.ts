/**
 * Confianza obligatoria del motor (lazunox.16): una rutina de modo código usa su carpeta SIN diálogo de confianza (como en la 1.8.12), así que
 * la app la declara al motor justo antes de crear la sesión. El Chat ya viene declarado al arrancar; Tareas declara en su propio servidor.
 */
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

const order = vi.hoisted(() => [] as string[])
const fakeClient = vi.hoisted(() => ({
  session: {
    create: vi.fn(async () => {
      order.push('session.create')
      return { error: 'corta aquí', data: undefined }
    })
  }
}))
vi.mock('@opencode-ai/sdk/v2/client', () => ({ createOpencodeClient: () => fakeClient }))

import type { RoutineRunRecord, ScheduledRoutine } from '@shared/ipc-tasks'
import { DEFAULT_SETTINGS } from '@shared/types'
import { SchedulerService, type RoutineTasksPort } from './service'

let projectDir: string
const routine = (over: Partial<ScheduledRoutine> = {}): ScheduledRoutine =>
  ({
    id: 'r1',
    name: 'Rutina',
    prompt: 'hola',
    mode: 'code',
    folder: projectDir,
    model: { providerID: 'p', modelID: 'm' },
    schedule: { kind: 'interval', hours: 1 },
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...over
  }) as ScheduledRoutine
const record = (): RoutineRunRecord => ({ id: 'run-1', routineId: 'r1', routineName: 'Rutina', trigger: 'manual', status: 'running', startedAt: Date.now() })
const noTasks: RoutineTasksPort = {
  isApproved: () => true,
  canStartFullAccess: () => false,
  start: async (folder) => ({ baseUrl: 'http://x', authorization: 'tok', folder, directory: folder }),
  folderSet: (folder) => ({ primary: folder, linked: [], trusted: [], applied: true }),
  networkAllowOnce: () => undefined,
  network: { hasOnce: () => false, revokeOnce: () => undefined },
  on: () => undefined,
  off: () => undefined
}
const perform = (svc: SchedulerService, r: ScheduledRoutine): Promise<string> =>
  (svc as unknown as { perform: (r: ScheduledRoutine, rec: RoutineRunRecord, s: AbortSignal) => Promise<string> }).perform(
    r,
    record(),
    new AbortController().signal
  )

function make(declareTrust?: (d: string) => Promise<unknown>): SchedulerService {
  return new SchedulerService({
    getMainConnection: async () => {
      order.push('conexion')
      return { baseUrl: 'http://127.0.0.1:1', authorization: 'Basic x' }
    },
    chatDirectory: join(state.dir, 'chat'),
    tasks: noTasks,
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    ...(declareTrust ? { declareTrust } : {})
  })
}

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'sched-trust-ud-'))
  projectDir = mkdtempSync(join(tmpdir(), 'sched-trust-proy-'))
  order.length = 0
})
afterEach(() => {
  rmSync(state.dir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

describe('rutinas: confianza de la carpeta ante el motor', () => {
  it('modo código: declara la carpeta DESPUÉS de conectar y ANTES de crear la sesión', async () => {
    const declared: string[] = []
    const svc = make(async (d) => {
      declared.push(d)
      order.push('declara')
    })
    await perform(svc, routine()).catch(() => undefined)
    expect(declared).toEqual([projectDir])
    expect(order).toEqual(['conexion', 'declara', 'session.create'])
  })

  it('si declarar falla o lanza, la rutina sigue (la sesión se intenta igual)', async () => {
    const svc = make(() => Promise.reject(new Error('motor sin la ruta')))
    await perform(svc, routine()).catch(() => undefined)
    expect(order).toEqual(['conexion', 'session.create'])
  })

  it('modo Chat: no declara nada (la carpeta del Chat se declara al arrancar el motor)', async () => {
    const declared: string[] = []
    const svc = make(async (d) => void declared.push(d))
    await perform(svc, routine({ mode: 'chat', folder: null })).catch(() => undefined)
    expect(declared).toEqual([])
  })

  it('sin la dependencia (pruebas, motor anterior) todo sigue igual', async () => {
    await perform(make(), routine()).catch(() => undefined)
    expect(order).toEqual(['conexion', 'session.create'])
  })
})
