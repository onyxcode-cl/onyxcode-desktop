/**
 * Supervisión SIN plazo fijo con reloj y procesos falsos: señales de vida, `possibly-stuck` sin matar, reanudación,
 * tope absoluto opcional, tope de concurrencia y cierre. Sin procesos reales.
 */
import { appendFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackgroundShellManager } from './manager'
import { ShellBgError, type ShellBgEvent } from './types'
import { FakePort, FakeTimers, tmpBase } from './test-kit'

describe('BackgroundShellManager: supervisión con reloj falso', () => {
  let base: string
  let t: number
  let port: FakePort
  let timers: FakeTimers
  let events: ShellBgEvent[]
  let mgr: BackgroundShellManager

  const make = (extra: Partial<ConstructorParameters<typeof BackgroundShellManager>[0]> = {}): BackgroundShellManager =>
    new BackgroundShellManager({
      baseDir: join(base, 'work'),
      tickMs: 0,
      graceMs: 100,
      quietMs: 60_000,
      onEvent: (e) => events.push(e),
      deps: { port, now: () => t, schedule: timers.schedule, baseEnv: { PATH: '/usr/bin' } },
      ...extra
    })

  beforeEach(() => {
    base = tmpBase()
    t = 1_000_000
    port = new FakePort()
    timers = new FakeTimers()
    events = []
    mgr = make()
  })
  afterEach(async () => {
    await mgr.shutdown()
    rmSync(base, { recursive: true, force: true })
  })

  it('sin señales pasa a possibly-stuck a los quietMs y NO mata; se repite cada quietMs', async () => {
    const id = await mgr.start('sleep 999', { cwd: base })
    await mgr.tick() // línea base de CPU
    t += 59_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('running')
    t += 2_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('possibly-stuck')
    expect(events.filter((e) => e.type === 'possibly-stuck')).toHaveLength(1)
    t += 30_000
    await mgr.tick()
    expect(events.filter((e) => e.type === 'possibly-stuck')).toHaveLength(1) // aún no toca repetir
    t += 31_000
    await mgr.tick()
    const stuck = events.filter((e) => e.type === 'possibly-stuck')
    expect(stuck).toHaveLength(2)
    expect(stuck[1]).toMatchObject({ repeat: 2, quietMs: 60_000 })
    expect(port.sent).toEqual([]) // jamás se envió una señal
    expect(port.alive.has(port.children[0].pid)).toBe(true)
  })

  it('salida nueva devuelve a running y emite resumed', async () => {
    const id = await mgr.start('x', { cwd: base })
    await mgr.tick()
    t += 61_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('possibly-stuck')
    port.children[0].emit('sigo vivo\n')
    expect(mgr.status(id).state).toBe('running')
    expect(events.at(-1)).toMatchObject({ type: 'resumed', id })
    t += 30_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('running')
  })

  it('la CPU del árbol cuenta como señal de vida; sin cambio no', async () => {
    const id = await mgr.start('x', { cwd: base })
    await mgr.tick() // baseline 0 s
    t += 50_000
    port.cpu = { cpuSeconds: 2.5, pids: [1] }
    await mgr.tick() // sube la CPU: señal en t
    t += 50_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('running') // 50 s desde la señal < 60 s
    t += 20_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('possibly-stuck') // 70 s sin cambios
  })

  it('un cambio en los hijos del árbol (nuevo proceso) también es señal', async () => {
    const id = await mgr.start('x', { cwd: base })
    await mgr.tick()
    t += 50_000
    port.cpu = { cpuSeconds: 0, pids: [1, 77] }
    await mgr.tick()
    t += 50_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('running')
  })

  it('un archivo observado que crece es señal de vida', async () => {
    const f = join(base, 'out.txt')
    writeFileSync(f, 'a')
    const id = await mgr.start('x', { cwd: base, watchPaths: [f] })
    await mgr.tick()
    t += 50_000
    appendFileSync(f, 'bbbb')
    await mgr.tick()
    t += 50_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('running')
    t += 20_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('possibly-stuck')
  })

  it('si el muestreo de CPU no está disponible (sandbox) se supervisa solo por salida', async () => {
    port.cpu = null
    const id = await mgr.start('x', { cwd: base })
    await mgr.tick()
    t += 61_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('possibly-stuck')
  })

  it('quietMs por trabajo manda sobre el del manager', async () => {
    const id = await mgr.start('x', { cwd: base, quietMs: 5_000 })
    await mgr.tick()
    t += 6_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('possibly-stuck')
    await expect(mgr.start('y', { cwd: base, quietMs: 10 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('el tope absoluto opcional sí corta; sin él nunca', async () => {
    const id = await mgr.start('x', { cwd: base, maxRuntimeMs: 10_000 })
    t += 9_000
    await mgr.tick()
    expect(mgr.status(id).state).toBe('running')
    t += 2_000
    await mgr.tick()
    timers.runAll()
    expect(mgr.status(id).state).toBe('killed-limit')
    expect(port.sent[0][1]).toBe('SIGTERM')
    expect(events.at(-1)).toMatchObject({ type: 'exit', state: 'killed-limit' })
    const id2 = await mgr.start('z', { cwd: base })
    t += 10 * 24 * 3600_000
    await mgr.tick()
    expect(mgr.status(id2).state).toBe('possibly-stuck') // jamás 'killed-limit'
  })

  it('el noveno trabajo se RECHAZA con error claro y no se poda ninguno vivo', async () => {
    const ids: string[] = []
    for (let i = 0; i < 8; i++) ids.push(await mgr.start(`sleep ${i}`, { cwd: base }))
    const err = await mgr.start('noveno', { cwd: base }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ShellBgError)
    expect((err as ShellBgError).code).toBe('TOO_MANY_JOBS')
    expect((err as ShellBgError).message).toMatch(/8\/8/)
    expect(port.sent).toEqual([])
    expect(ids.every((id) => mgr.status(id).state === 'running')).toBe(true)
    expect(port.children).toHaveLength(8)
    // Al terminar uno, cabe otro.
    port.children[0].finish(0)
    timers.runAll()
    await expect(mgr.start('otro', { cwd: base })).resolves.toMatch(/^bg_/)
  })

  it('dos start simultáneos no superan el tope', async () => {
    const small = make({ maxConcurrent: 1 })
    const r = await Promise.allSettled([small.start('a', { cwd: base }), small.start('b', { cwd: base })])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(r.filter((x) => x.status === 'rejected')).toHaveLength(1)
    await small.shutdown()
  })

  it('el aviso de fin trae código, señal, duración y últimas líneas', async () => {
    const id = await mgr.start('build', { cwd: base })
    t += 7_000
    port.children[0].emit('uno\ndos\ntres\n')
    port.alive.delete(port.children[0].pid)
    port.children[0].finish(2)
    const e = events.find((x) => x.type === 'exit')
    expect(e).toMatchObject({ id, state: 'exited', exitCode: 2, signal: null, durationMs: 7_000, lastLines: ['uno', 'dos', 'tres'] })
  })

  it('shutdown termina todos los grupos, escala a SIGKILL y borra la carpeta de salidas', async () => {
    port.ignoreTerm = true
    const a = await mgr.start('a', { cwd: base })
    await mgr.start('b', { cwd: base })
    const dir = mgr.status(a).outputFile.replace(/\/[^/]+$/, '')
    const done = mgr.shutdown()
    timers.runAll()
    // la espera usa temporizadores falsos: se vacían hasta que termine
    for (let i = 0; i < 200 && port.alive.size > 0; i++) {
      await new Promise((r) => setImmediate(r))
      timers.runAll()
    }
    await done
    expect(port.alive.size).toBe(0)
    expect(port.sent.filter(([, s]) => s === 'SIGTERM')).toHaveLength(2)
    expect(port.sent.filter(([, s]) => s === 'SIGKILL')).toHaveLength(2)
    expect(await mgr.start('c', { cwd: base }).catch((e: ShellBgError) => e.code)).toBe('SHUTTING_DOWN')
    const { existsSync } = await import('node:fs')
    expect(existsSync(dir)).toBe(false)
  })
})
