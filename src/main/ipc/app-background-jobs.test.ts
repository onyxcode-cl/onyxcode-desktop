import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackgroundShellManager } from '../background-shell/manager'
import { ShellBgMcpServer } from '../background-shell/mcp-server'
import { createPanelControl, readPanelJobs, requestPanelStop } from '../background-shell/panel-control'
import { FakePort } from '../background-shell/test-kit'
import { mergeAppBackgroundJobs, stopAppBackgroundJob } from './app-background-jobs'
import { hostBackgroundJobs, startBackground, stopEveryBackground } from '../host-exec/runner'
import { HostExecMcpServer } from '../host-exec/mcp-server'
import { posixOnly } from '../../test/platform'

vi.mock('../opencode/shell-bg-wake', async (original) => {
  const mod = await original<typeof import('../opencode/shell-bg-wake')>()
  return {
    ...mod,
    createSdkWakeEngine: () => ({
      getSession: async (id: string) =>
        ['root', 'child', 'other'].includes(id) ? { id, parentID: id === 'child' ? 'root' : null, directory: '/project' } : null
    })
  }
})
const conn = { baseUrl: 'http://127.0.0.1:1', authorization: 'Basic test' }
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  stopEveryBackground()
})

describe('MCP bgshell → jobs del panel → Parar', () => {
  it('incluye trabajo real del MCP aunque /trabajos esté vacío, con sesión raíz, estado, tiempo y parada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-panel-'))
    dirs.push(dir)
    const events = join(dir, 'events.jsonl')
    const port = new FakePort()
    const manager = new BackgroundShellManager({ baseDir: join(dir, 'work'), deps: { port } })
    const server = new ShellBgMcpServer({ manager, defaultCwd: dir, write: () => {} })
    const control = createPanelControl(events, manager, (id) => server.ownerOf(id))
    try {
      await manager.init()
      await server.handleLine(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'start',
            arguments: { command: 'python -m http.server 8123', lazunox_session: 'child' }
          }
        })
      )
      // El puente tampoco acepta una orden sin dueño o que nombre otra sesión.
      const id = manager.list()[0].id
      control.publish()
      const snapshot = join(
        dir,
        readdirSync(dir).find((name) => /^events\.jsonl\.jobs-[a-f0-9]{24}\.json$/.test(name))!
      )
      writeFileSync(`${snapshot}.stop-${id}.json`, JSON.stringify({ sessionID: 'other' }))
      await control.poll()
      expect(port.sent).toEqual([])
      const unowned = await manager.start('server-without-session', { cwd: dir })
      writeFileSync(`${snapshot}.stop-${unowned}.json`, '{}')
      await control.poll()
      expect(port.sent).toEqual([])
      control.publish()
      const result = await mergeAppBackgroundJobs(conn, 'root', { eventsFile: events }, { available: true, jobs: [] })
      expect(result).toMatchObject({
        available: true,
        jobs: [{ kind: 'shell', title: 'python -m http.server 8123', state: 'en_curso', endedAt: null }]
      })
      if (!result.available) throw new Error('unavailable')
      const job = result.jobs[0]
      expect(job.startedAt).toBeGreaterThan(0)
      expect(await mergeAppBackgroundJobs(conn, 'other', { eventsFile: events }, { available: true, jobs: [] })).toEqual({
        available: true,
        jobs: []
      })
      expect(await stopAppBackgroundJob(conn, 'other', job.id, { eventsFile: events })).toBe(false)
      expect(port.sent).toEqual([])
      const stop = stopAppBackgroundJob(conn, 'root', job.id, { eventsFile: events })
      const poll = setInterval(() => void control.poll(), 10)
      try {
        expect(await stop).toBe(true)
      } finally {
        clearInterval(poll)
      }
      expect(readPanelJobs(events)[0].state).toBe('stopped')
      expect(port.sent).toContainEqual([5000, 'SIGTERM'])
    } finally {
      await manager.shutdown()
    }
  })

  it('conserva el servidor 8133 cuando otro MCP de Código publica vacío y dirige Parar al dueño', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-code-multi-mcp-'))
    dirs.push(dir)
    const events = join(dir, 'events.jsonl')
    const port = new FakePort()
    const otherPort = new FakePort()
    const manager = new BackgroundShellManager({ baseDir: join(dir, 'work'), tickMs: 0, deps: { port, genId: () => 'bg_2e6b315d' } })
    const other = new BackgroundShellManager({
      baseDir: join(dir, 'work'),
      tickMs: 0,
      deps: { port: otherPort, genId: () => 'bg_2e6b315d' }
    })
    const server = new ShellBgMcpServer({ manager, defaultCwd: dir, write: () => {} })
    const owner = createPanelControl(events, manager, (id) => server.ownerOf(id))
    const idle = createPanelControl(events, other, () => 'other')
    try {
      await Promise.all([manager.init(), other.init()])
      // Misma entrada y salida que la sesión real; las rutas y sesiones son de prueba.
      await server.handleLine(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'start',
            arguments: { command: 'python3 -m http.server 8133 --bind 127.0.0.1', cwd: dir, quietMinutes: 60, lazunox_session: 'root' }
          }
        })
      )
      owner.publish()
      idle.publish()
      const result = await mergeAppBackgroundJobs(conn, 'root', { eventsFile: events }, { available: true, jobs: [] })
      expect(result).toMatchObject({
        available: true,
        jobs: [
          {
            id: 'bgshell_bg_2e6b315d',
            title: 'python3 -m http.server 8133 --bind 127.0.0.1',
            state: 'en_curso',
            startedAt: expect.any(Number)
          }
        ]
      })
      // Incluso una colisión de ID entre MCP no entrega ni consume la parada de otra sesión.
      await other.start('another-server', { cwd: dir })
      idle.publish()
      expect(await stopAppBackgroundJob(conn, 'child', 'bgshell_bg_2e6b315d', { eventsFile: events })).toBe(false)
      const stop = stopAppBackgroundJob(conn, 'root', 'bgshell_bg_2e6b315d', { eventsFile: events })
      const poll = setInterval(
        () =>
          void (async () => {
            await idle.poll()
            await owner.poll()
          })(),
        10
      )
      try {
        expect(await stop).toBe(true)
      } finally {
        clearInterval(poll)
      }
      expect(port.sent).toContainEqual([5000, 'SIGTERM'])
      expect(otherPort.sent).toEqual([])
      expect(readPanelJobs(events).find((j) => j.sessionID === 'root')?.state).toBe('stopped')
      expect(readPanelJobs(events).find((j) => j.sessionID === 'other')?.state).toBe('running')
    } finally {
      await Promise.all([manager.shutdown(), other.shutdown()])
    }
  })

  it('no oculta un servidor de otra carpeta al reunir más de 50 trabajos y limpia restos caducados', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-panel-history-'))
    dirs.push(dir)
    const file = join(dir, 'events')
    const job = { id: 'bg_1', sessionID: 'other', command: 'old-server', state: 'exited', startedAt: 1, endedAt: 2, exitCode: 0 }
    const own = `${file}.jobs-${'a'.repeat(24)}.json`
    const stale = `${file}.jobs-${'d'.repeat(24)}.json`
    writeFileSync(own, JSON.stringify({ at: Date.now(), jobs: [{ ...job, sessionID: 'root', state: 'running', endedAt: null }] }))
    for (const token of ['b', 'c']) {
      writeFileSync(
        `${file}.jobs-${token.repeat(24)}.json`,
        JSON.stringify({ at: Date.now(), jobs: Array.from({ length: 32 }, (_, i) => ({ ...job, id: `bg_${token}_${i}` })) })
      )
    }
    // El orden de mtime pone deliberadamente el servidor detrás de los 64 trabajos ajenos.
    utimesSync(own, new Date(), new Date(Date.now() - 1000))
    expect(await mergeAppBackgroundJobs(conn, 'root', { eventsFile: file }, { available: true, jobs: [] })).toMatchObject({
      jobs: [{ id: 'bgshell_bg_1', state: 'en_curso' }]
    })
    writeFileSync(stale, JSON.stringify({ at: Date.now() - 20_000, jobs: [job] }))
    utimesSync(stale, new Date(), new Date(Date.now() - 20_000))
    const manager = new BackgroundShellManager({ baseDir: join(dir, 'work'), tickMs: 0 })
    createPanelControl(file, manager, () => undefined)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(own)).toBe(true)
    await manager.shutdown()
  })

  it('descarta snapshots viejos, malformados y dueños desconocidos; nunca acepta rutas como ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-panel-'))
    dirs.push(dir)
    const file = join(dir, 'events')
    const job = { id: 'bg_1', sessionID: 'missing', command: 'server', state: 'running', startedAt: 1, endedAt: null, exitCode: null }
    writeFileSync(`${file}.jobs-${'a'.repeat(24)}.json`, JSON.stringify({ at: Date.now() - 20_000, jobs: [job] }))
    expect(readPanelJobs(file)).toEqual([])
    writeFileSync(`${file}.jobs-${'a'.repeat(24)}.json`, JSON.stringify({ at: Date.now(), jobs: [job, { ...job, id: '../escape' }] }))
    expect(readPanelJobs(file)).toHaveLength(1)
    expect(await mergeAppBackgroundJobs(conn, 'root', { eventsFile: file }, { available: false })).toEqual({ available: true, jobs: [] })
    expect(await requestPanelStop(file, '../escape', 'root')).toBe(false)
    expect(await requestPanelStop(file, 'bg_1', 'root')).toBe(false)
    // Cada instancia caduca por separado: un snapshot vacío reciente no rejuvenece al muerto.
    writeFileSync(`${file}.jobs-${'a'.repeat(24)}.json`, JSON.stringify({ at: Date.now() - 20_000, jobs: [job] }))
    writeFileSync(`${file}.jobs-${'b'.repeat(24)}.json`, JSON.stringify({ at: Date.now(), jobs: [] }))
    expect(readPanelJobs(file)).toEqual([])
  })
})

describe.skipIf(!posixOnly)('procesos del equipo → jobs del panel → Parar', () => {
  it('combina motor y host, conserva el estado parado y no para trabajos de otra carpeta o sesión', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lzx-host-panel-'))
    dirs.push(folder)
    class DirectHost extends HostExecMcpServer {
      invoke() {
        return this.callTool({ folder }, 'ejecutar', {
          comando: 'sleep 60',
          motivo: 'Probar un servidor local',
          segundo_plano: true,
          lazunox_session: 'child'
        })
      }
    }
    const host = new DirectHost({
      approve: async () => 'allow',
      start: (command, owner, opts) => startBackground(command, owner, { ...opts, graceMs: 50 })
    })
    expect((await host.invoke()).isError).not.toBe(true)
    const own = hostBackgroundJobs(folder)[0].job
    const scoped = { hostFolder: folder }
    expect(await mergeAppBackgroundJobs(conn, 'root', scoped, { available: true, jobs: [] })).toMatchObject({
      jobs: [{ id: own.id, state: 'en_curso' }]
    })
    expect(await stopAppBackgroundJob(conn, 'root', own.id, { hostFolder: '/elsewhere' })).toBe(false)
    expect(await stopAppBackgroundJob(conn, 'other', own.id, scoped)).toBe(false)
    expect(await stopAppBackgroundJob(conn, 'root', own.id, scoped)).toBe(true)
    expect(await mergeAppBackgroundJobs(conn, 'root', scoped, { available: true, jobs: [] })).toMatchObject({
      jobs: [{ id: own.id, state: 'terminado_por_ti', endedAt: expect.any(Number) }]
    })
  })
})
