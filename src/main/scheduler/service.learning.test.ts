/**
 * Fix de seguridad (2026-10-07): el resumen de una rutina (`record.summary`) NUNCA debe llevar el bloque
 * crudo de propuesta (```lazunox-memoria```/```lazunox-skill```) — llega a notificaciones nativas, al
 * historial en Markdown y al evento `routines:run`, que SÍ alcanza al celular. Además, en modo Tareas con
 * el aprendizaje encendido, lo propuesto debe quedar en la cola de pendientes para revisar después.
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
import { listPending } from '../tasks/learned-pending'
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
  state.dir = mkdtempSync(join(tmpdir(), 'sched-learn-userdata-'))
  projectDir = mkdtempSync(join(tmpdir(), 'sched-learn-proyecto-'))
  vi.clearAllMocks()
  fakeClient.session.create.mockResolvedValue({ data: { id: 'sess-1' } })
  fakeClient.session.status.mockResolvedValue({ data: { 'sess-1': { type: 'idle' } } })
  fakeClient.session.children.mockResolvedValue({ data: [] })
  fakeClient.permission.list.mockResolvedValue({ data: [] })
})
afterEach(() => {
  rmSync(state.dir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

describe('perform(): resumen de rutina sin bloques crudos de propuesta', () => {
  it('con aprendizaje encendido: el resumen no lleva el bloque, y la propuesta queda pendiente de revisar', async () => {
    const text = [
      'Listo, ajusté el archivo.',
      '```lazunox-memoria',
      JSON.stringify([{ alcance: 'usuario', tipo: 'preferencia', texto: 'prefiere tablas en los resumenes' }]),
      '```'
    ].join('\n')
    mockReply(text)
    const svc = makeService(true)
    const summary = await perform(svc, routine(), record(), new AbortController().signal)

    expect(summary).not.toContain('lazunox-memoria')
    expect(summary).not.toContain('prefiere tablas')
    expect(summary).toContain('Listo, ajusté el archivo.')

    const pending = listPending()
    expect(pending.items).toHaveLength(1)
    expect(pending.items[0].routineId).toBe('r1')
    expect(pending.items[0].proposals?.[0].texto).toBe('prefiere tablas en los resumenes')
  }, 10_000)

  it('con aprendizaje apagado: el resumen tampoco lleva el bloque, y NO se encola nada', async () => {
    const text = ['Hecho.', '```lazunox-memoria', JSON.stringify([{ alcance: 'usuario', tipo: 'preferencia', texto: 'algo' }]), '```'].join(
      '\n'
    )
    mockReply(text)
    const svc = makeService(false)
    const summary = await perform(svc, routine(), record(), new AbortController().signal)

    expect(summary).not.toContain('lazunox-memoria')
    expect(summary).toContain('Hecho.')
    expect(listPending().items).toEqual([])
  }, 10_000)

  it('con una skill propuesta: el resumen no la lleva cruda, y queda pendiente', async () => {
    const text = [
      'Creé la skill.',
      '```lazunox-skill',
      JSON.stringify({ name: 'mi-skill', description: 'hace algo', body: 'pasos...' }),
      '```'
    ].join('\n')
    mockReply(text)
    const svc = makeService(true)
    const summary = await perform(svc, routine(), record(), new AbortController().signal)

    expect(summary).not.toContain('lazunox-skill')
    expect(summary).toContain('Creé la skill.')
    expect(listPending().items[0].skill?.name).toBe('mi-skill')
  }, 10_000)
})
