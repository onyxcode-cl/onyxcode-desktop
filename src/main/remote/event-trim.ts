/**
 * Recorte de eventos hacia el celular (F0-T4): bus IPC (T2) y stream SSE del motor.
 *
 * Denegar por defecto: un canal que `CELULAR_EVENTS` no marca `allow`/`sanitize`, o un tipo de evento del motor que no está
 * en la lista blanca, no sale del Mac. Los eventos de un directorio fuera del ámbito tampoco. Todo pasa por `registry.scrub`
 * (credenciales conocidas) antes de publicarse.
 */
import { eventPolicy } from './policy'
import type { EngineRegistry } from './engine-registry'
import type { EngineKnowledge, ScopeProvider } from './engine-scope'
import { isInsideReal, realpathLoose } from './path-guard'

export interface TrimDeps {
  registry: EngineRegistry
  scope: ScopeProvider
  knowledge: EngineKnowledge
}

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Canales IPC que el celular puede recibir (`allow` o `sanitize`). */
export function remoteEventChannels(channels: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const ch of channels) if (eventPolicy(ch) !== 'deny') out.add(ch)
  return out
}

/** Canales con prioridad de control (permisos y confirmaciones). */
const URGENT_CHANNELS = new Set(['computer:accessRequest', 'browser:approval'])
export const isUrgentChannel = (ch: string): boolean => URGENT_CHANNELS.has(ch)

/**
 * Recorta un evento IPC. `null` = no se envía. Solo se llama con canales ya permitidos por el bus, pero se vuelve a
 * comprobar (el remitente virtual también pasa por aquí).
 */
export function trimIpcEvent(channel: string, payload: unknown, d: TrimDeps): unknown | null {
  const pol = eventPolicy(channel)
  if (pol === 'deny') return null
  let out: unknown
  if (pol === 'allow') out = payload
  else {
    const p = rec(payload)
    switch (channel) {
      case 'opencode:connection':
        out = d.registry.rewriteConnection(payload as Parameters<EngineRegistry['rewriteConnection']>[0])
        break
      case 'tasks:server':
        out = d.scope.pathInScope(p.folder, { chat: false }) ? payload : null
        break
      case 'settings:changed': {
        const { opencodeBin: _drop, recentFolders, ...rest } = p
        void _drop
        out = {
          ...rest,
          ...(Array.isArray(recentFolders) ? { recentFolders: recentFolders.filter((f) => d.scope.pathInScope(f, { chat: false })) } : {})
        }
        break
      }
      case 'files:changed': // relativos a la raíz de una vigilancia creada por este mismo celular
        out = Array.isArray(p.dirs) && p.dirs.some((x) => typeof x !== 'string' || x.startsWith('/') || x.includes('..')) ? null : payload
        break
      case 'computer:accessRequest':
        out = payload
        break
      case 'browser:state':
      case 'browser:approval': {
        const o = rec(p.owner)
        const dir = o.kind === 'code' ? o.directory : o.kind === 'tasks' ? o.folder : undefined
        if (!d.scope.pathInScope(dir, { chat: false })) out = null
        else if (channel === 'browser:approval') {
          const { savePath: _sp, ...rest } = p
          void _sp
          out = rest
        } else out = payload
        break
      }
      default:
        out = null
    }
  }
  if (out === null) return null
  return d.registry.scrub(out)
}

// ─────────────────────────────── eventos del motor (SSE) ───────────────────────────────

/** Tipos de evento del motor que el celular puede recibir (por prefijo o nombre exacto). */
const OC_ALLOWED_PREFIX = ['session.', 'message.', 'permission.', 'question.', 'todo.']
const OC_ALLOWED_EXACT = new Set(['file.edited', 'vcs.branch.updated', 'server.connected', 'global.disposed'])
const OC_URGENT = /^(permission|question)\.asked$/

export const OC_TOOL_OUTPUT_CAP = 4_000

function capString(s: unknown, max: number): unknown {
  return typeof s === 'string' && s.length > max ? `${s.slice(0, max)}…` : s
}

/** Reduce lo voluminoso de una parte de herramienta (la salida completa sigue disponible por `session.messages`). */
function trimParts(props: Record<string, unknown>): Record<string, unknown> {
  const part = rec(props.part)
  if (part.type !== 'tool') return props
  const state = rec(part.state)
  const slim: Record<string, unknown> = { ...state }
  if ('output' in slim) slim.output = capString(slim.output, OC_TOOL_OUTPUT_CAP)
  if ('metadata' in slim && JSON.stringify(slim.metadata ?? null).length > OC_TOOL_OUTPUT_CAP) delete slim.metadata
  if ('raw' in slim) slim.raw = capString(slim.raw, OC_TOOL_OUTPUT_CAP)
  return { ...props, part: { ...part, state: slim } }
}

export interface OcEvent {
  oc: string
  p: { directory: string; id?: string; properties: unknown }
  urgent: boolean
}

/**
 * Evento global del motor (`{directory, payload:{id,type,properties}}`) → evento para el celular, o `null` si no puede
 * salir. `eng` = motor del que viene (los de tarea se acotan además a su carpeta).
 */
export function trimOcEvent(raw: unknown, eng: string, d: TrimDeps): OcEvent | null {
  const ge = rec(raw)
  const payload = rec(ge.payload)
  const type = payload.type
  if (typeof type !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,95}$/.test(type)) return null
  if (!OC_ALLOWED_EXACT.has(type) && !OC_ALLOWED_PREFIX.some((p) => type.startsWith(p))) return null
  const dirRaw = ge.directory
  let directory = 'global'
  if (typeof dirRaw === 'string' && dirRaw !== 'global') {
    const real = realpathLoose(dirRaw)
    if (!real || !d.scope.inScope(real)) return null
    const folder = d.registry.folderOf(eng)
    if (folder !== null) {
      const rf = realpathLoose(folder)
      if (!rf || !isInsideReal(rf, real)) return null
    }
    directory = real
  } else if (eng !== 'main') {
    // Un servidor de tarea no emite eventos «globales» hacia el celular salvo la conexión.
    if (type !== 'server.connected') return null
  }
  let props = rec(payload.properties)
  // Aprendizaje (solo de lo que ya pasó el filtro).
  if (type === 'session.created' || type === 'session.updated') {
    const info = rec(props.info)
    const sd = typeof info.directory === 'string' ? realpathLoose(info.directory) : null
    if (sd && d.scope.inScope(sd)) d.knowledge.learnSession(info.id, sd)
    else if (sd) return null // sesión de otro proyecto: no sale
  }
  if (type === 'session.deleted') d.knowledge.forgetSession(String(rec(props.info).id ?? ''))
  if (type === 'permission.asked') d.knowledge.learnPermission(props.id, props.permission)
  if (type === 'message.part.updated') props = trimParts(props)
  const out: OcEvent = {
    oc: type,
    p: { directory, ...(typeof payload.id === 'string' ? { id: payload.id } : {}), properties: d.registry.scrub(props) },
    urgent: OC_URGENT.test(type)
  }
  return out
}
