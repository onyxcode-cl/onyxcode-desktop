/**
 * Lee un turno de una conversación (desde el último mensaje de la persona) y lo reduce a lo que el bot cuenta: los pasos en una línea,
 * la respuesta final y los archivos que se crearon. Funciones puras sobre `EngineMessage[]`.
 *
 * Reutiliza la lógica del trabajo plegado de la pantalla (`@shared/conversation-work`): qué es «trabajo» y qué es «respuesta final»
 * (`segmentWork`), cuánto tardó (`workDurationMs`) y el título («Trabajando… 12 s · 4 pasos»).
 */
import {
  countSteps,
  segmentWork,
  stepLine,
  summarizeSteps,
  workDurationMs,
  workTitle,
  type TimedFacts,
  type WorkRole
} from '@shared/conversation-work'
import { isAbsolute } from 'node:path'
import { detectDocFiles } from '@shared/doc-files'
import type { Part } from '@opencode-ai/sdk/v2/client'
import type { EngineMessage, EnginePart } from './engine-link'

export interface TurnStep {
  id: string
  line: string
  status: string
  failed: boolean
  /** Texto largo del paso (salida de un comando, diff) para «Ver todo»; vacío si no hay. */
  full: string
  tool: string
}

export interface TurnView {
  /** Id del último mensaje de la persona (el turno se identifica por él). */
  userId: string | null
  userText: string
  steps: TurnStep[]
  /** Respuesta final (texto después del último trabajo); vacía si aún no empezó. */
  finalText: string
  /** Hay una herramienta ejecutándose o pendiente. */
  running: boolean
  /** Título del trabajo («Trabajando… 12 s · 4 pasos»). */
  title: string
  /** Título del trabajo ya terminado («Trabajó durante 12 s · 4 pasos»). */
  titleDone: string
  /** Resumen plegado («Leyó 3 archivos · Editó 1 archivo»). */
  summary: string
  /** Error del asistente en este turno (texto llano), o vacío. */
  error: string
  /** Rutas de archivos que el turno creó (candidatas: se validan al ofrecerlas). */
  files: string[]
  lastAssistantId: string | null
  assistantDone: boolean
}

const textOf = (p: EnginePart): string => p.text ?? ''

function roleOf(p: EnginePart): WorkRole {
  if (p.type === 'tool') return 'tool'
  if (p.type === 'reasoning') return p.text ? 'reasoning' : 'skip'
  if (p.type === 'text') return p.synthetic || p.ignored || !p.text?.trim() ? 'skip' : 'text'
  return 'skip'
}

/** Texto de lo que escribió la persona en un mensaje (sin partes sintéticas). */
export function userTextOf(m: EngineMessage): string {
  return m.parts
    .filter((p) => p.type === 'text' && !p.synthetic && !p.ignored)
    .map(textOf)
    .join('\n')
    .trim()
}

function fullTextOf(p: EnginePart): string {
  const st = p.state
  if (!st) return ''
  if (st.diff) return st.diff
  if (st.error) return st.error
  return st.output ?? ''
}

/** ¿Este mensaje de la persona cuenta como el inicio de un turno? (tiene texto o un archivo; los sintéticos no). */
function isCountedUser(m: EngineMessage): boolean {
  return m.role === 'user' && (userTextOf(m) !== '' || m.parts.some((p) => p.type === 'file'))
}

/** Ids de los mensajes de la persona que inician un turno, en orden. */
export function countedUserIds(messages: readonly EngineMessage[]): string[] {
  return messages.filter(isCountedUser).map((m) => m.id)
}

/** Turno de base al elegir una sesión: lo ya ocurrido no se cuenta; si está trabajando, el turno en curso sí (se cuenta al terminar). */
export function baselineSeen(messages: readonly EngineMessage[], busy: boolean): string {
  const ids = countedUserIds(messages)
  return (busy ? ids[ids.length - 2] : ids[ids.length - 1]) ?? ''
}

export function analyzeTurn(
  messages: readonly EngineMessage[],
  now: number,
  root: string | null,
  opts: { files?: boolean } = {}
): TurnView {
  let userIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCountedUser(messages[i] as EngineMessage)) {
      userIdx = i
      break
    }
  }
  const user = userIdx >= 0 ? (messages[userIdx] as EngineMessage) : null
  const asst = messages.slice(userIdx + 1).filter((m) => m.role === 'assistant')
  const parts: EnginePart[] = asst.flatMap((m) => m.parts)
  const segs = segmentWork(parts, roleOf)
  const tools: EnginePart[] = []
  for (const s of segs) if (s.kind === 'work') tools.push(...s.items.filter((p) => p.type === 'tool'))
  const lastSeg = segs[segs.length - 1]
  // La respuesta final es el texto que queda después del último trabajo; sin herramientas, todo el texto.
  const finalText =
    lastSeg && lastSeg.kind === 'plain'
      ? lastSeg.items
          .filter((p) => roleOf(p) === 'text')
          .map(textOf)
          .join('\n\n')
          .trim()
      : ''
  const running = tools.some((p) => p.state?.status === 'running' || p.state?.status === 'pending')
  const last = asst[asst.length - 1] ?? null
  const live = !last || !last.completed || running
  const timed: TimedFacts[] = parts
    .filter((p) => p.type === 'tool' || p.type === 'reasoning' || p.type === 'text')
    .map((p) =>
      p.type === 'tool'
        ? { type: 'tool', state: { status: p.state?.status, time: { start: p.state?.start, end: p.state?.end } } }
        : { type: p.type, time: p.time }
    )
  const steps = tools.map((p) => ({
    id: p.id,
    line: stepLine({ tool: p.tool ?? '', state: { status: p.state?.status, input: p.state?.input, title: p.state?.title } }),
    status: p.state?.status ?? 'pending',
    failed: p.state?.status === 'error',
    full: fullTextOf(p),
    tool: p.tool ?? ''
  }))
  const n = countSteps(tools)
  const created = new Set<string>()
  // Los archivos creados solo se buscan al cerrar el turno (es la parte cara: recorre las salidas de los comandos).
  if (opts.files) {
    for (const p of tools) {
      const f = p.state?.input?.filePath ?? p.state?.input?.path
      if (p.tool === 'write' && p.state?.status === 'completed' && typeof f === 'string' && isAbsolute(f)) created.add(f) // `/x` en POSIX, `C:\x` en Windows
    }
    try {
      // Las salidas se recortan antes de buscar rutas: una salida enorme sin espacios haría lento el detector.
      const clipped = parts.map((p) =>
        p.type === 'tool' && p.state?.output && p.state.output.length > 8000
          ? { ...p, state: { ...p.state, output: p.state.output.slice(0, 8000) } }
          : p
      )
      for (const f of detectDocFiles({ parts: clipped as unknown as readonly Part[], root })) created.add(f)
    } catch {
      /* sin detector: quedan los de la herramienta de escritura */
    }
  }
  return {
    userId: user?.id ?? null,
    userText: user ? userTextOf(user) : '',
    steps,
    finalText,
    running,
    title: n > 0 ? workTitle(n, workDurationMs(timed, live, now), live) : '',
    titleDone: n > 0 ? workTitle(n, workDurationMs(timed, false, now), false) : '',
    summary: summarizeSteps(tools.map((p) => ({ tool: p.tool ?? '' }))),
    error: asst.map((m) => m.error).find((e) => e) ?? '',
    files: [...created].slice(0, 20),
    lastAssistantId: last?.id ?? null,
    assistantDone: !!last && last.completed && !running
  }
}
