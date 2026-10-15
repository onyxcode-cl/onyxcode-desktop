/**
 * Overdrive con sandbox + proveedores con clave de API, verificación REAL de punta a punta (Seatbelt + binario de OpenCode
 * real, sin Electron ni red): `startTasksServer` lee un `auth.json` de PRUEBA (userData temporal) con claves REAL falsas de
 * `openai`, `anthropic` y `google`, levanta un `CredentialProxy` por proveedor y lanza `opencode serve` aislado con claves
 * centinela + `provider.<id>.options.baseURL` apuntando al proxy. Se pide una respuesta de modelo a cada proveedor y se
 * comprueba que (a) el upstream FALSO (127.0.0.1) recibe la clave REAL en la cabecera propia del SDK (Bearer / x-api-key /
 * x-goog-api-key), (b) nunca recibe el centinela, (c) el entorno/argumentos del proceso aislado (`ps eww`) y la configuración
 * no contienen la clave real y (d) la respuesta del modelo falso llega a la sesión.
 *
 * Inyección solo de test: se MUTA la entrada de `PROVIDER_TARGETS` (objeto exportado, mismo módulo que usa `sandbox.ts`) para
 * apuntar su origen al servidor falso; no hay cambios en código de producción. Limitaciones: el catálogo de modelos
 * (models.dev) no se descarga: se usa la caché real de OpenCode (`~/.cache/opencode/models.json`, que producción también
 * siembra con `seedModelsCache`); sin ella la prueba se salta. Se salta sin macOS o sin binario (`OPENCODE_BIN` o
 * resources/opencode-bin/bin/opencode). Carpeta de config vacía (el plugin del motor se instalaría por red).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('./opencode-config', () => ({
  getOpencodeEnv: () => ({
    OPENCODE_CONFIG_DIR: join(state.userData, 'opencode-config'),
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    XDG_DATA_HOME: join(state.userData, 'opencode-data')
  })
}))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => process.cwd(), isPackaged: false, getVersion: () => '0.0.0' }
}))

import { appAuthFile } from '../opencode/data-dir'
import { PROVIDER_TARGETS } from './provider-egress'
import { sandboxKey, startTasksServer, type TasksServerHandle } from './sandbox'

const BIN = process.env.OPENCODE_BIN || resolve(process.cwd(), 'resources/opencode-bin/bin/opencode')
const HAS_BIN = existsSync(BIN)
const HAS_CATALOG = existsSync(join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'opencode', 'models.json'))

interface Provider {
  id: 'openai' | 'anthropic' | 'google'
  model: string
  real: string
  header: string
  /** Prefijo del valor de la cabecera (Bearer …). */
  scheme: string
  match: (path: string) => boolean
  reply: string
}
const PROVIDERS: Provider[] = [
  {
    id: 'openai',
    model: 'gpt-5.4',
    real: 'SECRETO-REAL-openai-1a2b3c4d5e6f',
    header: 'authorization',
    scheme: 'Bearer ',
    match: (p) => p.startsWith('/v1/responses') || p.startsWith('/v1/chat/completions'),
    reply: 'RESPUESTA-FALSA-OPENAI-31337'
  },
  {
    id: 'anthropic',
    model: 'claude-haiku-4-5',
    real: 'SECRETO-REAL-anthropic-9f8e7d6c5b4a',
    header: 'x-api-key',
    scheme: '',
    match: (p) => p.startsWith('/v1/messages'),
    reply: 'RESPUESTA-FALSA-ANTHROPIC-31337'
  },
  {
    id: 'google',
    model: 'gemini-flash-latest',
    real: 'SECRETO-REAL-google-0a1b2c3d4e5f',
    header: 'x-goog-api-key',
    scheme: '',
    match: (p) => p.startsWith('/v1beta/models/'),
    reply: 'RESPUESTA-FALSA-GOOGLE-31337'
  }
]

interface Seen {
  path: string
  headers: IncomingMessage['headers']
  body: string
}

const sse = (events: Array<[string | null, unknown]>): string =>
  events.map(([ev, data]) => `${ev ? `event: ${ev}\n` : ''}data: ${JSON.stringify(data)}\n\n`).join('')

function respond(p: Provider, wantsStream: boolean): { type: string; body: string } {
  const text = p.reply
  if (p.id === 'anthropic') {
    const msg = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: p.model,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 5, output_tokens: 1 }
    }
    return {
      type: 'text/event-stream',
      body: sse([
        ['message_start', { type: 'message_start', message: msg }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }],
        ['message_stop', { type: 'message_stop' }]
      ])
    }
  }
  if (p.id === 'google') {
    return {
      type: 'text/event-stream',
      body: sse([
        [
          null,
          {
            candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 }
          }
        ]
      ])
    }
  }
  // openai: Responses API (el SDK @ai-sdk/openai de OpenCode) con respaldo a chat/completions
  const item = {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }]
  }
  if (!wantsStream)
    return {
      type: 'application/json',
      body: JSON.stringify({
        id: 'resp_1',
        object: 'response',
        created_at: 1,
        model: p.model,
        status: 'completed',
        output: [item],
        usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 }
      })
    }
  return {
    type: 'text/event-stream',
    body: sse([
      [
        'response.created',
        { type: 'response.created', response: { id: 'resp_1', object: 'response', created_at: 1, model: p.model, status: 'in_progress' } }
      ],
      [
        'response.output_item.added',
        { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } }
      ],
      [
        'response.content_part.added',
        {
          type: 'response.content_part.added',
          item_id: 'msg_1',
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] }
        }
      ],
      [
        'response.output_text.delta',
        { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: text }
      ],
      ['response.output_text.done', { type: 'response.output_text.done', item_id: 'msg_1', output_index: 0, content_index: 0, text }],
      ['response.output_item.done', { type: 'response.output_item.done', output_index: 0, item }],
      [
        'response.completed',
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            object: 'response',
            created_at: 1,
            model: p.model,
            status: 'completed',
            incomplete_details: null,
            usage: {
              input_tokens: 5,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 4,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 9
            }
          }
        }
      ]
    ])
  }
}

function fakeUpstream(seen: Seen[]): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const path = req.url ?? ''
      const body = Buffer.concat(chunks).toString('utf8')
      seen.push({ path, headers: req.headers, body })
      const p = PROVIDERS.find((x) => x.match(path))
      if (!p || req.method !== 'POST') {
        res
          .writeHead(404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { message: `no mock for ${req.method} ${path}` } }))
        return
      }
      let wantsStream = true
      try {
        wantsStream = (JSON.parse(body) as { stream?: boolean }).stream !== false
      } catch {
        /* cuerpo no JSON */
      }
      const r = respond(p, wantsStream)
      res.writeHead(200, { 'content-type': r.type, 'cache-control': 'no-cache' }).end(r.body)
    })
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: (server.address() as { port: number }).port })))
}

describe.skipIf(!macOnly || !HAS_BIN || !HAS_CATALOG)('sandbox real + opencode real: proveedores con clave vía CredentialProxy', () => {
  let root: string
  let handle: TasksServerHandle | null = null
  let upstream: Server
  const seen: Seen[] = []
  const originals: Record<string, (typeof PROVIDER_TARGETS)[string]> = {}
  const results: Record<string, { text: string; error: string; raw: string }> = {}
  let envDump = ''
  let pid = 0
  const prevBin = process.env.OPENCODE_BIN
  const prevDisclaim = process.env.LAZUNOX_NO_DISCLAIM

  const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${handle!.baseUrl}${path}${path.includes('?') ? '&' : '?'}directory=${encodeURIComponent(handle!.paths.directory)}`, {
      ...init,
      headers: { authorization: handle!.authorization, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(60_000)
    })

  beforeAll(async () => {
    process.env.OPENCODE_BIN = BIN
    process.env.LAZUNOX_NO_DISCLAIM = '1'
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-provreal-')))
    state.userData = join(root, 'userData')
    mkdirSync(join(state.userData, 'opencode-config'), { recursive: true })
    writeFileSync(join(state.userData, 'opencode-config', '.gitignore'), 'node_modules\n')
    const folder = join(root, 'folder')
    mkdirSync(folder, { recursive: true })

    const auth = appAuthFile(state.userData)
    mkdirSync(dirname(auth), { recursive: true })
    writeFileSync(auth, JSON.stringify(Object.fromEntries(PROVIDERS.map((p) => [p.id, { type: 'api', key: p.real }]))))

    const u = await fakeUpstream(seen)
    upstream = u.server
    for (const p of PROVIDERS) {
      originals[p.id] = PROVIDER_TARGETS[p.id]
      PROVIDER_TARGETS[p.id] = { origin: `http://127.0.0.1:${u.port}`, pathPrefix: PROVIDER_TARGETS[p.id].pathPrefix }
    }

    handle = await startTasksServer(folder, {
      isolation: { privateDir: join(state.userData, 'tasks-sandbox', sandboxKey(folder)), userData: state.userData },
      networkAllowlist: () => []
    })
    pid = handle.pid!
    const ps = spawnSync('/bin/ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 10_000 })
    envDump = `${ps.stdout}${ps.stderr}`

    for (const p of PROVIDERS) {
      const s = (await (await api('/session', { method: 'POST', body: '{}' })).json()) as { id: string }
      const r = await api(`/session/${s.id}/message`, {
        method: 'POST',
        body: JSON.stringify({ model: { providerID: p.id, modelID: p.model }, parts: [{ type: 'text', text: 'di hola' }] })
      })
      const raw = await r.text()
      let text = ''
      let error = ''
      try {
        const j = JSON.parse(raw) as { info?: { error?: unknown }; parts?: Array<{ type: string; text?: string }> }
        text = (j.parts ?? [])
          .filter((x) => x.type === 'text')
          .map((x) => x.text ?? '')
          .join('')
        if (j.info?.error) error = JSON.stringify(j.info.error)
      } catch {
        error = raw
      }
      results[p.id] = { text, error, raw }
    }
  }, 180_000)

  afterAll(async () => {
    await handle?.stop().catch(() => undefined)
    for (const p of PROVIDERS) if (originals[p.id]) PROVIDER_TARGETS[p.id] = originals[p.id]
    upstream?.closeAllConnections()
    upstream?.close()
    if (prevDisclaim === undefined) delete process.env.LAZUNOX_NO_DISCLAIM
    else process.env.LAZUNOX_NO_DISCLAIM = prevDisclaim
    if (prevBin === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = prevBin
    if (root) rmSync(root, { recursive: true, force: true })
  })

  for (const p of PROVIDERS) {
    describe(p.id, () => {
      const mine = (): Seen[] => seen.filter((s) => p.match(s.path) && JSON.stringify(s.body).includes(p.model))

      it('(a) el upstream recibe la clave REAL en la cabecera propia del SDK', () => {
        const hits = seen.filter((s) => p.match(s.path))
        expect(hits.length, JSON.stringify(results[p.id])).toBeGreaterThan(0)
        for (const h of hits) expect(h.headers[p.header], `${h.path} ${JSON.stringify(h.headers)}`).toBe(`${p.scheme}${p.real}`)
        expect(mine().length).toBeGreaterThan(0)
      })

      it('(b) nunca recibe el centinela (ni en cabeceras ni en la URL) ni la clave en el cuerpo', () => {
        for (const h of seen.filter((s) => p.match(s.path))) {
          const blob = JSON.stringify(h.headers) + h.path
          expect(blob).not.toContain('sandboxed-placeholder')
          expect(h.body).not.toContain('sandboxed-placeholder')
          expect(h.body).not.toContain(p.real)
        }
      })

      it('(d) la respuesta del modelo falso llega a la sesión', () => {
        expect(results[p.id].error, results[p.id].raw).toBe('')
        expect(results[p.id].text).toContain(p.reply)
      })
    })
  }

  it('(c) el entorno/argumentos del servidor aislado (ps eww) no contienen ninguna clave real; sí el override de baseURL', () => {
    expect(envDump).toContain('OPENCODE_AUTH_CONTENT')
    expect(envDump).toContain('sandboxed-placeholder')
    expect(envDump).toContain('OPENCODE_CONFIG_CONTENT')
    for (const p of PROVIDERS) expect(envDump, p.id).not.toContain(p.real)
  })

  it('el servidor nunca vio una petición de un proveedor sin clave (solo las tres rutas esperadas)', () => {
    for (const s of seen)
      expect(
        PROVIDERS.some((p) => p.match(s.path)),
        s.path
      ).toBe(true)
  })
})
