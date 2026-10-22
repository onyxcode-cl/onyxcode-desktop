/**
 * Limpieza de restos de ejecuciones anteriores: se mata solo lo que sigue siendo EL MISMO proceso (misma marca de inicio);
 * un PID reutilizado por otro proceso, o con dueño aún vivo, no se toca. Procesos reales (macOS y Linux).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { BackgroundShellManager } from './manager'
import { createNodeProcessPort } from './process-port'
import { pidAlive, tmpBase, waitFor } from './test-kit'

describe.skipIf(!posixOnly)('limpieza de restos al arrancar', () => {
  const port = createNodeProcessPort()
  let base: string
  let work: string
  let spawned: ChildProcess[]

  const victim = (): ChildProcess => {
    const c = spawn('/bin/sh', ['-c', 'sleep 300'], { detached: true, stdio: 'ignore' })
    spawned.push(c)
    return c
  }
  const writeRegistry = (
    name: string,
    owner: { pid: number; identity: string | null },
    jobs: { id: string; pid: number; identity: string | null }[]
  ): string => {
    const dir = join(work, name)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(join(dir, 'registry.json'), JSON.stringify({ version: 1, owner, jobs }))
    return dir
  }

  beforeEach(() => {
    base = tmpBase()
    work = join(base, 'work')
    mkdirSync(work, { recursive: true, mode: 0o700 })
    spawned = []
  })
  afterEach(() => {
    for (const c of spawned) {
      try {
        if (c.pid) process.kill(-c.pid, 'SIGKILL')
      } catch {
        /* ya muerto */
      }
    }
    rmSync(base, { recursive: true, force: true })
  })

  it('mata el grupo del trabajo huérfano cuyo dueño murió y borra su carpeta', async () => {
    const v = victim()
    await waitFor(async () => (await port.identity(v.pid!)) !== null)
    const identity = await port.identity(v.pid!)
    const dir = writeRegistry('o-dead', { pid: 2147483000, identity: 'Mon Jan  1 00:00:00 1990' }, [{ id: 'bg_1', pid: v.pid!, identity }])
    const m = new BackgroundShellManager({ baseDir: work, graceMs: 300, tickMs: 0 })
    const report = await m.init()
    expect(report.killed).toEqual([v.pid])
    await waitFor(() => !pidAlive(v.pid!))
    expect(report.removedDirs).toEqual([dir])
  })

  it('un PID REUTILIZADO por otro proceso (otra hora de inicio) NO se mata', async () => {
    const v = victim()
    await waitFor(async () => (await port.identity(v.pid!)) !== null)
    writeRegistry('o-dead', { pid: 2147483000, identity: 'x' }, [{ id: 'bg_1', pid: v.pid!, identity: 'Mon Jan  1 00:00:00 1990' }])
    const m = new BackgroundShellManager({ baseDir: work, graceMs: 300, tickMs: 0 })
    const report = await m.init()
    expect(report.killed).toEqual([])
    expect(report.skipped).toEqual([v.pid])
    await new Promise((r) => setTimeout(r, 400))
    expect(pidAlive(v.pid!)).toBe(true)
  })

  it('identidad no verificable (null) tampoco se toca', async () => {
    const v = victim()
    writeRegistry('o-dead', { pid: 2147483000, identity: 'x' }, [{ id: 'bg_1', pid: v.pid!, identity: null }])
    const report = await new BackgroundShellManager({ baseDir: work, graceMs: 300, tickMs: 0 }).init()
    expect(report.killed).toEqual([])
    expect(pidAlive(v.pid!)).toBe(true)
  })

  it('si el dueño sigue vivo (otro manager activo) no se toca nada', async () => {
    const v = victim()
    await waitFor(async () => (await port.identity(v.pid!)) !== null)
    const vid = await port.identity(v.pid!)
    const me = await port.identity(process.pid)
    const dir = writeRegistry('o-live', { pid: process.pid, identity: me }, [{ id: 'bg_1', pid: v.pid!, identity: vid }])
    const report = await new BackgroundShellManager({ baseDir: work, graceMs: 300, tickMs: 0 }).init()
    expect(report).toEqual({ killed: [], skipped: [], removedDirs: [] })
    expect(pidAlive(v.pid!)).toBe(true)
    expect(rmSync(dir, { recursive: true })).toBeUndefined()
  })

  it('registros ilegibles y carpetas ajenas se ignoran', async () => {
    mkdirSync(join(work, 'o-basura'), { recursive: true })
    writeFileSync(join(work, 'o-basura', 'registry.json'), '{no es json')
    mkdirSync(join(work, 'otra-cosa'), { recursive: true })
    const report = await new BackgroundShellManager({ baseDir: work, graceMs: 300, tickMs: 0 }).init()
    expect(report).toEqual({ killed: [], skipped: [], removedDirs: [] })
  })

  it('un manager con trabajos escribe su registro (0600) para que otro pueda limpiarlo', async () => {
    const m = new BackgroundShellManager({ baseDir: work, graceMs: 300, tickMs: 0, deps: { baseEnv: { PATH: process.env.PATH } } })
    const id = await m.start('sleep 300', { cwd: base })
    const dir = join(m.status(id).outputFile, '..')
    await waitFor(() => {
      try {
        return JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')).jobs.length === 1
      } catch {
        return false
      }
    })
    const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'))
    expect(reg.owner.pid).toBe(process.pid)
    expect(reg.jobs[0]).toMatchObject({ id, pid: m.status(id).pid })
    expect(statSync(join(dir, 'registry.json')).mode & 0o777).toBe(0o600)
    await m.shutdown()
  })
})
