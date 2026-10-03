import { describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { parseClientFrame, type RequestFrame } from '@shared/remote/protocol'
import { RemoteError, SidecarBackend, dispatch, type RemoteBackend } from './whitelist'
import {
  EventBridge,
  fitMessage,
  scrubText,
  shortenPaths,
  toRemoteMessage,
  toRemotePermission,
  toolSummary,
  type EventSource
} from './events'
import type { Message, Part, PermissionRequest, Session } from '@opencode-ai/sdk/v2/client'

const frame = (m: string, p: unknown): RequestFrame => {
  const r = parseClientFrame(JSON.stringify({ t: 'req', id: 7, m, p }))
  if (!r.ok || r.value.t !== 'req') throw new Error(`frame inválida: ${r.ok ? '' : r.reason}`)
  return r.value
}

describe('dispatch', () => {
  const backend = (over: Partial<RemoteBackend> = {}): RemoteBackend => ({
    listSessions: async () => ({ sessions: [], permissions: [] }),
    messages: async (sessionId) => ({ sessionId, messages: [], hasMore: false }),
    prompt: async () => undefined,
    abort: async () => undefined,
    replyPermission: async () => undefined,
    ...over
  })

  it('traduce errores del respaldo a códigos sin filtrar el mensaje', async () => {
    const res = await dispatch(
      frame('session.abort', { sessionId: 'ses_1' }),
      backend({ abort: async () => Promise.reject(new Error('/Users/ben/secreto falló')) })
    )
    expect(res).toEqual({ t: 'res', id: 7, ok: false, error: { code: 'failed' } })
    const nf = await dispatch(
      frame('session.abort', { sessionId: 'ses_1' }),
      backend({ abort: async () => Promise.reject(new RemoteError('not-found')) })
    )
    expect(nf).toEqual({ t: 'res', id: 7, ok: false, error: { code: 'not-found' } })
  })

  it('responde ok con el resultado esperado', async () => {
    const res = await dispatch(frame('permission.reply', { requestId: 'per_1', reply: 'once' }), backend())
    expect(res).toEqual({ t: 'res', id: 7, ok: true, m: 'permission.reply', result: { replied: true } })
  })
})

// ───────────── respaldo con un cliente SDK falso ─────────────

const CHAT = '/chat-ws'
const PROJ = '/work/proyecto'
const mkSession = (id: string, directory: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    directory,
    title: `t-${id}`,
    slug: id,
    projectID: 'p',
    version: '1',
    time: { created: 1, updated: Number(id.replace(/\D/g, '')) || 1 },
    ...extra
  }) as Session

function fakeClient(opts: { sessions: Record<string, Session[]>; perms?: Record<string, PermissionRequest[]> }) {
  const calls: Array<{ fn: string; args: unknown }> = []
  const client = {
    session: {
      list: vi.fn(async ({ directory }: { directory: string }) => ({ data: opts.sessions[directory] ?? [] })),
      status: vi.fn(async () => ({ data: {} })),
      get: vi.fn(async () => ({ data: undefined })),
      messages: vi.fn(async (): Promise<{ data: Array<{ info: Message; parts: Part[] }> }> => ({ data: [] })),
      message: vi.fn(async () => ({ data: undefined })),
      promptAsync: vi.fn(async (a: unknown) => (calls.push({ fn: 'promptAsync', args: a }), { data: {} })),
      abort: vi.fn(async (a: unknown) => (calls.push({ fn: 'abort', args: a }), { data: true }))
    },
    permission: {
      list: vi.fn(async ({ directory }: { directory: string }) => ({ data: opts.perms?.[directory] ?? [] })),
      reply: vi.fn(async (a: unknown) => (calls.push({ fn: 'reply', args: a }), { data: true }))
    }
  }
  return { client: client as unknown as OpencodeClient, calls, raw: client }
}

function backendWith(c: ReturnType<typeof fakeClient>, folders: string[] = [PROJ]): SidecarBackend {
  let t = 0
  return new SidecarBackend({
    getClient: async () => c.client,
    chatDirectory: CHAT,
    getRecentFolders: () => folders,
    modelFor: (k) => (k === 'chat' ? { providerID: 'p', modelID: 'chat-model' } : undefined),
    dirExists: () => true,
    now: () => (t += 5000)
  })
}

describe('SidecarBackend: ámbito', () => {
  it('lista Chat y Code, y deja fuera Tareas y subsesiones', async () => {
    const c = fakeClient({
      sessions: {
        [CHAT]: [mkSession('ses_1', CHAT), mkSession('ses_2', CHAT, { metadata: { mode: 'tasks' } })],
        [PROJ]: [mkSession('ses_3', PROJ), mkSession('ses_4', PROJ, { parentID: 'ses_3' })]
      }
    })
    const r = await backendWith(c).listSessions()
    expect(r.sessions.map((s) => s.id).sort()).toEqual(['ses_1', 'ses_3'])
    expect(r.sessions.find((s) => s.id === 'ses_3')).toMatchObject({ kind: 'code', project: 'proyecto' })
    expect(r.sessions.find((s) => s.id === 'ses_1')).toMatchObject({ kind: 'chat' })
    expect(JSON.stringify(r)).not.toContain('/work')
  })

  it('una sesión fuera del ámbito responde not-found y nunca llega al motor', async () => {
    const c = fakeClient({ sessions: { [CHAT]: [mkSession('ses_1', CHAT)] } })
    const b = backendWith(c)
    await expect(b.prompt('ses_999', 'hola')).rejects.toMatchObject({ code: 'not-found' })
    await expect(b.abort('ses_999')).rejects.toMatchObject({ code: 'not-found' })
    await expect(b.messages('ses_999', 10)).rejects.toMatchObject({ code: 'not-found' })
    expect(c.raw.session.promptAsync).not.toHaveBeenCalled()
    expect(c.raw.session.abort).not.toHaveBeenCalled()
  })

  it('el prompt de Chat usa el agente de Chat y su modelo; el de Code, build', async () => {
    const c = fakeClient({ sessions: { [CHAT]: [mkSession('ses_1', CHAT)], [PROJ]: [mkSession('ses_3', PROJ)] } })
    const b = backendWith(c)
    await b.listSessions()
    await b.prompt('ses_1', 'hola')
    await b.prompt('ses_3', 'edita')
    const [chat, code] = c.calls.filter((x) => x.fn === 'promptAsync').map((x) => x.args as Record<string, unknown>)
    expect(chat).toMatchObject({ sessionID: 'ses_1', directory: CHAT, agent: 'chat', model: { providerID: 'p', modelID: 'chat-model' } })
    expect(code).toMatchObject({ sessionID: 'ses_3', directory: PROJ, agent: 'build' })
    expect(code.parts).toEqual([{ type: 'text', text: 'edita' }])
  })

  it('permisos: solo se aprueban los accionables y de sesiones del ámbito', async () => {
    const perm = (id: string, sessionID: string, permission: string): PermissionRequest =>
      ({ id, sessionID, permission, patterns: ['/Users/ben/p/src/a.ts'], metadata: {}, always: [] }) as PermissionRequest
    const c = fakeClient({
      sessions: { [CHAT]: [mkSession('ses_1', CHAT)], [PROJ]: [mkSession('ses_3', PROJ)] },
      perms: {
        [PROJ]: [
          perm('per_edit', 'ses_3', 'edit'),
          perm('per_dir', 'ses_3', 'external_directory'),
          perm('per_mac', 'ses_3', 'computer_click'),
          perm('per_out', 'ses_77', 'bash')
        ]
      }
    })
    const b = backendWith(c)
    const list = await b.listSessions()
    expect(list.permissions.map((p) => [p.requestId, p.actionable])).toEqual([
      ['per_edit', true],
      ['per_dir', false],
      ['per_mac', false]
    ])
    expect(JSON.stringify(list.permissions)).not.toContain('/Users/ben')
    await b.replyPermission('per_edit', 'once')
    await expect(b.replyPermission('per_dir', 'once')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(b.replyPermission('per_mac', 'reject')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(b.replyPermission('per_out', 'once')).rejects.toMatchObject({ code: 'not-found' })
    await expect(b.replyPermission('per_nada', 'once')).rejects.toMatchObject({ code: 'not-found' })
    expect(c.calls.filter((x) => x.fn === 'reply')).toEqual([
      { fn: 'reply', args: { requestID: 'per_edit', directory: PROJ, reply: 'once' } }
    ])
  })

  it('mensajes: pagina con before y limit, y cabe en una trama', async () => {
    const c = fakeClient({ sessions: { [CHAT]: [mkSession('ses_1', CHAT)] } })
    const info = (n: number): Message =>
      ({ id: `msg_${String(n).padStart(3, '0')}`, sessionID: 'ses_1', role: 'user', time: { created: n } }) as Message
    const text = (n: number): Part =>
      ({ id: `prt_${n}`, sessionID: 'ses_1', messageID: `msg_${String(n).padStart(3, '0')}`, type: 'text', text: 'x'.repeat(9000) }) as Part
    const all = Array.from({ length: 30 }, (_, i) => ({ info: info(i + 1), parts: [text(i + 1)] }))
    c.raw.session.messages.mockResolvedValue({ data: all })
    const b = backendWith(c)
    const r = await b.messages('ses_1', 30)
    expect(JSON.stringify(r).length).toBeLessThan(60 * 1024)
    expect(r.hasMore).toBe(true)
    const newest = r.messages[r.messages.length - 1].id
    expect(newest).toBe('msg_030')
    const older = await b.messages('ses_1', 3, r.messages[0].id)
    expect(older.messages.every((m) => m.id < r.messages[0].id)).toBe(true)
    expect(older.messages).toHaveLength(3)
  })
})

describe('recorte de contenido', () => {
  it('quita rutas absolutas y secretos', () => {
    expect(shortenPaths('abre /Users/ben/proyecto/src/a.ts y ~/notas/x.md o C:\\Users\\ana\\b.txt')).toBe('abre …/a.ts y …/x.md o …/b.txt')
    expect(shortenPaths('https://example.com/a/b y a/b/c y 1/2/3')).toBe('https://example.com/a/b y a/b/c y 1/2/3')
    expect(scrubText('token=abcd1234efgh5678 en /etc/hosts', 100)).not.toMatch(/abcd1234|\/etc/)
    expect(scrubText('x'.repeat(50), 10)).toHaveLength(10)
  })

  it('resúmenes de herramientas sin rutas', () => {
    expect(toolSummary('read', { filePath: '/Users/ben/p/src/app.ts' })).toBe('app.ts')
    expect(toolSummary('bash', { command: 'cat /Users/ben/.ssh/id_rsa\nsegunda' })).toBe('cat …/id_rsa')
    expect(toolSummary('webfetch', { url: 'https://a.com/x?key=SECRETO' })).toBe('https://a.com/x')
  })

  it('mensajes: omite partes sintéticas y recorta', () => {
    const info = { id: 'msg_1', sessionID: 'ses_1', role: 'assistant', time: { created: 5 } } as Message
    const parts = [
      { id: 'a', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: 'hola /Users/ben/x/y.ts', synthetic: false },
      { id: 'b', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: 'oculto', synthetic: true },
      { id: 'c', sessionID: 'ses_1', messageID: 'msg_1', type: 'reasoning', text: 'pensando' },
      {
        id: 'd',
        sessionID: 'ses_1',
        messageID: 'msg_1',
        type: 'tool',
        callID: 'c',
        tool: 'bash',
        state: { status: 'running', input: { command: 'ls /tmp/a/b' }, time: { start: 1 } }
      }
    ] as unknown as Part[]
    const m = toRemoteMessage(info, parts)
    expect(m.streaming).toBe(true)
    expect(m.parts).toEqual([
      { type: 'text', text: 'hola …/y.ts' },
      { type: 'tool', name: 'bash', summary: 'ls …/b', status: 'running' }
    ])
    const big = { ...m, parts: [{ type: 'text' as const, text: 'y'.repeat(12_000) }, ...m.parts] }
    expect(JSON.stringify(fitMessage(big, 2000)).length).toBeLessThan(2100)
  })

  it('permisos de Control del Mac o carpetas son de solo lectura', () => {
    const p = (permission: string): PermissionRequest =>
      ({ id: 'per_1', sessionID: 'ses_1', permission, patterns: ['*'], metadata: {}, always: [] }) as PermissionRequest
    expect(toRemotePermission(p('bash')).actionable).toBe(true)
    expect(toRemotePermission(p('external_directory')).actionable).toBe(false)
    expect(toRemotePermission(p('computer_screenshot')).actionable).toBe(false)
    expect(toRemotePermission(p('mcp_foo_bar')).actionable).toBe(false)
  })
})

describe('EventBridge', () => {
  const source = (inScope: Set<string>): EventSource & { loads: string[] } => {
    const loads: string[] = []
    const cache = new Map<string, ReturnType<EventSource['cachedSession']>>()
    return {
      loads,
      scopeSession: async (id) => (inScope.has(id) ? { id, title: 't', kind: 'chat', updatedAt: 1, status: 'idle' } : null),
      loadMessage: async (_s, mid) => (loads.push(mid), { id: mid, sessionId: 'ses_1', role: 'assistant', createdAt: 1, parts: [] }),
      cachedSession: (id) => cache.get(id) ?? (inScope.has(id) ? { id, title: 't', kind: 'chat', updatedAt: 1, status: 'idle' } : null),
      forgetSession: (id) => void cache.delete(id),
      setCachedStatus: () => undefined,
      applySessionInfo: (info) =>
        inScope.has(info.id) ? { id: info.id, title: info.title, kind: 'chat', updatedAt: 1, status: 'idle' } : null
    }
  }

  it('solo reenvía eventos de sesiones del ámbito, con los mensajes agrupados', async () => {
    vi.useFakeTimers()
    const out: unknown[] = []
    const src = source(new Set(['ses_1']))
    const bridge = new EventBridge({ getClient: () => null, source: src, emit: (e) => out.push(e) })
    ;(bridge as unknown as { stopped: boolean }).stopped = false
    const ev = (type: string, properties: Record<string, unknown>) => bridge.handle({ directory: CHAT, payload: { type, properties } })
    for (let i = 0; i < 20; i++)
      await ev('message.part.delta', { sessionID: 'ses_1', messageID: 'msg_1', partID: 'p', field: 'text', delta: 'a' })
    await ev('message.part.delta', { sessionID: 'ses_9', messageID: 'msg_9', partID: 'p', field: 'text', delta: 'a' })
    await vi.advanceTimersByTimeAsync(600)
    expect(src.loads).toEqual(['msg_1'])
    expect(out).toHaveLength(1)
    await ev('permission.replied', { sessionID: 'ses_1', requestID: 'per_1', reply: 'once' })
    expect(out[1]).toEqual({ e: 'permission.resolved', requestId: 'per_1' })
    await ev('permission.asked', { id: 'per_2', sessionID: 'ses_9', permission: 'bash', patterns: ['ls'], metadata: {}, always: [] })
    expect(out).toHaveLength(2)
    vi.useRealTimers()
  })
})
