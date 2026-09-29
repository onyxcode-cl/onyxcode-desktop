/** Traza sintética: prompt de Chat con reasoning, una herramienta y respuesta de texto. */
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  reasoningPart,
  resetEventIds,
  sessionCreated,
  statusBusy,
  statusIdle,
  textPart,
  toolPart,
  userMessage,
  type TraceEvent
} from '../events'

resetEventIds()
const D = '/work/chat'
const S = 'ses_chat1'
const sess = makeSession(S, D, { title: 'Nuevo chat', time: { created: 1000, updated: 1000 } })
const u = userMessage('msg_001', S)
const a = assistantMessage('msg_002', S, { parentID: 'msg_001' })
const ref = (id: string): { sessionID: string; messageID: string; partID: string } => ({ sessionID: S, messageID: 'msg_002', partID: id })

export const chatSimple: TraceEvent[] = [
  sessionCreated(sess),
  msgUpdated(u, D),
  partUpdated(textPart('prt_001', 'msg_001', S, 'Explícame qué hace ls'), D),
  statusBusy(S, D),
  msgUpdated(a, D),
  partUpdated(reasoningPart('prt_002', 'msg_002', S, ''), D),
  partDelta({ ...ref('prt_002'), delta: 'El usuario pregunta ' }, D),
  partDelta({ ...ref('prt_002'), delta: 'por ls.' }, D),
  partUpdated(reasoningPart('prt_002', 'msg_002', S, 'El usuario pregunta por ls.', 1500), D),
  partUpdated(toolPart('prt_003', 'msg_002', S, 'bash', { status: 'pending', input: {}, raw: '' }), D),
  partUpdated(toolPart('prt_003', 'msg_002', S, 'bash', { status: 'running', input: { command: 'ls' }, time: { start: 1600 } }), D),
  partUpdated(
    toolPart('prt_003', 'msg_002', S, 'bash', {
      status: 'completed',
      input: { command: 'ls' },
      output: 'a.txt\nb.txt',
      title: 'ls',
      metadata: {},
      time: { start: 1600, end: 1700 }
    }),
    D
  ),
  partUpdated(textPart('prt_004', 'msg_002', S, ''), D),
  partDelta({ ...ref('prt_004'), delta: '`ls` lista ' }, D),
  partDelta({ ...ref('prt_004'), delta: 'los archivos.' }, D),
  msgUpdated(assistantMessage('msg_002', S, { parentID: 'msg_001', time: { created: 1000, completed: 2000 }, finish: 'stop' }), D),
  statusIdle(S, D)
]
