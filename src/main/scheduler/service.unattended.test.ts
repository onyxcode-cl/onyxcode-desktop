/**
 * C1 (revisión final 1.8.19): mientras corre una rutina de Tareas, su carpeta queda «sin nadie mirando»: `equipo` y los conectores
 * «preguntar» se niegan al momento y lo negado queda en el resultado de la rutina. Al terminar, la carpeta deja de estarlo.
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

const fakeClient = vi.hoisted(() => ({
  session: {
    create: vi.fn(async () => ({ data: { id: 'sess-1' } })),
    get: vi.fn(async () => ({ data: null })),
    promptAsync: vi.fn(async () => ({ data: {} })),
    status: vi.fn(async () => ({ data: { 'sess-1': { type: 'idle' } } })),
    messages: vi.fn(async () => ({ data: [] as unknown[] })),
    children: vi.fn(async () => ({ data: [] as unknown[] })),
    abort: vi.fn(async () => ({}))
  },
  permission: {
    list: vi.fn(async () => ({ data: [] as unknown[] })),
    reply: vi.fn(async () => ({}))
  }
}))
vi.mock('@opencode-ai/sdk/v2/client', () => ({ createOpencodeClient: () => fakeClient }))

import type { RoutineRunRecord, ScheduledRoutine } from '@shared/ipc-tasks'
import { DEFAULT_SETTINGS } from '@shared/types'
import { unattendedFor } from '../tasks/unattended'
import { SchedulerService, type RoutineTasksPort } from './service'

let projectDir: string

const routine = (over: Partial<ScheduledRoutine> = {}): ScheduledRoutine =>
  ({
    id: 'r1',
    name: 'Rutina de prueba',
    prompt: 'hola',
    mode: 'tasks',
    folder: projectDir,
    model: { providerID: 'p', modelID: 'm' },
    schedule: { kind: 'interval', hours: 1 },
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    allow: [],
    onAsk: 'reject',
    ...over
  }) as ScheduledRoutine

function makeTasksPort(): RoutineTasksPort {
  return {
    isApproved: () => true,
    canStartFullAccess: () => false,
    start: async (folder) => ({ baseUrl: 'http://x', authorization: 'tok', folder, directory: folder }),
    folderSet: (folder) => ({ primary: folder, linked: [], trusted: [], applied: true }),
    networkAllowOnce: () => undefined,
    network: { hasOnce: () => false, revokeOnce: () => undefined },
    on: () => undefined,
    off: () => undefined
  }
}

function makeService(learningEnabled: boolean): SchedulerService {
  return new SchedulerService({
    getMainConnection: () => Promise.reject(new Error('sin servidor')),
    chatDirectory: state.dir,
    tasks: makeTasksPort(),
    getSettings: () => ({ ...DEFAULT_SETTINGS, learningEnabled })
  })
}

const perform = (svc: SchedulerService, r: ScheduledRoutine, record: RoutineRunRecord, signal: AbortSignal): Promise<string> =>
  (svc as unknown as { perform: (r: ScheduledRoutine, rec: RoutineRunRecord, s: AbortSignal) => Promise<string> }).perform(
    r,
    record,
    signal
  )

const record = (): RoutineRunRecord => ({
  id: 'run-1',
  routineId: 'r1',
  routineName: 'Rutina de prueba',
  trigger: 'manual',
  status: 'running',
  startedAt: Date.now()
})

function mockReply(text: string): void {
  const sentAt = Date.now()
  fakeClient.session.promptAsync.mockImplementationOnce(async () => {
    fakeClient.session.messages.mockResolvedValueOnce({
      data: [
        { info: { id: 'u1', role: 'user', time: { created: sentAt } }, parts: [] },
        {
          info: { id: 'a1', role: 'assistant', parentID: 'u1', time: { completed: Date.now() } },
          parts: [{ type: 'text', text }]
        }
      ]
    })
    return { data: {} }
  })
}

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'sched-unatt-userdata-'))
  projectDir = mkdtempSync(join(tmpdir(), 'sched-unatt-proyecto-'))
  vi.clearAllMocks()
  fakeClient.session.create.mockResolvedValue({ data: { id: 'sess-1' } })
})
afterEach(() => {
  rmSync(state.dir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

describe('rutina sin nadie mirando', () => {
  it('durante la ejecución la carpeta está desatendida y lo negado se anota; después ya no', async () => {
    let during: boolean | null = null
    const sentAt = Date.now()
    fakeClient.session.promptAsync.mockImplementationOnce(async () => {
      const note = unattendedFor(projectDir)
      during = !!note
      note?.({ permission: 'equipo_ejecutar', detail: 'open informe.pdf' })
      fakeClient.session.messages.mockResolvedValueOnce({
        data: [
          { info: { id: 'u1', role: 'user', time: { created: sentAt } }, parts: [] },
          {
            info: { id: 'a1', role: 'assistant', parentID: 'u1', time: { completed: Date.now() } },
            parts: [{ type: 'text', text: 'listo' }]
          }
        ]
      })
      return { data: {} }
    })
    const svc = makeService(false)
    const rec = record()
    expect(unattendedFor(projectDir)).toBeNull()
    await perform(svc, routine(), rec, new AbortController().signal)
    expect(during).toBe(true)
    expect(rec.rejected).toEqual([{ permission: 'equipo_ejecutar', patterns: ['open informe.pdf'] }])
    expect(unattendedFor(projectDir)).toBeNull()
  })
})
