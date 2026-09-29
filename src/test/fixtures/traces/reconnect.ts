/**
 * Traza sintética: el stream SSE se corta y al reconectar el servidor reenvía eventos ya vistos
 * (mismos `id`). Los últimos cuatro eventos repiten a los anteriores.
 */
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
} from '../events'

resetEventIds()
const D = '/work/reconnect'
const S = 'ses_rc'
const created = sessionCreated(makeSession(S, D))
const busy = statusBusy(S, D)
const msg = msgUpdated(assistantMessage('msg_002', S, { parentID: 'msg_001' }), D)
const part = partUpdated(textPart('prt_002', 'msg_002', S, ''), D)
const d1 = partDelta({ sessionID: S, messageID: 'msg_002', partID: 'prt_002', delta: 'Hola ' }, D)
const d2 = partDelta({ sessionID: S, messageID: 'msg_002', partID: 'prt_002', delta: 'mundo' }, D)

export const reconnect: TraceEvent[] = [
  created,
  msgUpdated(userMessage('msg_001', S), D),
  busy,
  msg,
  part,
  d1,
  d2,
  // --- reconexión: el servidor reenvía los últimos eventos con el mismo id ---
  msg,
  part,
  d1,
  d2,
  statusIdle(S, D)
]
