/**
 * La aprobación de `equipo` la pide y la decide MAIN (no el motor, que vive en la jaula con los programas de la tarea).
 * Servidor MCP real en proceso + módulo de aprobaciones real; lo único simulado es quién ejecuta el comando y quién responde la tarjeta.
 * Cubre: llamada directa con token válido y nadie responde → no ejecuta y vence denegando; «No»; «Permitir esta vez» (una sola vez,
 * el comando exacto); concurrencia («ocupado», sin apilar tarjetas); petición cortada; tarea terminada mientras se pregunta.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HOST_APPROVAL_TIMEOUT_MS,
  cancelAllHostApprovals,
  hostApprovalDetail,
  initHostApprovals,
  pendingHostApprovals,
  requestHostApproval,
  respondHostApproval,
  type HostApprovalRequest,
  type HostDecision
} from './approvals'
import {
  COOLDOWN_AFTER_NO_MS,
  DENIED_TEXT,
  HostExecMcpServer,
  NO_ANSWER_TEXT,
  PAUSE_MS,
  PAUSE_TEXT_HEAD,
  type AuditEntry
} from './mcp-server'
import { MAX_TIMEOUT_MS, type BackgroundResult, type RunResult } from './runner'

const OK: RunResult = { exitCode: 0, signal: null, stdout: 'hecho\n', stderr: '', truncated: false, timedOut: false, ms: 5 }
const SECRET = 'nbx_live_4f9a21c7'

let folder: string
let server: HostExecMcpServer
let audits: AuditEntry[]
let ran: Array<{ command: string; cwd?: string; timeoutMs?: number }>
let started: string[]
let cards: HostApprovalRequest[]
let done: string[]
let visible: boolean
let fallback: ((req: HostApprovalRequest) => Promise<HostDecision | null>) | undefined
let approvalTimeoutMs: number
let clock: number

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'lzx-equipo-aprob-'))
  audits = []
  ran = []
  started = []
  cards = []
  done = []
  visible = true
  fallback = undefined
  approvalTimeoutMs = 10_000
  clock = 1_000_000
  initHostApprovals({
    hasVisibleHost: () => visible,
    broadcast: (r) => cards.push(r),
    broadcastDone: (id) => done.push(id),
    fallback: (r) => (fallback ? fallback(r) : new Promise<never>(() => undefined))
  })
  server = new HostExecMcpServer({
    audit: (e) => audits.push(e),
    now: () => clock,
    redact: (_f, text) => text.split(SECRET).join('«API_KEY»'),
    approve: (req, signal) => requestHostApproval(req, { signal, timeoutMs: approvalTimeoutMs }),
    run: async (command, o) => {
      ran.push({ command, cwd: o?.cwd, timeoutMs: o?.timeoutMs })
      return OK
    },
    start: async (command) => {
      started.push(command)
      const r: BackgroundResult = { ...OK, pid: 4242, running: true }
      return r
    }
  })
})
afterEach(async () => {
  cancelAllHostApprovals()
  initHostApprovals(null)
  await server.stop()
  rmSync(folder, { recursive: true, force: true })
})

interface Resp {
  status: number
  body: any
}

function post(port: number, token: string, body: unknown, onReq?: (abort: () => void) => void): Promise<Resp> {
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), authorization: `Bearer ${token}` }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }))
      }
    )
    req.on('error', reject)
    req.end(payload)
    onReq?.(() => req.destroy())
  })
}

const call = (port: number, token: string, args: Record<string, unknown>, name = 'ejecutar') =>
  post(port, token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
const textOf = (r: Resp): string => r.body.result.content[0].text
const COMMAND = `open "/Users/ben/Documents/prueba con espacios/guía.pdf" && echo ${SECRET}`
const good = { comando: COMMAND, motivo: 'Abrir el PDF que me pediste con su programa.' }

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('tiempo agotado esperando la condición')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('equipo: la aprobación la decide main', () => {
  it('(a) llamada directa con token válido y nadie responde: no ejecuta nada y vence denegando', async () => {
    approvalTimeoutMs = 150
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, good)
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toBe(NO_ANSWER_TEXT)
    expect(ran).toEqual([])
    expect(started).toEqual([])
    expect(cards).toHaveLength(1)
    expect(done).toEqual([cards[0]!.id])
    expect(pendingHostApprovals()).toEqual([])
    expect(audits.at(-1)).toMatchObject({ tool: 'ejecutar', result: 'rechazado', approval: 'sin-respuesta' })
  })

  it('(a) sin quien pregunte (aprobaciones sin inicializar o sin `approve`): no ejecuta (falla cerrado)', async () => {
    initHostApprovals(null)
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, good)
    expect(textOf(r)).toBe(NO_ANSWER_TEXT)
    const bare = new HostExecMcpServer({ run: async () => (ran.push({ command: 'x' }), OK), audit: () => undefined })
    try {
      const c = await bare.clientFor({ folder })
      expect((await call(c.port, c.token, good)).body.result.isError).toBe(true)
    } finally {
      await bare.stop()
    }
    expect(ran).toEqual([])
  })

  it('la tarjeta muestra el comando REAL completo, el motivo, la carpeta y las opciones; el registro va tapado', async () => {
    const { token, port } = await server.clientFor({ folder })
    const pending = call(port, token, { ...good, tiempo_s: 42 })
    await waitFor(() => cards.length === 1)
    expect(cards[0]).toMatchObject({ command: COMMAND, reason: good.motivo, folder, background: false, timeoutS: 42 })
    expect(hostApprovalDetail(cards[0]!.id)).toEqual([COMMAND, good.motivo, folder])
    respondHostApproval(cards[0]!.id, 'deny')
    await pending
    expect(JSON.stringify(audits)).not.toContain(SECRET)
  })

  it('(b) «No»: no ejecuta y el agente recibe un texto claro, sin invitar a reintentar', async () => {
    const { token, port } = await server.clientFor({ folder })
    const pending = call(port, token, good)
    await waitFor(() => cards.length === 1)
    respondHostApproval(cards[0]!.id, 'deny')
    const r = await pending
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toBe(DENIED_TEXT)
    expect(textOf(r)).toContain('La persona no aprobó este comando.')
    expect(textOf(r).toLowerCase()).not.toMatch(/vuelve a intentar|reintenta|inténtalo de nuevo/)
    expect(ran).toEqual([])
    expect(audits.at(-1)).toMatchObject({ result: 'rechazado', approval: 'rechazado' })
  })

  it('(c) «Permitir esta vez»: ejecuta exactamente ese comando una vez; la segunda llamada idéntica vuelve a preguntar', async () => {
    const { token, port } = await server.clientFor({ folder })
    const first = call(port, token, { ...good, tiempo_s: 30 })
    await waitFor(() => cards.length === 1)
    expect(ran).toEqual([])
    respondHostApproval(cards[0]!.id, 'allow')
    const r1 = await first
    expect(r1.body.result.isError).toBeUndefined()
    expect(ran).toEqual([{ command: COMMAND, cwd: folder, timeoutMs: 30_000 }])
    expect(audits.at(-1)).toMatchObject({ result: 'ok', approval: 'aprobado' })
    // Responder otra vez a la misma tarjeta no hace nada (no es un vale reutilizable).
    expect(respondHostApproval(cards[0]!.id, 'allow')).toBe(false)

    const second = call(port, token, { ...good, tiempo_s: 30 })
    await waitFor(() => cards.length === 2)
    expect(cards[1]!.id).not.toBe(cards[0]!.id)
    expect(ran).toHaveLength(1)
    respondHostApproval(cards[1]!.id, 'deny')
    expect(textOf(await second)).toBe(DENIED_TEXT)
    expect(ran).toHaveLength(1)
  })

  it('(c) segundo plano también pregunta, y solo lanza tras «Permitir esta vez»', async () => {
    const { token, port } = await server.clientFor({ folder })
    const p = call(port, token, { comando: 'python3 app.py', motivo: 'Levantar la app para probarla.', segundo_plano: true })
    await waitFor(() => cards.length === 1)
    expect(cards[0]!.background).toBe(true)
    expect(started).toEqual([])
    respondHostApproval(cards[0]!.id, 'allow')
    expect(textOf(await p)).toContain('pid 4242')
    expect(started).toEqual(['python3 app.py'])
  })

  it('(d) mientras se pregunta, otra llamada de la misma carpeta se rechaza como ocupada y no abre otra tarjeta', async () => {
    const { token, port } = await server.clientFor({ folder })
    const first = call(port, token, good)
    await waitFor(() => cards.length === 1)
    const second = await call(port, token, { ...good, comando: 'open "/Users/ben/otra.pdf"' })
    expect(second.body.result.isError).toBe(true)
    expect(textOf(second)).toContain('otro comando en curso')
    expect(cards).toHaveLength(1)
    respondHostApproval(cards[0]!.id, 'allow')
    await first
    expect(ran.map((x) => x.command)).toEqual([COMMAND])
  })

  it('si la petición MCP se corta mientras se pregunta: se deniega, se cierra la tarjeta y no se ejecuta', async () => {
    const { token, port } = await server.clientFor({ folder })
    let abort: (() => void) | undefined
    const p = post(
      port,
      token,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ejecutar', arguments: good } },
      (a) => (abort = a)
    )
    p.catch(() => undefined)
    await waitFor(() => cards.length === 1)
    abort?.()
    await waitFor(() => done.includes(cards[0]!.id))
    expect(respondHostApproval(cards[0]!.id, 'allow')).toBe(false)
    await waitFor(() => audits.some((a) => a.approval === 'sin-respuesta'))
    expect(ran).toEqual([])
  })

  it('si la tarea termina (token revocado) mientras se pregunta: se deniega y no se ejecuta', async () => {
    const { token, port } = await server.clientFor({ folder })
    const p = call(port, token, good)
    await waitFor(() => cards.length === 1)
    server.revokeToken(token)
    expect(textOf(await p)).toBe(NO_ANSWER_TEXT)
    expect(done).toContain(cards[0]!.id)
    expect(ran).toEqual([])
  })

  it('sin ventana visible: diálogo nativo; cerrarlo sin elegir cuenta como «No»', async () => {
    visible = false
    fallback = async () => null
    const { token, port } = await server.clientFor({ folder })
    expect(textOf(await call(port, token, good))).toBe(DENIED_TEXT)
    clock += COOLDOWN_AFTER_NO_MS + 1
    fallback = async () => 'allow'
    expect((await call(port, token, good)).body.result.isError).toBeUndefined()
    expect(ran).toHaveLength(1)
  })

  it('(C3) tras un «No», 30 s sin tarjetas; tras 3 «No» seguidos, pausa de 10 min; todo por CARPETA (un token nuevo no lo borra)', async () => {
    let c = await server.clientFor({ folder })
    const deny = async (): Promise<Resp> => {
      const p = call(c.port, c.token, good)
      await waitFor(() => cards.length > shownBefore)
      respondHostApproval(cards.at(-1)!.id, 'deny')
      return p
    }
    let shownBefore = 0
    await deny()
    // Enfriamiento: rechazo inmediato, sin tarjeta.
    shownBefore = cards.length
    const cool = await call(c.port, c.token, good)
    expect(textOf(cool)).toMatch(/Espera \d+ s/)
    expect(cards).toHaveLength(shownBefore)
    // Reiniciar el motor (token nuevo de la misma carpeta) no lo salta.
    c = await server.clientFor({ folder })
    expect(textOf(await call(c.port, c.token, good))).toMatch(/Espera/)
    clock += COOLDOWN_AFTER_NO_MS + 1
    shownBefore = cards.length
    await deny()
    clock += COOLDOWN_AFTER_NO_MS + 1
    shownBefore = cards.length
    const third = await deny()
    expect(textOf(third)).toContain(PAUSE_TEXT_HEAD)
    clock += COOLDOWN_AFTER_NO_MS + 1
    shownBefore = cards.length
    const paused = await call(c.port, c.token, good)
    expect(textOf(paused)).toContain(PAUSE_TEXT_HEAD)
    expect(textOf(paused)).toContain('Deja de pedirlos')
    expect(cards).toHaveLength(shownBefore)
    expect(ran).toEqual([])
    clock += PAUSE_MS
    const after = call(c.port, c.token, good)
    await waitFor(() => cards.length > shownBefore)
    respondHostApproval(cards.at(-1)!.id, 'allow')
    expect((await after).body.result.isError).toBeUndefined()
    expect(ran).toHaveLength(1)
  })

  it('(C3) un «Permitir» corta la racha de «No»', async () => {
    const c = await server.clientFor({ folder })
    const answer = async (d: HostDecision): Promise<void> => {
      const n = cards.length
      const p = call(c.port, c.token, good)
      await waitFor(() => cards.length > n)
      respondHostApproval(cards.at(-1)!.id, d)
      await p
      clock += COOLDOWN_AFTER_NO_MS + 1
    }
    await answer('deny')
    await answer('deny')
    await answer('allow')
    await answer('deny')
    await answer('deny')
    const n = cards.length
    const p = call(c.port, c.token, good)
    await waitFor(() => cards.length > n)
    respondHostApproval(cards.at(-1)!.id, 'deny')
    expect(textOf(await p)).toContain(PAUSE_TEXT_HEAD)
  })

  it('(B1) un motivo con caracteres invisibles o de dirección no abre tarjeta', async () => {
    const c = await server.clientFor({ folder })
    for (const motivo of ['Abrir el informe \u2066pedido\u2069', 'Abrir el informe\rpedido', 'Abrir\u00A0el informe']) {
      const r = await call(c.port, c.token, { comando: good.comando, motivo })
      expect(r.body.result.isError).toBe(true)
      expect(textOf(r)).toContain('motivo')
    }
    expect(cards).toEqual([])
  })

  it('(C1) rutina sin nadie mirando: se niega al momento, sin tarjeta ni espera, y se anota en la rutina', async () => {
    const notes: Array<{ permission: string; detail: string }> = []
    const s = new HostExecMcpServer({
      audit: () => undefined,
      approve: (req, signal) => requestHostApproval(req, { signal }),
      run: async () => (
        ran.push({ command: 'x' }),
        { exitCode: 0, signal: null, stdout: '', stderr: '', truncated: false, timedOut: false, ms: 1 }
      ),
      unattended: (f) => (f === folder ? (w) => notes.push(w) : null)
    })
    try {
      const c = await s.clientFor({ folder })
      const t0 = Date.now()
      const r = await call(c.port, c.token, good)
      expect(Date.now() - t0).toBeLessThan(2000)
      expect(textOf(r)).toContain('necesita que la persona esté presente')
      expect(cards).toEqual([])
      expect(ran).toEqual([])
      expect(notes).toHaveLength(1)
      expect(notes[0]!.permission).toBe('equipo_ejecutar')
    } finally {
      await s.stop()
    }
  })

  it('`detener` no pregunta y solo detiene lo lanzado por esa misma carpeta', async () => {
    const { token, port } = await server.clientFor({ folder })
    const r = await call(port, token, { pid: 1 }, 'detener')
    expect(r.body.result.isError).toBe(true)
    expect(textOf(r)).toContain('no es un comando en segundo plano de esta tarea')
    expect(cards).toEqual([])
  })

  it('el motor y el proxy esperan lo bastante: aprobación + comando + margen', () => {
    const s = new HostExecMcpServer()
    expect(s.responseTimeoutMs()).toBe(HOST_APPROVAL_TIMEOUT_MS + MAX_TIMEOUT_MS + 15_000)
  })
})

describe('approvals.ts', () => {
  it('cada petición es una tarjeta propia (sin deduplicar) y una id desconocida no hace nada', async () => {
    const a = requestHostApproval({ folder, command: 'ls', reason: 'listar algo', background: false, timeoutS: 60 })
    const b = requestHostApproval({ folder, command: 'ls', reason: 'listar algo', background: false, timeoutS: 60 })
    expect(cards).toHaveLength(2)
    expect(respondHostApproval('ffff', 'allow')).toBe(false)
    respondHostApproval(cards[0]!.id, 'allow')
    respondHostApproval(cards[1]!.id, 'deny')
    await expect(Promise.all([a, b])).resolves.toEqual(['allow', 'deny'])
  })

  it('una señal ya abortada no abre tarjeta', async () => {
    const c = new AbortController()
    c.abort()
    await expect(
      requestHostApproval({ folder, command: 'ls', reason: 'listar algo', background: false, timeoutS: 60 }, { signal: c.signal })
    ).resolves.toBe('no-answer')
    expect(cards).toEqual([])
  })
})
