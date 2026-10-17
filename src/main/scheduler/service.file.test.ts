/** Rutinas: disparador por archivo (ciclo de vida de vigilantes, validación de carpeta), ejecuciones perdidas y bandeja. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

import type { RoutineInput, RoutineFileSchedule } from '@shared/ipc-tasks'
import { DEFAULT_SETTINGS } from '@shared/types'
import { SchedulerService, MISSED_GRACE_MS } from './service'
import { FileWatchManager, type FsLike, type WatchHandle } from './file-watch-manager'
import { missedRuns } from './schedule'

const HOUR = 3_600_000

/** Sistema de archivos falso: cuenta vigilantes abiertos y cerrados. */
function fakeFs(): FsLike & { open: number; closed: number; emit: (name: string) => void; fail: () => void } {
  const listeners: Array<{ ev: (n: string | null) => void; err: (e: Error) => void; alive: boolean }> = []
  const f = {
    open: 0,
    closed: 0,
    emit: (name: string) => listeners.filter((l) => l.alive).forEach((l) => l.ev(name)),
    fail: () => listeners.filter((l) => l.alive).forEach((l) => l.err(new Error('EMFILE'))),
    watch(_dir: string, ev: (n: string | null) => void, err: (e: Error) => void): WatchHandle {
      const l = { ev, err, alive: true }
      listeners.push(l)
      f.open++
      return {
        close: () => {
          if (l.alive) f.closed++
          l.alive = false
        }
      }
    },
    realpath: (p: string) => p,
    lstat: () => null,
    list: () => [],
    canOpen: () => true
  }
  return f
}

const base = (over: Partial<RoutineInput> = {}): RoutineInput => ({
  name: 'Archivos',
  prompt: 'Resume {{archivo}}',
  mode: 'chat',
  folder: null,
  model: { providerID: 'p', modelID: 'm' },
  schedule: { kind: 'file', folder: state.dir, patterns: ['*.pdf'], on: 'create', settleSec: 3, maxPerHour: 4 },
  enabled: true,
  ...over
})

function make(extra: Partial<ConstructorParameters<typeof SchedulerService>[0]> = {}, fs = fakeFs()) {
  const svc = new SchedulerService({
    getMainConnection: () => Promise.reject(new Error('sin servidor')),
    chatDirectory: state.dir,
    tasks: {} as never,
    getSettings: () => ({ ...DEFAULT_SETTINGS, routinesTermsAcknowledged: true }),
    watchFs: fs,
    userDataDir: join(state.dir, 'userData'),
    ...extra
  })
  return { svc, fs }
}

describe('disparador por archivo: carpeta y ciclo de vida', () => {
  let watched = ''
  beforeEach(() => {
    state.dir = realpathSync(mkdtempSync(join(tmpdir(), 'sched-file-')))
    watched = join(state.dir, 'entrada')
    mkdirSync(watched)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })
  const sched = (over: Partial<RoutineFileSchedule> = {}): RoutineFileSchedule => ({
    kind: 'file',
    folder: watched,
    patterns: ['*.pdf'],
    on: 'create',
    settleSec: 3,
    maxPerHour: 4,
    ...over
  })

  it('guarda la rutina y normaliza los patrones', () => {
    const { svc } = make()
    const r = svc.saveRoutine(base({ schedule: sched({ patterns: [' *.pdf ', '', '*.pdf', '*.csv'] }) }))
    expect(r.schedule).toMatchObject({ kind: 'file', patterns: ['*.pdf', '*.csv'] })
    expect(r.nextRun).toBeNull()
  })

  it('rechaza carpetas inválidas: inexistente, la personal, relativa, de la app, y fuera de la carpeta de la rutina', () => {
    const { svc } = make()
    expect(() => svc.saveRoutine(base({ schedule: sched({ folder: join(state.dir, 'nada') }) }))).toThrow()
    expect(() => svc.saveRoutine(base({ schedule: sched({ folder: 'relativa' }) }))).toThrow()
    expect(() => svc.saveRoutine(base({ schedule: sched({ folder: join(state.dir, 'userData') }) }))).toThrow()
    mkdirSync(join(state.dir, 'userData'), { recursive: true })
    expect(() => svc.saveRoutine(base({ schedule: sched({ folder: join(state.dir, 'userData') }) }))).toThrow()
    // modo code: la carpeta vigilada debe estar dentro de la de la rutina
    const otra = join(state.dir, 'otra')
    mkdirSync(otra)
    expect(() => svc.saveRoutine(base({ mode: 'code', folder: otra, schedule: sched() }))).toThrow()
    expect(() => svc.saveRoutine(base({ mode: 'code', folder: state.dir, schedule: sched() }))).not.toThrow()
  })

  it('valida los límites (espera, tope, patrones con carpetas)', () => {
    const { svc } = make()
    expect(() => svc.saveRoutine(base({ schedule: sched({ settleSec: 0 }) }))).toThrow()
    expect(() => svc.saveRoutine(base({ schedule: sched({ maxPerHour: 999 }) }))).toThrow()
    expect(() => svc.saveRoutine(base({ schedule: sched({ patterns: ['a/b.pdf'] }) }))).toThrow()
  })

  it('un vigilante por rutina activa; pausar, borrar o detener lo cierra sin fugas', () => {
    const { svc, fs } = make()
    const r = svc.saveRoutine(base())
    expect(svc.watcherCount()).toBe(0) // el planificador aún no arrancó
    svc.start()
    expect(svc.watcherCount()).toBe(1)
    expect(fs.open).toBe(1)
    svc.toggle(r.id, false)
    expect(svc.watcherCount()).toBe(0)
    expect(fs.closed).toBe(1)
    svc.toggle(r.id, true)
    expect(svc.watcherCount()).toBe(1)
    svc.delete(r.id)
    expect(svc.watcherCount()).toBe(0)
    expect(fs.open).toBe(fs.closed)
    const r2 = svc.saveRoutine(base({ name: 'Otra' }))
    expect(r2.id).toBeTruthy()
    expect(svc.watcherCount()).toBe(1)
    svc.stop()
    expect(svc.watcherCount()).toBe(0)
    expect(fs.open).toBe(fs.closed)
  })

  it('cambiar la carpeta reemplaza el vigilante (no deja uno huérfano); guardar igual no lo recrea', () => {
    const { svc, fs } = make()
    const r = svc.saveRoutine(base())
    svc.start()
    svc.saveRoutine({ ...base(), id: r.id }) // sin cambios de disparador
    expect(fs.open).toBe(1)
    const otra = join(state.dir, 'otra')
    mkdirSync(otra)
    svc.saveRoutine({ ...base({ schedule: sched({ folder: otra }) }), id: r.id })
    expect(fs.open).toBe(2)
    expect(fs.closed).toBe(1)
    expect(svc.watcherCount()).toBe(1)
    svc.stop()
  })

  it('sin reconocer el aviso de términos no se vigila nada', () => {
    const { svc, fs } = make({ getSettings: () => ({ ...DEFAULT_SETTINGS, routinesTermsAcknowledged: false }) })
    svc.saveRoutine(base())
    svc.start()
    expect(fs.open).toBe(0)
    svc.stop()
  })

  it('si el vigilante muere queda «perdido» y el siguiente sync lo reintenta', () => {
    const { svc, fs } = make()
    const r = svc.saveRoutine(base())
    svc.start()
    fs.fail()
    expect(svc.watcherCount()).toBe(0)
    expect(svc.list().find((x) => x.id === r.id)?.fileWatch?.state).toBe('lost')
    ;(svc as unknown as { syncWatchers: () => void }).syncWatchers()
    expect(svc.watcherCount()).toBe(1)
    svc.stop()
  })

  it('un evento que se estabiliza ejecuta la rutina UNA vez, con el nombre como dato', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
    const fs = fakeFs()
    fs.lstat = () => ({ size: 5, mtimeMs: 10, isFile: true, isSymlink: false })
    const { svc } = make({}, fs)
    const exec = vi.fn(() => ({ id: 'x' }))
    ;(svc as unknown as { execute: unknown }).execute = exec
    svc.saveRoutine(base())
    svc.start()
    fs.emit('informe.pdf')
    fs.emit('informe.pdf')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ name: 'Archivos' }), 'file', {
      files: ['informe.pdf'],
      watchFolder: state.dir
    })
    svc.stop()
    vi.useRealTimers()
  })
})

describe('ejecuciones perdidas y bandeja', () => {
  beforeEach(() => {
    state.dir = realpathSync(mkdtempSync(join(tmpdir(), 'sched-miss-')))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })
  const seed = (over: Record<string, unknown> = {}): void =>
    writeFileSync(
      join(state.dir, 'routines.json'),
      JSON.stringify({
        routines: [
          {
            id: 'r1',
            name: 'Diaria',
            prompt: 'hola',
            mode: 'chat',
            folder: null,
            model: { providerID: 'p', modelID: 'm' },
            schedule: { kind: 'interval', hours: 1 },
            enabled: true,
            createdAt: 0,
            updatedAt: Date.now(),
            ...over
          }
        ],
        history: []
      })
    )
  const tick = (svc: SchedulerService): Promise<void> => (svc as unknown as { tick: () => Promise<void> }).tick()
  const mk = (): { svc: SchedulerService; exec: ReturnType<typeof vi.fn> } => {
    const { svc } = make()
    const exec = vi.fn(() => ({ id: 'x' }))
    ;(svc as unknown as { execute: unknown }).execute = exec
    return { svc, exec }
  }

  it('por defecto pregunta: deja UNA entrada en la bandeja aunque se hayan perdido decenas', async () => {
    seed()
    const { svc, exec } = mk()
    vi.setSystemTime(Date.now() + 40 * HOUR)
    await tick(svc)
    await tick(svc)
    expect(exec).not.toHaveBeenCalled()
    const items = svc.inboxList()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'missed', routineId: 'r1', status: 'pending' })
    expect(items[0].missedCount).toBeGreaterThanOrEqual(30)
    // el calendario siguió: la próxima es futura
    expect(svc.list()[0].nextRun!).toBeGreaterThan(Date.now())
  })

  it('«ejecutar» corre una sola vez como recuperada; «omitir» no corre nada', async () => {
    seed({ onMissed: 'run' })
    const a = mk()
    vi.setSystemTime(Date.now() + 40 * HOUR)
    await tick(a.svc)
    await tick(a.svc)
    expect(a.exec).toHaveBeenCalledTimes(1)
    expect(a.exec).toHaveBeenCalledWith(expect.anything(), 'catchup')
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
    seed({ onMissed: 'skip' })
    const b = mk()
    vi.setSystemTime(Date.now() + 40 * HOUR)
    await tick(b.svc)
    expect(b.exec).not.toHaveBeenCalled()
    expect(b.svc.inboxList()).toHaveLength(0)
  })

  it('un retraso normal (menos que el margen) corre como horario, no como perdida', async () => {
    seed()
    const { svc, exec } = mk()
    vi.setSystemTime(Date.now() + HOUR + MISSED_GRACE_MS - 5_000)
    await tick(svc)
    expect(exec).toHaveBeenCalledWith(expect.anything(), 'schedule')
    expect(svc.inboxList()).toHaveLength(0)
  })

  it('resolver una perdida: «ejecutar» la corre y la cierra; «omitir» la cierra; acciones ajenas se rechazan', async () => {
    seed()
    const { svc, exec } = mk()
    vi.setSystemTime(Date.now() + 5 * HOUR)
    await tick(svc)
    const id = svc.inboxList()[0].id
    expect(() => svc.resolveInbox(id, 'approve')).toThrow()
    svc.resolveInbox(id, 'run')
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), 'catchup')
    expect(svc.inboxList()[0].status).toBe('approved')
    expect(() => svc.resolveInbox('no-existe', 'skip')).toThrow()
  })

  it('missedRuns cuenta y devuelve la más reciente con tope', () => {
    const s = { kind: 'interval', hours: 1 } as const
    expect(missedRuns(s, 0, 30 * 60_000)).toBeNull()
    expect(missedRuns(s, 0, 5 * HOUR + 1)).toEqual({ latest: 5 * HOUR, count: 5 })
    expect(missedRuns(s, 0, 10_000 * HOUR, 20)?.count).toBe(20)
    expect(missedRuns({ kind: 'file', folder: '/x', patterns: [], on: 'create', settleSec: 1, maxPerHour: 1 }, 0, HOUR)).toBeNull()
  })

  it('toda ejecución terminada deja un resultado pendiente; aprobar/descartar lo resuelve; borrar la rutina limpia perdidas', async () => {
    seed()
    const { svc } = make()
    ;(svc as unknown as { perform: unknown }).perform = vi.fn(() => Promise.resolve('Hice cosas'))
    svc.runNow('r1')
    await vi.advanceTimersByTimeAsync(10)
    const items = svc.inboxList()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'result', status: 'pending', runStatus: 'success', summary: 'Hice cosas', trigger: 'manual' })
    svc.resolveInbox(items[0].id, 'dismiss')
    expect(svc.inboxList()[0].status).toBe('dismissed')
    expect(() => svc.resolveInbox(items[0].id, 'run')).not.toThrow() // ya resuelto: no hace nada
  })

  it('las resueltas se acotan; las pendientes se conservan', async () => {
    seed()
    const { svc } = make()
    ;(svc as unknown as { perform: unknown }).perform = vi.fn(() => Promise.resolve('ok'))
    for (let i = 0; i < 60; i++) {
      svc.runNow('r1')
      await vi.advanceTimersByTimeAsync(10)
      svc.resolveInbox(svc.inboxList().find((x) => x.status === 'pending')!.id, 'approve')
    }
    svc.runNow('r1')
    await vi.advanceTimersByTimeAsync(10)
    const all = svc.inboxList()
    expect(all.filter((i) => i.status === 'pending')).toHaveLength(1)
    expect(all.filter((i) => i.status !== 'pending').length).toBeLessThanOrEqual(50)
  })
})

describe('FileWatchManager aislado', () => {
  it('stopAll cierra todo y no quedan vigilantes', () => {
    const fs = fakeFs()
    const m = new FileWatchManager({ fs, allowed: () => true, folderProblem: () => null, isRunning: () => false, onFire: () => undefined })
    const mkR = (id: string) =>
      ({
        id,
        enabled: true,
        mode: 'chat',
        schedule: { kind: 'file', folder: '/x', patterns: [], on: 'create', settleSec: 1, maxPerHour: 1 }
      }) as never
    m.sync([mkR('a'), mkR('b')])
    expect(m.size).toBe(2)
    m.stopAll()
    expect(m.size).toBe(0)
    expect(fs.closed).toBe(2)
  })
  it('si la política cambia y la carpeta deja de ser válida, se cierra', () => {
    const fs = fakeFs()
    let bad: string | null = null
    const m = new FileWatchManager({ fs, allowed: () => true, folderProblem: () => bad, isRunning: () => false, onFire: () => undefined })
    const r = {
      id: 'a',
      enabled: true,
      mode: 'chat',
      schedule: { kind: 'file', folder: '/x', patterns: [], on: 'create', settleSec: 1, maxPerHour: 1 }
    } as never
    m.sync([r])
    expect(m.size).toBe(1)
    bad = 'ya no está autorizada'
    m.sync([r])
    expect(m.size).toBe(0)
    expect(m.state('a').state).toBe('lost')
  })
})
