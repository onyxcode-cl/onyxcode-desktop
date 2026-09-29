/** Traza sintética: tarea `task` que crea una sesión hija (subagente) y pide un permiso. */
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  permAsked,
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
const D = '/work/code'
const P = 'ses_parent'
const C = 'ses_child'
const parent = makeSession(P, D, { title: 'Refactor' })
const child = makeSession(C, D, { title: 'Explorar (@explore)', parentID: P })

export const codeSubagent: TraceEvent[] = [
  sessionCreated(parent),
  msgUpdated(userMessage('msg_001', P), D),
  partUpdated(textPart('prt_001', 'msg_001', P, 'Busca dónde se usa foo'), D),
  statusBusy(P, D),
  msgUpdated(assistantMessage('msg_002', P, { parentID: 'msg_001' }), D),
  partUpdated(
    toolPart('prt_002', 'msg_002', P, 'task', {
      status: 'running',
      input: { description: 'Buscar foo', subagent_type: 'explore' },
      time: { start: 1100 }
    }),
    D
  ),
  sessionCreated(child),
  statusBusy(C, D),
  msgUpdated(userMessage('msg_101', C), D),
  partUpdated(textPart('prt_101', 'msg_101', C, 'Buscar foo'), D),
  msgUpdated(assistantMessage('msg_102', C, { parentID: 'msg_101', agent: 'explore' }), D),
  permAsked(
    { id: 'per_001', sessionID: C, permission: 'bash', patterns: ['grep -r foo'], tool: { messageID: 'msg_102', callID: 'call_prt_103' } },
    D
  ),
  partUpdated(
    toolPart('prt_103', 'msg_102', C, 'bash', { status: 'running', input: { command: 'grep -r foo' }, time: { start: 1200 } }),
    D
  ),
  partUpdated(textPart('prt_104', 'msg_102', C, ''), D),
  partDelta({ sessionID: C, messageID: 'msg_102', partID: 'prt_104', delta: 'foo se usa en a.ts' }, D),
  statusIdle(C, D),
  partUpdated(
    toolPart('prt_002', 'msg_002', P, 'task', {
      status: 'completed',
      input: { description: 'Buscar foo', subagent_type: 'explore' },
      output: 'foo se usa en a.ts',
      title: 'Buscar foo',
      metadata: { sessionId: C },
      time: { start: 1100, end: 1900 }
    }),
    D
  ),
  statusIdle(P, D)
]
