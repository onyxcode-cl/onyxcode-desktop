/**
 * Procesos REALES cortos (macOS y Linux): eco, un sleep que se corta, un nieto que muere con el grupo, SIGKILL tras la gracia,
 * salida enorme recortada, permisos 0700/0600, entorno sin secretos, validaciones y cierre limpio.
 * En Windows se salta: grupos de procesos POSIX (ver la cabecera de process-port.ts).
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { BackgroundShellManager } from './manager'
import type { ShellBgEvent } from './types'
import { pidAlive, tmpBase, waitFor } from './test-kit'

describe.skipIf(!posixOnly)('BackgroundShellManager con procesos reales', () => {
  let base: string
  let events: ShellBgEvent[]
  let mgr: BackgroundShellManager

  const make = (extra: Partial<ConstructorParameters<typeof BackgroundShellManager>[0]> = {}): BackgroundShellManager =>
    new BackgroundShellManager({
      baseDir: join(base, 'work'),
      tickMs: 0,
      graceMs: 300,
      onEvent: (e) => events.push(e),
      deps: { baseEnv: { PATH: process.env.PATH, HOME: process.env.HOME, SECRET_API_KEY: 'no-debe-pasar', ANTHROPIC_API_KEY: 'x' } },
      ...extra
    })
  const done = (id: string): boolean => !['running', 'possibly-stuck'].includes(mgr.status(id).state)
  const exitEvent = (id: string): Extract<ShellBgEvent, { type: 'exit' }> | undefined =>
    events.find((e): e is Extract<ShellBgEvent, { type: 'exit' }> => e.type === 'exit' && e.id === id)

  beforeEach(() => {
    base = tmpBase()
    events = []
    mgr = make()
  })
  afterEach(async () => {
    await mgr.shutdown()
    rmSync(base, { recursive: true, force: true })
  })

  it('eco: termina solo y avisa con código, duración y últimas líneas', async () => {
    const id = await mgr.start('echo hola; echo "dos" >&2; exit 3', { cwd: base })
    await waitFor(() => exitEvent(id) !== undefined)
    const e = exitEvent(id)!
    expect(e).toMatchObject({ state: 'exited', exitCode: 3, signal: null, lastLines: ['hola', 'dos'] })
    expect(e.durationMs).toBeGreaterThanOrEqual(0)
    const r = mgr.read(id)
    expect(r.text).toBe('hola\ndos\n')
    expect(r.nextByte).toBe(9)
    expect(mgr.read(id, { fromByte: r.nextByte }).text).toBe('')
    expect(mgr.read(id, { fromByte: 5 }).text).toBe('dos\n')
  })

  it('un sleep largo se corta con stop (SIGTERM) y queda stopped', async () => {
    const id = await mgr.start('sleep 300', { cwd: base })
    const pid = mgr.status(id).pid!
    expect(pidAlive(pid)).toBe(true)
    const s = await mgr.stop(id)
    expect(s.state).toBe('stopped')
    expect(s.signal).toBe('SIGTERM')
    await waitFor(() => !pidAlive(pid))
    expect((await mgr.stop(id)).state).toBe('stopped') // idempotente
  })

  it('el nieto muere con el grupo', async () => {
    const id = await mgr.start('sleep 300 & echo $!; wait', { cwd: base })
    await waitFor(() => mgr.read(id).text.includes('\n'))
    const grandchild = Number(mgr.read(id).text.trim())
    expect(pidAlive(grandchild)).toBe(true)
    await mgr.stop(id)
    await waitFor(() => !pidAlive(grandchild))
  })

  it('si el líder termina solo, los nietos que dejó atrás también se terminan', async () => {
    const id = await mgr.start('sleep 300 & echo $!', { cwd: base })
    await waitFor(() => done(id))
    const grandchild = Number(mgr.read(id).text.trim())
    await waitFor(() => !pidAlive(grandchild))
  })

  it('un proceso que ignora SIGTERM cae con SIGKILL tras la gracia', async () => {
    const id = await mgr.start("trap '' TERM; while :; do sleep 1; done", { cwd: base })
    await new Promise((r) => setTimeout(r, 150))
    const s = await mgr.stop(id)
    expect(s.state).toBe('stopped')
    expect(s.signal).toBe('SIGKILL')
    await waitFor(() => !pidAlive(s.pid!))
  })

  it('salida enorme: recorte cabeza/cola, offsets estables y archivos 0600/0700', async () => {
    const small = make({ headMaxBytes: 64 * 1024, tailMaxBytes: 64 * 1024 })
    const script = "for (let i=0;i<30000;i++) process.stdout.write('line '+i+' '+'y'.repeat(90)+'\\n')"
    const id = await small.start(`${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`, { cwd: base })
    await waitFor(() => !['running', 'possibly-stuck'].includes(small.status(id).state), 4000)
    const st = small.status(id)
    expect(st.state).toBe('exited')
    expect(st.totalBytes).toBeGreaterThan(2_900_000)
    expect(st.omittedBytes).toBeGreaterThan(2_700_000)
    // cabeza
    const head = small.read(id, { fromByte: 0, maxBytes: 65536 })
    expect(head.text.startsWith('line 0 ')).toBe(true)
    expect(head.gapSkipped).toBe(false)
    expect(head.nextByte).toBe(65536)
    // cruza el hueco
    const next = small.read(id, { fromByte: head.nextByte, maxBytes: 65536 })
    expect(next.gapSkipped).toBe(true)
    expect(next.text).toMatch(/^\[\.\.\. \d+ bytes omitted/)
    expect(next.nextByte).toBeGreaterThan(st.totalBytes - 70000)
    // cola
    const tail = small.read(id, { fromByte: st.totalBytes - 2000, maxBytes: 4000 })
    expect(tail.text).toContain('line 29999 ')
    expect(tail.nextByte).toBe(st.totalBytes)
    expect(st.lastLines.at(-1)).toMatch(/^line 29999 /)
    // archivos y permisos
    expect(statSync(st.outputFile).size).toBe(65536)
    expect(statSync(st.outputFile).mode & 0o777).toBe(0o600)
    expect(statSync(join(st.outputFile, '..')).mode & 0o777).toBe(0o700)
    expect(readFileSync(st.outputFile.replace(/\.log$/, '.tail.log')).length).toBeLessThanOrEqual(64 * 1024)
    await small.shutdown()
  })

  it('el entorno hereda una lista blanca: sin claves de API; extras solo permitidos', async () => {
    const id = await mgr.start('env', { cwd: base, env: { CI: '1' } })
    await waitFor(() => done(id))
    const out = mgr.read(id).text
    expect(out).toContain('CI=1')
    expect(out).toContain('PATH=')
    expect(out).not.toMatch(/SECRET_API_KEY|ANTHROPIC_API_KEY|no-debe-pasar/)
    await expect(mgr.start('env', { cwd: base, env: { OPENAI_API_KEY: 'sk-x' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(mgr.start('env', { cwd: base, env: { CI: 5 as unknown as string } })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('valida comando y cwd', async () => {
    await expect(mgr.start('', { cwd: base })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(mgr.start('x'.repeat(9000), { cwd: base })).rejects.toThrow(/too long/)
    await expect(mgr.start('echo \0', { cwd: base })).rejects.toThrow(/NUL/)
    await expect(mgr.start('echo', { cwd: 'relativo' })).rejects.toThrow(/absolute/)
    await expect(mgr.start('echo', { cwd: join(base, 'no-existe') })).rejects.toThrow(/does not exist/)
    await expect(mgr.start('echo', { cwd: join(base, 'work') + '/../' + 'work' + '/zzz' })).rejects.toThrow()
    await expect(mgr.start('echo', { cwd: base, watchPaths: ['rel'] })).rejects.toThrow(/absolute/)
    expect(() => mgr.status('bg_nope')).toThrow(/Unknown job/)
    expect(() => mgr.read('bg_nope')).toThrow(/Unknown job/)
  })

  it('tope de concurrencia con procesos reales: el tercero se rechaza y los dos vivos siguen vivos', async () => {
    const two = make({ maxConcurrent: 2 })
    const a = await two.start('sleep 300', { cwd: base })
    const b = await two.start('sleep 300', { cwd: base })
    await expect(two.start('sleep 300', { cwd: base })).rejects.toMatchObject({ code: 'TOO_MANY_JOBS' })
    expect(pidAlive(two.status(a).pid!)).toBe(true)
    expect(pidAlive(two.status(b).pid!)).toBe(true)
    await two.shutdown()
  })

  it('shutdown deja el sistema limpio: sin procesos, sin carpeta, sin avisos perdidos', async () => {
    const a = await mgr.start('sleep 300 & wait', { cwd: base })
    const b = await mgr.start('sleep 300', { cwd: base })
    const pids = [mgr.status(a).pid!, mgr.status(b).pid!]
    const dir = join(mgr.status(a).outputFile, '..')
    expect(existsSync(dir)).toBe(true)
    await mgr.shutdown()
    for (const p of pids) expect(pidAlive(p)).toBe(false)
    expect(existsSync(dir)).toBe(false)
    expect(events.filter((e) => e.type === 'exit')).toHaveLength(2)
  })
})
