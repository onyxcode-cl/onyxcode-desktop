/**
 * Puerta de main para los conectores de la persona con «preguntar cada herramienta»: misma protección que `equipo` más «Permitir en esta
 * tarea» (esa herramienta, en memoria, hasta cerrar la tarea). Nunca «siempre».
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectorApprovalRequest, ConnectorDecision } from '@shared/ipc-tasks'
import {
  CONNECTOR_COOLDOWN_MS,
  CONNECTOR_MAX_ARGS_CHARS,
  CONNECTOR_PAUSE_MS,
  CONNECTOR_TEXTS,
  cancelAllConnectorApprovals,
  connectorApprovalDetail,
  createConnectorGate,
  initConnectorApprovals,
  pendingConnectorApprovals,
  requestConnectorApproval,
  resetConnectorGatesForTests,
  respondConnectorApproval,
  type ConnectorOutcome
} from './connector-approvals'

let cards: ConnectorApprovalRequest[]
let done: string[]
let clock: number
const sig = (): AbortSignal => new AbortController().signal

beforeEach(() => {
  cards = []
  done = []
  clock = 1_000_000
  resetConnectorGatesForTests()
  initConnectorApprovals({ hasVisibleHost: () => true, broadcast: (r) => cards.push(r), broadcastDone: (id) => done.push(id) })
})
afterEach(() => {
  cancelAllConnectorApprovals()
  initConnectorApprovals(null)
})

/** Puerta cuya «persona» responde con lo que diga `answers` (en orden). */
function gateWith(answers: ConnectorOutcome[], seenArgs: string[] = []) {
  return createConnectorGate({
    folder: '/Users/ana/p',
    server: 'gmail',
    now: () => clock,
    audit: () => undefined,
    approve: async (input) => {
      seenArgs.push(input.args)
      return answers.shift() ?? 'no-answer'
    }
  })
}

describe('createConnectorGate', () => {
  it('«No», sin respuesta y «Permitir esta vez» (que vuelve a preguntar la próxima)', async () => {
    const asked: string[] = []
    const g = gateWith(['deny', 'no-answer', 'allow', 'deny'], asked)
    expect(await g({ tool: 'send', args: { to: 'a' } }, sig())).toEqual({ ok: false, message: CONNECTOR_TEXTS.denied })
    clock += CONNECTOR_COOLDOWN_MS + 1
    expect(await g({ tool: 'send', args: {} }, sig())).toEqual({ ok: false, message: CONNECTOR_TEXTS.noAnswer })
    clock += CONNECTOR_COOLDOWN_MS + 1
    expect(await g({ tool: 'send', args: {} }, sig())).toEqual({ ok: true })
    expect(await g({ tool: 'send', args: {} }, sig())).toMatchObject({ ok: false })
    expect(asked).toHaveLength(4)
    expect(asked[0]).toBe('{\n  "to": "a"\n}')
  })

  it('«Permitir en esta tarea» vale solo para ESA herramienta y solo en esa puerta (la de la tarea abierta)', async () => {
    const asked: string[] = []
    const g = gateWith(['task'], asked)
    expect(await g({ tool: 'list_emails', args: {} }, sig())).toEqual({ ok: true })
    expect(await g({ tool: 'list_emails', args: { q: 'x' } }, sig())).toEqual({ ok: true })
    expect(asked).toHaveLength(1)
    // Otra herramienta del mismo conector: pregunta.
    expect(await g({ tool: 'send_email', args: {} }, sig())).toMatchObject({ ok: false })
    expect(asked).toHaveLength(2)
    // La tarea se cerró y se abrió otra vez (puerta nueva): vuelve a preguntar.
    clock += CONNECTOR_COOLDOWN_MS + 1
    const asked2: string[] = []
    const g2 = gateWith(['deny'], asked2)
    expect(await g2({ tool: 'list_emails', args: {} }, sig())).toMatchObject({ ok: false })
    expect(asked2).toHaveLength(1)
  })

  it('enfriamiento de 30 s tras un «No» y pausa de 10 min tras 3 «No» seguidos, por carpeta y conector', async () => {
    const asked: string[] = []
    const g = gateWith(['deny', 'deny', 'deny', 'allow'], asked)
    await g({ tool: 'send', args: {} }, sig())
    const cool = await g({ tool: 'send', args: {} }, sig())
    expect(cool).toMatchObject({ ok: false })
    expect((cool as { message: string }).message).toMatch(/Espera \d+ s/)
    expect(asked).toHaveLength(1)
    clock += CONNECTOR_COOLDOWN_MS + 1
    await g({ tool: 'send', args: {} }, sig())
    clock += CONNECTOR_COOLDOWN_MS + 1
    const third = await g({ tool: 'send', args: {} }, sig())
    expect((third as { message: string }).message).toContain(CONNECTOR_TEXTS.pauseHead)
    clock += CONNECTOR_COOLDOWN_MS + 1
    // Una puerta nueva (tarea reiniciada) sigue en pausa.
    const again = await gateWith(['allow'])({ tool: 'send', args: {} }, sig())
    expect((again as { message: string }).message).toContain(CONNECTOR_TEXTS.pauseHead)
    clock += CONNECTOR_PAUSE_MS
    expect(await g({ tool: 'send', args: {} }, sig())).toEqual({ ok: true })
  })

  it('una llamada mientras otra espera: «ocupado» (no se apilan tarjetas)', async () => {
    let release: ((o: ConnectorOutcome) => void) | undefined
    let n = 0
    const g = createConnectorGate({
      folder: '/p',
      server: 's',
      audit: () => undefined,
      approve: () => {
        n++
        return new Promise((r) => (release = r))
      }
    })
    const first = g({ tool: 't', args: {} }, sig())
    expect(await g({ tool: 't', args: {} }, sig())).toEqual({ ok: false, message: CONNECTOR_TEXTS.busy })
    release?.('allow')
    expect(await first).toEqual({ ok: true })
    expect(n).toBe(1)
  })

  it('argumentos demasiado largos: no se pregunta ni se envía; los invisibles se muestran como \\u{XXXX}', async () => {
    const asked: string[] = []
    const g = gateWith(['deny'], asked)
    expect(await g({ tool: 't', args: { x: 'a'.repeat(CONNECTOR_MAX_ARGS_CHARS) } }, sig())).toEqual({
      ok: false,
      message: CONNECTOR_TEXTS.tooLong
    })
    expect(asked).toEqual([])
    await g({ tool: 't', args: { x: 'pagar a⁦ Ana⁩' } }, sig())
    expect(asked[0]).toContain('\\u{2066}')
    expect(asked[0]).not.toContain('⁦')
  })

  it('con la señal ya abortada al aprobarse, no se reenvía', async () => {
    const c = new AbortController()
    const g = createConnectorGate({
      folder: '/p',
      server: 's',
      audit: () => undefined,
      approve: async () => {
        c.abort()
        return 'allow'
      }
    })
    expect(await g({ tool: 't', args: {} }, c.signal)).toEqual({ ok: false, message: CONNECTOR_TEXTS.noAnswer })
  })
})

describe('requestConnectorApproval', () => {
  const input = { folder: '/Users/ana/p', server: 'gmail', tool: 'send', args: '{}' }

  it('tarjeta con los datos; responde por id; «en esta tarea» se distingue; detalle para el celular', async () => {
    const p = requestConnectorApproval(input)
    expect(cards[0]).toMatchObject(input)
    expect(connectorApprovalDetail(cards[0]!.id)).toEqual(['gmail · send', '{}', '/Users/ana/p'])
    expect(pendingConnectorApprovals()).toHaveLength(1)
    respondConnectorApproval(cards[0]!.id, 'task')
    await expect(p).resolves.toBe('task')
    expect(done).toEqual([cards[0]!.id])
    expect(respondConnectorApproval(cards[0]!.id, 'allow')).toBe(false)
  })

  it('vence denegando; la señal abortada también; sin inicializar no pregunta', async () => {
    await expect(requestConnectorApproval(input, { timeoutMs: 20 })).resolves.toBe('no-answer')
    const c = new AbortController()
    const p = requestConnectorApproval(input, { signal: c.signal })
    c.abort()
    await expect(p).resolves.toBe('no-answer')
    initConnectorApprovals(null)
    await expect(requestConnectorApproval(input)).resolves.toBe('no-answer')
  })

  it('sin ventana: diálogo nativo; «abrir la app» no decide, y se cierra (señal) al responder en la tarjeta', async () => {
    let dialogSignal: AbortSignal | undefined
    initConnectorApprovals({
      hasVisibleHost: () => false,
      broadcast: (r) => cards.push(r),
      broadcastDone: () => undefined,
      fallback: async (_r, s): Promise<ConnectorDecision | 'open' | null> => {
        dialogSignal = s
        return 'open'
      }
    })
    const p = requestConnectorApproval(input)
    await new Promise((r) => setTimeout(r, 0))
    expect(pendingConnectorApprovals()).toHaveLength(1)
    respondConnectorApproval(cards[0]!.id, 'deny')
    await expect(p).resolves.toBe('deny')
    expect(dialogSignal?.aborted).toBe(true)
  })
})
