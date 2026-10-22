/**
 * Subagentes en segundo plano y Code Mode vistos a través de `EngineClient` (`Engine1Adapter`) contra el
 * OpenCode FALSO (`e2e/fake-opencode/server.mjs`). Cubre lo que el motor 1.19 hace con
 * `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` y `OPENCODE_EXPERIMENTAL_CODE_MODE`: sesiones hijas (`children`),
 * estado de las hijas, eventos, aviso de fin que despierta al padre, abortar, y un permiso por cada
 * llamada interna de Code Mode. No sustituye la prueba con el motor real (docs/DISENO-SEGUNDO-PLANO.md §3.1).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createEngineClient } from './factory'
import type { EngineClient } from './client'
import type { EngineEvent, EngineEventOf, EngineEventType } from './events'
import type { MessageWithParts, ToolPart } from './types'

interface FakeServer {
  listen(port: number, hostname: string): Promise<AddressInfo>
  close(): Promise<void> | void
}
interface FakeModule {
  createFakeServer(options: { env: Record<string, string>; cors?: string[] }): FakeServer
}

const USER = 'opencode'
const PASS = 'segundo-plano'
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')
const DIR = '/work/segundo-plano'
const dir = { directory: DIR }

async function waitFor<T>(
  label: string,
  fn: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  ms = 4_000
): Promise<T> {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v !== undefined && v !== null && v !== false) return v
    if (Date.now() - t0 > ms) throw new Error(`Tiempo agotado esperando: ${label}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

describe('Engine1Adapter: subagentes en segundo plano y Code Mode (fake-opencode)', () => {
  let baseUrl = ''
  let xdg = ''
  let fake: FakeServer
  let client: EngineClient
  let events: EngineEvent[] = []
  let stop: () => void = () => undefined

  const control = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}/__e2e/${path}`, {
      method,
      headers: { authorization: AUTH, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    if (!res.ok) throw new Error(`control ${path}: ${res.status}`)
    return res.json()
  }
  const text = (t: string): { type: 'text'; text: string }[] => [{ type: 'text', text: t }]
  const of = <T extends EngineEventType>(type: T, pred?: (e: EngineEventOf<T>) => boolean): EngineEventOf<T>[] =>
    events.filter((e): e is EngineEventOf<T> => e.type === type && (!pred || pred(e as EngineEventOf<T>)))
  const tools = (msgs: MessageWithParts[], name: string): ToolPart[] =>
    msgs.flatMap((m) => m.parts).filter((p): p is ToolPart => p.type === 'tool' && p.tool === name)
  const synthetic = (msgs: MessageWithParts[]): string[] =>
    msgs
      .filter((m) => m.info.role === 'user')
      .flatMap((m) => m.parts)
      .flatMap((p) => (p.type === 'text' && p.synthetic ? [p.text] : []))
  const idle = async (id: string): Promise<boolean> => !(id in (await client.sessions.status(dir)))

  /** Crea el padre, encola su guion y lo lanza. */
  async function launch(steps: unknown[]): Promise<string> {
    const s = await client.sessions.create({ ...dir, title: 'padre' })
    await control('POST', 'script', { steps })
    await client.sessions.send(s.id, { parts: text('lanza') }, dir)
    return s.id
  }
  const firstChild = (parent: string): Promise<string> =>
    waitFor('hija creada', async () => (await client.sessions.children(parent, dir))[0]?.id)

  beforeAll(async () => {
    const url = new URL('../../../e2e/fake-opencode/server.mjs', import.meta.url).href
    const mod = (await import(/* @vite-ignore */ url)) as FakeModule
    xdg = mkdtempSync(join(tmpdir(), 'engine-bg-'))
    fake = mod.createFakeServer({
      env: { OPENCODE_SERVER_USERNAME: USER, OPENCODE_SERVER_PASSWORD: PASS, FAKE_OPENCODE_HEARTBEAT_MS: '0', XDG_DATA_HOME: xdg }
    })
    const addr = await fake.listen(0, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${addr.port}`
    client = createEngineClient({ baseUrl, authorization: AUTH, engine: '1' })
  })
  afterAll(async () => {
    stop()
    await fake.close()
    rmSync(xdg, { recursive: true, force: true })
  })
  beforeEach(async () => {
    stop()
    await control('POST', 'reset', {})
    events = []
    let opened = false
    stop = client.events.subscribe((e) => events.push(e), { onOpen: () => (opened = true) })
    await waitFor('stream abierto', () => opened || undefined)
  })

  it('segundo plano: la hija aparece en children y en status, y al terminar el padre recibe el aviso y arranca otro turno', async () => {
    await control('POST', 'bg-set', { hold: true })
    await control('POST', 'script', { match: 'Background task', steps: [{ type: 'text', text: 'resumen final' }] })
    const parent = await launch([
      { type: 'task', background: true, title: 'Investigar', steps: [{ type: 'text', text: 'datos' }] },
      { type: 'text', text: 'lanzado' }
    ])
    const child = await firstChild(parent)
    await waitFor('padre inactivo', async () => (await idle(parent)) && (await client.sessions.messages(parent, dir)).length >= 2)

    // La hija es un hijo del padre, está ocupada y el padre ya devolvió el control.
    const kids = await client.sessions.children(parent, dir)
    expect(kids.map((k) => k.parentID)).toEqual([parent])
    expect((await client.sessions.status(dir))[child]?.type).toBe('busy')
    expect(of('session.created', (e) => e.session.id === child)[0].session.parentID).toBe(parent)
    const [task] = tools(await client.sessions.messages(parent, dir), 'task')
    expect(task.state.status).toBe('completed')
    expect(synthetic(await client.sessions.messages(parent, dir))).toEqual([])

    await control('POST', 'bg-release', { sessionID: child })
    await waitFor('aviso sintético', async () => synthetic(await client.sessions.messages(parent, dir)).length === 1)
    await waitFor('turno de despertar', async () => {
      const msgs = await client.sessions.messages(parent, dir)
      return msgs.filter((m) => m.info.role === 'assistant').length === 2 && (await idle(parent))
    })
    const msgs = await client.sessions.messages(parent, dir)
    expect(synthetic(msgs)[0]).toMatch(/Background task completed: Investigar/)
    expect(msgs[msgs.length - 1].parts.some((p) => p.type === 'text' && p.text === 'resumen final')).toBe(true)

    // Eventos de la hija por el mismo stream, normalizados.
    expect(of('part.updated', (e) => e.sessionID === child).length).toBeGreaterThan(0)
    expect(of('message.updated', (e) => e.sessionID === child).length).toBeGreaterThan(0)
    expect(of('session.idle', (e) => e.sessionID === child).length).toBe(1)
    expect(await idle(child)).toBe(true)
  }, 15_000)

  it('abortar al padre no cancela a la hija en segundo plano; abortar a la hija cancela sin avisar al padre', async () => {
    await control('POST', 'bg-set', { hold: true })
    const parent = await launch([
      { type: 'task', background: true, title: 'A' },
      { type: 'delay', ms: 300 }
    ])
    const child = await firstChild(parent)
    await waitFor('hija ocupada', async () => (await client.sessions.status(dir))[child]?.type === 'busy')
    await client.sessions.abort(parent, dir)
    await waitFor('padre inactivo', () => idle(parent))
    expect((await client.sessions.status(dir))[child]?.type).toBe('busy')

    await client.sessions.abort(child, dir)
    await waitFor('hija inactiva', () => idle(child))
    const childMsgs = await client.sessions.messages(child, dir)
    const last = childMsgs[childMsgs.length - 1].info
    expect(last.role === 'assistant' && last.error?.name).toBe('MessageAbortedError')
    await new Promise((r) => setTimeout(r, 80))
    expect(synthetic(await client.sessions.messages(parent, dir))).toEqual([])
  }, 15_000)

  it('fallo de la hija: session.error en la hija y aviso de error al padre', async () => {
    await control('POST', 'bg-set', { failNext: 1, failMessage: 'se rompió', hold: false, delayMs: 30 })
    const parent = await launch([{ type: 'task', background: true, title: 'Falla' }])
    const child = await firstChild(parent)
    await waitFor('aviso de error', async () => synthetic(await client.sessions.messages(parent, dir)).length === 1)
    expect(synthetic(await client.sessions.messages(parent, dir))[0]).toMatch(/Background task failed: Falla[\s\S]*se rompió/)
    expect(of('session.error', (e) => e.sessionID === child).length).toBe(1)
  }, 15_000)

  it('primer plano mandado al fondo con la ruta experimental', async () => {
    await control('POST', 'bg-set', { hold: true })
    const parent = await launch([{ type: 'task', title: 'Bloquea', steps: [{ type: 'text', text: 'largo' }] }])
    const child = await firstChild(parent)
    await waitFor(
      'padre ocupado esperando',
      async () => tools(await client.sessions.messages(parent, dir), 'task')[0]?.state.status === 'running'
    )
    // `EngineClient` aún no expone esta ruta experimental: se llama en crudo.
    const res = await fetch(`${baseUrl}/experimental/session/${parent}/background?directory=${encodeURIComponent(DIR)}`, {
      method: 'POST',
      headers: { authorization: AUTH }
    })
    expect(await res.json()).toBe(true)
    await waitFor(
      'padre libre',
      async () => (await idle(parent)) && tools(await client.sessions.messages(parent, dir), 'task')[0]?.state.status === 'completed'
    )
    await control('POST', 'bg-release', { sessionID: child })
    await waitFor('aviso', async () => synthetic(await client.sessions.messages(parent, dir)).length === 1)
  }, 15_000)

  it('los permisos de la hija llegan con su sessionID y se responden como cualquier otro', async () => {
    const parent = await launch([
      { type: 'task', background: true, title: 'Pide', steps: [{ type: 'permission', permission: 'bash', patterns: ['echo hija'] }] }
    ])
    const child = await firstChild(parent)
    const asked = await waitFor('permission.asked de la hija', () => of('permission.asked', (e) => e.request.sessionID === child)[0])
    expect((await client.permissions.list(dir)).map((p) => p.id)).toContain(asked.request.id)
    await client.permissions.reply(asked.request.id, 'once', { ...dir, sessionID: child })
    await waitFor('aviso de fin', async () => synthetic(await client.sessions.messages(parent, dir)).length === 1)
  }, 15_000)

  it('reinicio con una hija en curso: "lose" no avisa; "resume" reanuda y avisa', async () => {
    await control('POST', 'bg-set', { hold: true })
    const parent = await launch([{ type: 'task', background: true, title: 'Reinicio' }])
    const child = await firstChild(parent)
    await waitFor('hija ocupada', async () => (await client.sessions.status(dir))[child]?.type === 'busy')
    await control('POST', 'restart', { mode: 'lose' })
    // El stream se corta y el adaptador se reconecta solo.
    await waitFor('hija inactiva', () => idle(child))
    await new Promise((r) => setTimeout(r, 80))
    expect(synthetic(await client.sessions.messages(parent, dir))).toEqual([])

    await control('POST', 'reset', {})
    await control('POST', 'bg-set', { hold: true })
    await control('POST', 'script', { match: 'Background task', steps: [{ type: 'text', text: 'ok' }] })
    const parent2 = await launch([{ type: 'task', background: true, title: 'Reanuda', steps: [{ type: 'text', text: 'sigue' }] }])
    const child2 = await firstChild(parent2)
    await control('POST', 'restart', { mode: 'resume' })
    await waitFor('hija reanudada en espera', async () => (await client.sessions.status(dir))[child2]?.type === 'busy')
    await control('POST', 'bg-release', { sessionID: child2 })
    await waitFor('aviso tras reiniciar', async () => synthetic(await client.sessions.messages(parent2, dir)).length === 1)
  }, 20_000)

  it('Code Mode: un permiso por cada llamada interna (clave MCP) y metadata.toolCalls', async () => {
    const parent = await launch([
      {
        type: 'code_mode',
        calls: [
          { tool: 'github_list_issues', output: ['#1'] },
          { tool: 'github_get_issue', output: 'x' },
          { tool: 'docs_read', output: 'permitido' }
        ],
        rules: [{ permission: 'docs_*', action: 'allow' }]
      }
    ])
    const first = await waitFor('permiso 1', () => of('permission.asked', (e) => e.request.sessionID === parent)[0])
    expect(first.request.permission).toBe('github_list_issues')
    expect(first.request.patterns).toEqual(['*'])
    const [running] = tools(await client.sessions.messages(parent, dir), 'execute')
    expect(running.state.status).toBe('running')
    expect(first.request.tool?.callID).toBe(running.callID)
    await client.permissions.reply(first.request.id, 'once', { ...dir, sessionID: parent })
    const second = await waitFor('permiso 2', () => of('permission.asked', (e) => e.request.permission === 'github_get_issue')[0])
    await client.permissions.reply(second.request.id, 'reject', { ...dir, sessionID: parent })
    await waitFor(
      'padre inactivo',
      async () => (await idle(parent)) && tools(await client.sessions.messages(parent, dir), 'execute')[0]?.state.status === 'error'
    )
    // Solo dos preguntas: la tercera herramienta (docs_*) estaba en allow y la ejecución ya se había cortado.
    expect(of('permission.asked').map((e) => e.request.permission)).toEqual(['github_list_issues', 'github_get_issue'])
    const [done] = tools(await client.sessions.messages(parent, dir), 'execute')
    expect(done.state.status === 'error' && done.state.metadata?.toolCalls).toMatchObject([{ status: 'completed' }, { status: 'error' }])
  }, 15_000)

  it('Code Mode: una herramienta denegada por reglas nunca llega a la interfaz', async () => {
    const parent = await launch([{ type: 'code_mode', calls: [{ tool: 'shell_run' }], rules: [{ permission: 'shell_*', action: 'deny' }] }])
    await waitFor('padre inactivo', async () => (await idle(parent)) && (await client.sessions.messages(parent, dir)).length >= 2)
    const [part] = tools(await client.sessions.messages(parent, dir), 'execute')
    expect(part.state.status).toBe('error')
    expect(of('permission.asked')).toEqual([])
  }, 15_000)
})
