import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventLog } from '@shared/remote/mux'
import { EngineRegistry } from './engine-registry'
import { EngineKnowledge, ScopeProvider } from './engine-scope'
import { trimIpcEvent, trimOcEvent, OC_TOOL_OUTPUT_CAP } from './event-trim'
import { SseHub, type BusSubscriber } from './sse-hub'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

let root: string
let proj: string
let outside: string
let PASS: string
let AUTH: string

function setup(open: ConstructorParameters<typeof SseHub>[0]['open'], opts: { bus?: (s: BusSubscriber) => () => void } = {}) {
  const registry = new EngineRegistry({
    getMain: async () => ({ baseUrl: 'http://127.0.0.1:1', authorization: AUTH, username: 'opencode', chatDirectory: '/x' })
  })
  const scope = new ScopeProvider(async () => ({ allowedDirs: [proj], chatDirs: [], fullAccessDirs: [] }))
  const knowledge = new EngineKnowledge()
  const log = new EventLog()
  const trim = { registry, scope, knowledge }
  const hub = new SseHub({ log, registry, trim, open, subscribeBus: opts.bus, backoffMs: 5, maxBackoffMs: 10 })
  return { registry, scope, knowledge, log, trim, hub }
}

const ge = (type: string, directory: string, properties: unknown = {}): unknown => ({
  directory,
  payload: { id: `e_${type}`, type, properties }
})

async function* feed(events: unknown[], hold = true): AsyncGenerator<unknown> {
  for (const e of events) yield e
  if (hold) await new Promise(() => undefined)
}

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-hub-')))
  proj = join(root, 'proj')
  outside = join(root, 'outside')
  mkdirSync(proj)
  mkdirSync(outside)
  symlinkSync(outside, join(proj, 'link'))
  PASS = randomBytes(18).toString('base64url')
  AUTH = `Basic ${Buffer.from(`opencode:${PASS}`).toString('base64')}`
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('recorte de eventos del motor', () => {
  it('lista blanca de tipos y ámbito por directorio', async () => {
    const { scope, trim } = setup(async () => feed([]))
    await scope.get()
    expect(trimOcEvent(ge('session.idle', proj, { sessionID: 's' }), 'main', trim)?.oc).toBe('session.idle')
    expect(trimOcEvent(ge('pty.created', proj), 'main', trim)).toBeNull() // tipo no permitido
    expect(trimOcEvent(ge('mcp.tools.changed', proj), 'main', trim)).toBeNull()
    expect(trimOcEvent(ge('session.idle', outside), 'main', trim)).toBeNull() // otro proyecto
    expect(trimOcEvent(ge('session.idle', join(proj, 'link')), 'main', trim)).toBeNull() // enlace que escapa
    expect(trimOcEvent({ payload: { type: 'session.idle' } }, 'main', trim)?.p.directory).toBe('global')
    expect(trimOcEvent('basura', 'main', trim)).toBeNull()
  })

  it('una sesión de otro proyecto no sale ni se aprende; una del ámbito sí', async () => {
    const { scope, trim, knowledge } = setup(async () => feed([]))
    await scope.get()
    expect(trimOcEvent(ge('session.updated', proj, { info: { id: 's_out', directory: outside } }), 'main', trim)).toBeNull()
    expect(knowledge.sessionDir('s_out')).toBeUndefined()
    expect(trimOcEvent(ge('session.created', proj, { info: { id: 's_in', directory: proj } }), 'main', trim)).not.toBeNull()
    expect(knowledge.sessionDir('s_in')).toBe(proj)
    trimOcEvent(ge('permission.asked', proj, { id: 'per', permission: 'external_directory' }), 'main', trim)
    expect(knowledge.permissionKind('per')).toBe('external_directory')
  })

  it('recorta salidas de herramientas y tacha credenciales', async () => {
    const { scope, trim, registry } = setup(async () => feed([]))
    await scope.get()
    await registry.resolve('main')
    const big = 'z'.repeat(OC_TOOL_OUTPUT_CAP * 3)
    const ev = trimOcEvent(
      ge('message.part.updated', proj, {
        part: { type: 'tool', state: { status: 'completed', output: big, metadata: { m: big }, extra: PASS } }
      }),
      'main',
      trim
    )
    const s = JSON.stringify(ev)
    expect(s.length).toBeLessThan(OC_TOOL_OUTPUT_CAP + 1000)
    expect(s).not.toContain(PASS)
    expect(ev?.urgent).toBe(false)
    expect(trimOcEvent(ge('permission.asked', proj, { id: 'p' }), 'main', trim)?.urgent).toBe(true)
  })

  it('el servidor de una tarea solo emite eventos de su carpeta', async () => {
    const { scope, trim, registry } = setup(async () => feed([]))
    await scope.get()
    mkdirSync(join(proj, 'a'))
    mkdirSync(join(proj, 'b'))
    const t = registry.rewriteTasksConnection({
      folder: join(proj, 'a'),
      baseUrl: 'http://127.0.0.1:2',
      authorization: AUTH,
      sandboxed: true,
      fullAccess: false,
      computerUse: {} as never
    })
    const eng = t.baseUrl.slice('onyx://engine/'.length)
    expect(trimOcEvent(ge('session.idle', join(proj, 'a', 'x')), eng, trim)).not.toBeNull()
    expect(trimOcEvent(ge('session.idle', join(proj, 'b')), eng, trim)).toBeNull()
    expect(trimOcEvent({ payload: { type: 'session.idle' } }, eng, trim)).toBeNull()
  })

  it('eventos IPC: deny por defecto, opencode:connection reescrito, tasks:server/settings/browser acotados', async () => {
    const { scope, trim } = setup(async () => feed([]))
    await scope.get()
    expect(trimIpcEvent('pty:data', { data: 'x' }, trim)).toBeNull()
    expect(trimIpcEvent('canal:inventado', {}, trim)).toBeNull()
    expect(trimIpcEvent('remote:changed', {}, trim)).toBeNull()
    expect(trimIpcEvent('computer:action', { screenshot: 'x' }, trim)).toBeNull()
    const c = trimIpcEvent(
      'opencode:connection',
      { baseUrl: 'http://127.0.0.1:1', authorization: AUTH, username: 'opencode', chatDirectory: '/c' },
      trim
    ) as {
      baseUrl: string
      authorization: string
    }
    expect(c.baseUrl).toBe('onyx://engine/main')
    expect(c.authorization).toBe('')
    expect(JSON.stringify(c)).not.toContain(PASS)
    expect(trimIpcEvent('tasks:server', { folder: outside, state: 'ready' }, trim)).toBeNull()
    expect(trimIpcEvent('tasks:server', { folder: proj, state: 'ready' }, trim)).not.toBeNull()
    expect(trimIpcEvent('settings:changed', { theme: 'dark', opencodeBin: '/bin/x', recentFolders: [proj, outside] }, trim)).toEqual({
      theme: 'dark',
      recentFolders: [proj]
    })
    expect(trimIpcEvent('browser:approval', { owner: { kind: 'code', directory: outside }, savePath: '/x' }, trim)).toBeNull()
    expect(trimIpcEvent('browser:approval', { owner: { kind: 'code', directory: proj }, savePath: '/x', id: 'a' }, trim)).toEqual({
      owner: { kind: 'code', directory: proj },
      id: 'a'
    })
    expect(trimIpcEvent('opencode:status', { state: 'ready' }, trim)).toEqual({ state: 'ready' })
  })
})

describe('SseHub', () => {
  it('un solo stream de subida por motor, bajo demanda, publicado en el log con seq', async () => {
    const open = vi.fn(async () =>
      feed([ge('session.idle', proj, { n: 1 }), ge('pty.x', proj), ge('session.idle', outside), ge('message.updated', proj, { n: 2 })])
    )
    const { hub, log, scope } = setup(open)
    await scope.get()
    hub.ensure('main') // sin dispositivos: no abre
    expect(open).not.toHaveBeenCalled()
    hub.start()
    hub.ensure('main')
    hub.ensure('main')
    await tick()
    expect(open).toHaveBeenCalledTimes(1)
    expect(log.head('main')).toBe(2) // solo los 2 del ámbito y tipo permitido
    const first = log.next('main', 0)
    expect(first).toMatchObject({ kind: 'entry', entry: { seq: 1, name: 'session.idle' } })
    hub.ensure('task/noexiste1234') // motor desconocido: no abre
    expect(open).toHaveBeenCalledTimes(1)
    hub.stop()
  })

  it('reanudación por seq: since entrega solo lo nuevo; fuera del búfer o futuro → hueco (reset)', async () => {
    let n = 0
    const { hub, log, scope } = setup(async () =>
      feed([ge('session.idle', proj, { n: ++n }), ge('session.idle', proj, { n: ++n }), ge('session.idle', proj, { n: ++n })])
    )
    await scope.get()
    hub.start()
    hub.ensure('main')
    await tick()
    expect(log.head('main')).toBe(3)
    expect(log.next('main', 2)).toMatchObject({ kind: 'entry', entry: { seq: 3 } })
    expect(log.next('main', 3)).toBeNull()
    expect(log.next('main', 99)).toMatchObject({ kind: 'gap' }) // el Mac se reinició: el cliente va por delante
    hub.stop()
  })

  it('si el stream de subida se corta y reconecta se marca un hueco (reset)', async () => {
    let calls = 0
    const { hub, log, scope } = setup(async () => {
      calls++
      return calls === 1 ? feed([ge('session.idle', proj, { n: 1 })], false) : feed([ge('session.idle', proj, { n: 2 })])
    })
    await scope.get()
    hub.start()
    hub.ensure('main')
    await tick(80)
    expect(calls).toBeGreaterThanOrEqual(2)
    // 1 evento, hueco, 1 evento
    expect(log.next('main', 1)).toMatchObject({ kind: 'gap' })
    expect(log.head('main')).toBe(3)
    hub.stop()
  })

  it('sin dispositivos conectados se cierra todo: abort del stream y baja del bus', async () => {
    let aborted = false
    let unsub = 0
    const { hub, scope } = setup(
      async (_e, _t, signal) => {
        signal.addEventListener('abort', () => (aborted = true))
        return feed([])
      },
      { bus: () => () => void unsub++ }
    )
    await scope.get()
    hub.start()
    hub.ensure('main')
    await tick()
    expect(hub.engines()).toEqual(['main'])
    hub.stop()
    expect(aborted).toBe(true)
    expect(unsub).toBe(1)
    expect(hub.engines()).toEqual([])
    expect(hub.running).toBe(false)
  })

  it('bus de la app: lista blanca, recorte y publicación en el log (aunque no haya ventanas)', async () => {
    let sub: BusSubscriber | undefined
    const { hub, log, scope } = setup(async () => feed([]), {
      bus: (s) => {
        sub = s
        return () => undefined
      }
    })
    await scope.get()
    hub.start()
    expect(sub).toBeDefined()
    expect(sub!.channels.has('opencode:status')).toBe(true)
    expect(sub!.channels.has('computer:accessRequest')).toBe(true)
    for (const denied of [
      'pty:data',
      'computer:action',
      'account:changed',
      'remote:confirmRequest',
      'remote:changed',
      'extras:quick-prompt'
    ]) {
      expect(sub!.channels.has(denied)).toBe(false)
    }
    sub!.deliver('opencode:status', { state: 'ready' })
    expect(sub!.trim?.('tasks:server', { folder: outside })).toBeNull()
    expect(log.head('main')).toBe(1)
    expect(log.next('main', 0)).toMatchObject({ kind: 'entry', entry: { kind: 'ch', name: 'opencode:status', urgent: false } })
    hub.stop()
  })
})
