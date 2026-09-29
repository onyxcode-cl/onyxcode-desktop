/**
 * Agrupar deltas por frame (F7-B43): aplicar las trazas evento por evento (sin cola) o con la cola de deltas
 * vaciada en lotes de cualquier tamaño debe dejar EXACTAMENTE el mismo estado final, en `useSessions` y en `useCode`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chatSimple } from './fixtures/traces/chat-simple'
import { codeSubagent } from './fixtures/traces/code-subagent'
import { reconnect } from './fixtures/traces/reconnect'
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  resetEventIds,
  sessionCreated,
  statusBusy,
  statusIdle,
  textPart,
  userMessage,
  type TraceEvent
} from './fixtures/events'

vi.mock('../renderer/src/lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const traces: Record<string, { events: TraceEvent[]; directory: string }> = {
  'chat-simple': { events: chatSimple, directory: '/work/chat' },
  'code-subagent': { events: codeSubagent, directory: '/work/code' },
  reconnect: { events: reconnect, directory: '/work/reconnect' }
}

/** PRNG determinista (mulberry32). */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tamaños de lote: fijo, o aleatorio entre 1 y `max` con semilla. */
function plan(kind: number | { seed: number; max: number }): () => number {
  if (typeof kind === 'number') return () => kind
  const r = rng(kind.seed)
  return () => 1 + Math.floor(r() * kind.max)
}
const PLANS: Array<number | { seed: number; max: number }> = [
  1,
  2,
  3,
  5,
  1000,
  ...Array.from({ length: 15 }, (_, i) => ({ seed: i + 1, max: 6 }))
]

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

/** Programador manual: el «frame» se dispara con `frame()`. */
async function manualFrames(): Promise<{ frame: () => void; pending: () => boolean }> {
  const fq = await import('../renderer/src/lib/frame-queue')
  let cb: (() => void) | null = null
  fq.setFrameScheduler((run) => {
    cb = run
  })
  return {
    frame: () => {
      const c = cb
      cb = null
      c?.()
    },
    pending: () => cb !== null
  }
}

type Snap = Record<string, unknown>
type Runner = (
  events: TraceEvent[],
  batch: (() => number) | null,
  extra?: (i: number, touch: (id: string) => void) => void
) => Promise<Snap>

/** Aplica `events` a `useSessions`; `batch=null` = sin cola (síncrono); si no, un frame cada `batch()` eventos. */
const runSessions: Runner = async (events, batch, extra) => {
  const frames = batch ? await manualFrames() : null
  const { useSessions } = await import('../renderer/src/stores/sessions')
  let left = batch?.() ?? 0
  events.forEach(({ event }, i) => {
    useSessions.getState().applyEvent(event)
    extra?.(i, (id) => useSessions.getState().touchSession(id))
    if (frames && --left <= 0) {
      frames.frame()
      left = batch!()
    }
  })
  frames?.frame()
  const s = useSessions.getState()
  return { messages: s.messages, status: s.status, errors: s.errors, sessions: s.sessions, loaded: s.loaded }
}

const runCode =
  (directory: string): Runner =>
  async (events, batch, extra) => {
    const frames = batch ? await manualFrames() : null
    const { useCode } = await import('../renderer/src/features/code/impl/store')
    useCode.setState({ directory })
    let left = batch?.() ?? 0
    events.forEach(({ event, directory: dir }, i) => {
      useCode.getState().applyEvent(event, dir)
      extra?.(i, (id) => useCode.getState().touchSession(id))
      if (frames && --left <= 0) {
        frames.frame()
        left = batch!()
      }
    })
    frames?.frame()
    const s = useCode.getState()
    return { messages: s.messages, runState: s.runState, errors: s.errors, sessions: s.sessions, unread: s.unread, fsVersion: s.fsVersion }
  }

describe.each(Object.keys(traces))('traza %s: lotes == evento por evento', (name) => {
  const { events, directory } = traces[name]
  for (const [label, run] of [
    ['useSessions', runSessions],
    ['useCode', runCode(directory)]
  ] as Array<[string, Runner]>) {
    it(`${label}: estado final idéntico con lotes fijos y aleatorios`, async () => {
      const reference = await run(events, null)
      for (const p of PLANS) {
        vi.resetModules()
        localStorage.clear()
        expect(await run(events, plan(p))).toEqual(reference)
      }
    })
  }
})

// ── Trazas sintéticas: deltas huérfanos, texto largo y desalojo a mitad del lote ─────────────────────────
const D = '/work/batch'
const sess = (id: string): TraceEvent => sessionCreated(makeSession(id, D))

function longTrace(): TraceEvent[] {
  resetEventIds()
  const S = 'ses_b1'
  const ref = (part: string): { sessionID: string; messageID: string; partID: string } => ({
    sessionID: S,
    messageID: 'msg_002',
    partID: part
  })
  const out: TraceEvent[] = [
    sess(S),
    msgUpdated(userMessage('msg_001', S), D),
    statusBusy(S, D),
    // delta ANTES que su parte y antes que su mensaje (huérfano)
    partDelta({ ...ref('prt_early'), delta: 'A' }, D),
    partDelta({ ...ref('prt_early'), delta: 'B' }, D),
    msgUpdated(assistantMessage('msg_002', S, { parentID: 'msg_001' }), D),
    partUpdated(textPart('prt_early', 'msg_002', S, ''), D),
    partUpdated(textPart('prt_a', 'msg_002', S, ''), D),
    partUpdated(textPart('prt_b', 'msg_002', S, ''), D)
  ]
  for (let i = 0; i < 60; i++) {
    out.push(partDelta({ ...ref(i % 3 === 0 ? 'prt_b' : 'prt_a'), delta: `t${i} ` }, D))
    if (i % 17 === 5) out.push(partUpdated(textPart('prt_b', 'msg_002', S, `reset${i}`), D))
    if (i % 23 === 7) out.push(partDelta({ ...ref('prt_never'), delta: `x${i}` }, D)) // nunca llega su parte
  }
  out.push(msgUpdated(assistantMessage('msg_002', S, { parentID: 'msg_001', finish: 'stop' }), D), statusIdle(S, D))
  return out
}

describe('trazas sintéticas', () => {
  it('deltas huérfanos y texto largo: idéntico con cualquier tamaño de lote', async () => {
    const events = longTrace()
    for (const [label, run] of [
      ['useSessions', runSessions],
      ['useCode', runCode(D)]
    ] as Array<[string, Runner]>) {
      const reference = await run(events, null)
      const text = JSON.stringify(reference.messages)
      expect(text).toContain('AB') // el delta huérfano se aplicó en orden (comprueba que la referencia no es vacía)
      for (const p of PLANS) {
        vi.resetModules()
        localStorage.clear()
        expect(await run(events, plan(p)), `${label} plan ${JSON.stringify(p)}`).toEqual(reference)
      }
    }
  })

  it('un mensaje que se desaloja a mitad del lote: mismo resultado que uno a uno', async () => {
    resetEventIds()
    const mk = (S: string): TraceEvent[] => [
      sess(S),
      msgUpdated(assistantMessage(`msg_${S}`, S, { parentID: 'x' }), D),
      partUpdated(textPart(`prt_${S}`, `msg_${S}`, S, ''), D)
    ]
    const d = (S: string, t: string): TraceEvent => partDelta({ sessionID: S, messageID: `msg_${S}`, partID: `prt_${S}`, delta: t }, D)
    // A recibe deltas; se abre B (touch = desalojo con tope 1: A sale) y siguen llegando deltas de A (ya desalojada).
    const events = [...mk('A'), ...mk('B'), d('A', 'a1'), d('A', 'a2'), d('B', 'b1'), d('A', 'a3'), d('B', 'b2')]
    const at = 8 // índice de d('B','b1'): justo después se abre B
    for (const [label, run] of [
      ['useSessions', runSessions],
      ['useCode', runCode(D)]
    ] as Array<[string, Runner]>) {
      const go = (batch: (() => number) | null): Promise<Snap> => {
        vi.resetModules()
        localStorage.clear()
        localStorage.setItem('onyx.lru.max', '1')
        return run(events, batch, (i, touch) => {
          if (i === at) touch('B')
        })
      }
      const reference = await go(null)
      expect(Object.keys(reference.messages as object), label).toEqual(['B']) // A se desalojó
      expect(JSON.stringify(reference.messages)).toContain('b1b2')
      for (const p of PLANS) expect(await go(plan(p)), `${label} plan ${JSON.stringify(p)}`).toEqual(reference)
    }
  })
})

describe('cola de deltas por frame', () => {
  const S = 'ses_q'
  const setup = async (): Promise<{
    frames: Awaited<ReturnType<typeof manualFrames>>
    m: typeof import('../renderer/src/stores/sessions')
  }> => {
    resetEventIds()
    const frames = await manualFrames()
    const m = await import('../renderer/src/stores/sessions')
    for (const t of [
      sess(S),
      msgUpdated(assistantMessage('msg_q', S, { parentID: 'x' }), D),
      partUpdated(textPart('prt_q', 'msg_q', S, ''), D)
    ]) {
      m.useSessions.getState().applyEvent(t.event)
    }
    return { frames, m }
  }
  const text = (m: typeof import('../renderer/src/stores/sessions')): unknown =>
    (m.useSessions.getState().messages[S][0].parts[0] as { text: string }).text
  const d = (t: string, id?: string): TraceEvent => partDelta({ sessionID: S, messageID: 'msg_q', partID: 'prt_q', delta: t }, D, id)

  it('N deltas = UN solo set, en el frame', async () => {
    const { frames, m } = await setup()
    let sets = 0
    const off = m.useSessions.subscribe(() => sets++)
    for (let i = 0; i < 50; i++) m.useSessions.getState().applyEvent(d('x').event)
    expect(sets).toBe(0)
    expect(text(m)).toBe('')
    frames.frame()
    off()
    expect(sets).toBe(1)
    expect(text(m)).toBe('x'.repeat(50))
  })

  it('un evento que no es delta vacía la cola antes (orden con part.updated)', async () => {
    const { frames, m } = await setup()
    const api = m.useSessions.getState()
    api.applyEvent(d('viejo ').event)
    api.applyEvent(partUpdated(textPart('prt_q', 'msg_q', S, 'reemplazo '), D).event) // llega DESPUÉS del delta
    api.applyEvent(d('nuevo').event)
    expect(text(m)).toBe('reemplazo ') // el delta previo ya se aplicó antes del reemplazo
    frames.frame()
    expect(text(m)).toBe('reemplazo nuevo')
  })

  it('dedupe por event.id al encolar', async () => {
    const { frames, m } = await setup()
    const api = m.useSessions.getState()
    api.applyEvent(d('a', 'dup_1').event)
    api.applyEvent(d('a', 'dup_1').event)
    frames.frame()
    expect(text(m)).toBe('a')
  })

  it('loadMessages vacía la cola antes de fusionar y no duplica lo que el snapshot ya trae', async () => {
    const { frames, m } = await setup()
    const api = m.useSessions.getState()
    let resolve!: (v: unknown) => void
    const client = { session: { messages: () => new Promise((r) => (resolve = r)) } } as never
    const load = api.loadMessages(client, S, D)
    api.applyEvent(d('uno ').event)
    api.applyEvent(d('dos').event) // aún en la cola cuando llega el snapshot
    resolve({
      data: [{ info: assistantMessage('msg_q', S, { parentID: 'x' }), parts: [textPart('prt_q', 'msg_q', S, 'uno ')] }]
    })
    await load
    expect(text(m)).toBe('uno dos') // el snapshot ya incluía «uno »: sin duplicar; «dos» se conserva
    frames.frame()
    expect(text(m)).toBe('uno dos')
  })

  it('removeSession vacía la cola: un delta pendiente no resucita la sesión', async () => {
    const { frames, m } = await setup()
    const api = m.useSessions.getState()
    api.applyEvent(d('zzz').event)
    api.removeSession(S)
    frames.frame()
    expect(m.useSessions.getState().messages[S]).toBeUndefined()
  })
})
