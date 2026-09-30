/** Planificador: sin `routinesTermsAcknowledged` no ejecuta rutinas por horario; «Ejecutar ahora» sí. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

import type { Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { SchedulerService } from './service'

const HOUR = 3_600_000
const routine = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'r1',
  name: 'Diaria',
  prompt: 'hola',
  mode: 'chat',
  folder: null,
  model: { providerID: 'p', modelID: 'm' },
  schedule: { kind: 'interval', hours: 1 },
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  ...over
})

function make(settings: () => Settings): { svc: SchedulerService; execute: ReturnType<typeof vi.fn> } {
  const svc = new SchedulerService({
    getMainConnection: () => Promise.reject(new Error('sin servidor')),
    chatDirectory: state.dir,
    tasks: {} as never,
    getSettings: settings
  })
  const execute = vi.fn(() => ({ id: 'x' }))
  ;(svc as unknown as { execute: unknown }).execute = execute
  return { svc, execute }
}

const tick = (svc: SchedulerService): Promise<void> => (svc as unknown as { tick: () => Promise<void> }).tick()

describe('planificador y el aviso de términos', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'sched-'))
    writeFileSync(join(state.dir, 'routines.json'), JSON.stringify({ routines: [routine()], history: [] }))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('sin reconocimiento omite las rutinas vencidas y lo registra una sola vez', async () => {
    const { svc, execute } = make(() => ({ ...DEFAULT_SETTINGS, routinesTermsAcknowledged: false }))
    vi.setSystemTime(Date.now() + 5 * HOUR)
    await tick(svc)
    await tick(svc)
    expect(execute).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(String((console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain('términos de OpenCode')
  })

  it('con reconocimiento ejecuta las vencidas', async () => {
    const { svc, execute } = make(() => ({ ...DEFAULT_SETTINGS, routinesTermsAcknowledged: true }))
    vi.setSystemTime(Date.now() + 5 * HOUR)
    await tick(svc)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('el reconocimiento posterior reanuda la ejecución automática, sin borrar ni desactivar nada', async () => {
    let acked = false
    const { svc, execute } = make(() => ({ ...DEFAULT_SETTINGS, routinesTermsAcknowledged: acked }))
    vi.setSystemTime(Date.now() + 5 * HOUR)
    await tick(svc)
    expect(execute).not.toHaveBeenCalled()
    expect(svc.list()).toHaveLength(1)
    expect(svc.list()[0].enabled).toBe(true)
    acked = true
    await tick(svc)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('«Ejecutar ahora» funciona sin reconocimiento', () => {
    const { svc, execute } = make(() => ({ ...DEFAULT_SETTINGS, routinesTermsAcknowledged: false }))
    svc.runNow('r1')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), 'manual')
  })
})
