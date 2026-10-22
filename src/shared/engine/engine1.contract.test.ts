/**
 * Contrato de `EngineClient` aplicado a `Engine1Adapter` contra el OpenCode FALSO de E2E
 * (`e2e/fake-opencode/server.mjs`, en proceso y sobre un puerto efímero de 127.0.0.1), más los
 * casos propios del adaptador 1 (credenciales, red, normalización de eventos).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { GlobalEvent } from '@opencode-ai/sdk/v2/client'
import { createEngineClient } from './factory'
import { normalizeEvent } from './adapters/engine1'
import { EngineError } from './errors'
import { runEngineContract, type EngineContractHarness } from './contract'

/** Lo que usamos del módulo del falso (es `.mjs` sin tipos). */
interface FakeServer {
  listen(port: number, hostname: string): Promise<AddressInfo>
  close(): Promise<void> | void
}
interface FakeModule {
  createFakeServer(options: { env: Record<string, string>; cors?: string[] }): FakeServer
}

const USER = 'opencode'
const PASS = 'contrato-secreto'
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')

async function loadFake(): Promise<FakeModule> {
  const url = new URL('../../../e2e/fake-opencode/server.mjs', import.meta.url).href
  return (await import(/* @vite-ignore */ url)) as FakeModule
}

async function startFake(): Promise<{
  baseUrl: string
  close: () => Promise<void>
  control: (m: string, p: string, b?: unknown) => Promise<void>
}> {
  const { createFakeServer } = await loadFake()
  const xdg = mkdtempSync(join(tmpdir(), 'engine-contract-'))
  const fake = createFakeServer({
    env: { OPENCODE_SERVER_USERNAME: USER, OPENCODE_SERVER_PASSWORD: PASS, FAKE_OPENCODE_HEARTBEAT_MS: '0', XDG_DATA_HOME: xdg }
  })
  const addr = await fake.listen(0, '127.0.0.1')
  const baseUrl = `http://127.0.0.1:${addr.port}`
  const control = async (method: string, path: string, body?: unknown): Promise<void> => {
    const res = await fetch(`${baseUrl}/__e2e/${path}`, {
      method,
      headers: { authorization: AUTH, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    if (!res.ok) throw new Error(`control ${path}: ${res.status}`)
  }
  const close = async (): Promise<void> => {
    await fake.close()
    rmSync(xdg, { recursive: true, force: true })
  }
  return { baseUrl, close, control }
}

// ───────────── el contrato completo contra el falso ─────────────

runEngineContract(async (): Promise<EngineContractHarness> => {
  const { baseUrl, close, control } = await startFake()
  return {
    client: createEngineClient({ baseUrl, authorization: AUTH, engine: '1' }),
    directory: '/work/contrato',
    otherDirectory: '/work/otra',
    close,
    armPermission: () =>
      control('POST', 'script', {
        steps: [
          { type: 'permission', permission: 'bash', patterns: ['echo contrato'] },
          { type: 'text', text: 'listo' }
        ]
      }),
    armQuestion: () =>
      control('POST', 'script', {
        steps: [
          {
            type: 'question',
            questions: [{ question: '¿Seguimos?', header: 'Seguir', options: [{ label: 'Sí', description: 'continuar' }] }]
          },
          { type: 'text', text: 'listo' }
        ]
      }),
    dropStream: () => control('POST', 'drop-sse', {})
  }
}, 'Engine1Adapter + fake-opencode')

// ───────────── casos propios del adaptador 1 ─────────────

describe('Engine1Adapter: transporte y errores', () => {
  let ctx: Awaited<ReturnType<typeof startFake>>
  beforeAll(async () => {
    ctx = await startFake()
  })
  afterAll(async () => {
    await ctx.close()
  })

  it('credenciales incorrectas → unauthorized (401) y health sin lanzar', async () => {
    const bad = createEngineClient({ baseUrl: ctx.baseUrl, authorization: 'Basic ' + Buffer.from('x:y').toString('base64') })
    const err = await bad.sessions.list({ directory: '/work/x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).kind).toBe('unauthorized')
    expect((err as EngineError).status).toBe(401)
    expect(await bad.health()).toEqual({ ok: false })
  })

  it('servidor caído → network, y health devuelve ok:false', async () => {
    const down = createEngineClient({ baseUrl: 'http://127.0.0.1:1', authorization: AUTH })
    const err = await down.sessions.get('ses_x', { directory: '/work/x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).kind).toBe('network')
    expect(await down.health()).toEqual({ ok: false })
  })

  it('usa la carpeta de la conexión cuando la llamada no trae directory', async () => {
    const c = createEngineClient({ baseUrl: ctx.baseUrl, authorization: AUTH, directory: '/work/por-defecto' })
    const s = await c.sessions.create({ title: 'defecto' })
    expect(s.directory).toBe('/work/por-defecto')
    expect((await c.sessions.list()).map((x) => x.id)).toContain(s.id)
  })

  it('timeoutMs corta una petición lenta como network', async () => {
    const slow = createEngineClient({
      baseUrl: ctx.baseUrl,
      authorization: AUTH,
      timeoutMs: 20,
      fetch: (input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
          signal?.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
        })
    })
    const err = await slow.sessions.list({ directory: '/work/x' }).catch((e: unknown) => e)
    expect((err as EngineError).kind).toBe('network')
  })
})

describe('normalizeEvent', () => {
  const ev = (payload: object, directory = '/d'): GlobalEvent => ({ directory, payload: { id: 'e1', ...payload } }) as GlobalEvent

  it('traduce message.part.* a part.* y conserva la carpeta', () => {
    const delta = normalizeEvent(
      ev({ type: 'message.part.delta', properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'hi' } })
    )
    expect(delta).toEqual({ directory: '/d', type: 'part.delta', sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'hi' })
    expect(normalizeEvent(ev({ type: 'message.part.removed', properties: { sessionID: 's', messageID: 'm', partID: 'p' } })).type).toBe(
      'part.removed'
    )
  })

  it('server.connected → connected y vcs.branch.updated → vcs.branch', () => {
    expect(normalizeEvent(ev({ type: 'server.connected', properties: {} })).type).toBe('connected')
    expect(normalizeEvent(ev({ type: 'vcs.branch.updated', properties: { branch: 'main' } }))).toMatchObject({
      type: 'vcs.branch',
      branch: 'main'
    })
  })

  it('permission.asked trae la solicitud completa', () => {
    const props = { id: 'per_1', sessionID: 's', permission: 'bash', patterns: ['ls'], metadata: {}, always: [] }
    expect(normalizeEvent(ev({ type: 'permission.asked', properties: props }))).toMatchObject({ type: 'permission.asked', request: props })
  })

  it('un evento desconocido no se pierde', () => {
    const out = normalizeEvent(ev({ type: 'mcp.tools.changed', properties: { server: 'x' } }))
    expect(out).toMatchObject({ type: 'unknown', rawType: 'mcp.tools.changed', directory: '/d' })
  })
})
