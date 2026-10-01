/**
 * Escalada sandbox → Control total. El agente `tasks` (sandbox) no puede abrir apps, teclear en
 * otras apps ni capturar pantalla: cuando la tarea lo necesita, termina su turno con la línea
 * literal «**Necesita Control total del Mac**: <motivo>». Aquí se detecta y se ofrece una tarjeta.
 *
 * Seguridad: NUNCA se escala en silencio. El botón solo "arma" una continuación y abre el diálogo
 * de confirmación de siempre (`setAccessMode(true)` → `FullAccessDialog`); el prompt se envía únicamente
 * cuando el usuario confirma y la conexión de Control total de la MISMA carpeta está lista. Los
 * servidores sandbox y de Control total no comparten sesiones, así que "continuar" crea una tarea
 * NUEVA cuyo prompt lleva el encargo original y un resumen de lo último que dijo el agente.
 */
import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '../../../components/Button'
import type { Lang } from '@shared/i18n'
import { getLang, useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import { sendToTask, setAccessMode } from './actions'
import { currentTasksModel, useTasks } from './store'
import { firstUserPrompt, lastAssistantText } from './transcript'

// Se re-exporta para no romper a quien lo importaba de aquí (la implementación vive en `transcript.ts`).
export { lastAssistantText }

// ───────────────────────────── Detección y prompt (funciones puras) ─────────────────────────────

/**
 * Marcador neutro (independiente del idioma) que el prompt del agente le pide escribir al terminar el turno
 * cuando necesita Control total. Es el contrato preferido; las frases de abajo son el respaldo.
 */
export const ESCALATE_MARKER = '[[ONYX:NEEDS_FULL_CONTROL]]'
const NEUTRAL_MARKER = ESCALATE_MARKER.toLowerCase()
// Contrato con el agente (sus prompts están en español/inglés), no es texto de interfaz.
const PHRASES = [
  'necesita control total del mac', // i18n-ignore: contrato con el agente
  'needs full mac control', // i18n-ignore: contrato con el agente
  'needs full control of the mac', // i18n-ignore: contrato con el agente
  'needs full control of your mac' // i18n-ignore: contrato con el agente
]
const MAX_SUMMARY_CHARS = 1500

/** Último mensaje del asistente de la tarea (undefined si no hay). */
export function lastAssistantEntry(entries: MessageEntry[]): MessageEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].info.role === 'assistant') return entries[i]
  return undefined
}

/** Minúsculas y sin tildes (NFD), conservando para cada carácter normalizado su índice en el original. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const piece = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    for (let k = 0; k < piece.length; k++) map.push(i)
    folded += piece
  }
  return { folded, map }
}

/** ¿El texto pide Control total? Marcador neutro o frase en español/inglés (sin tildes ni mayúsculas). */
export function needsFullAccess(text: string): boolean {
  const { folded } = foldWithMap(text)
  return folded.includes(NEUTRAL_MARKER) || PHRASES.some((p) => folded.includes(p))
}

/** Posición (en el texto plegado) y longitud de la última coincidencia de alguna de las frases. */
function lastMatch(folded: string, needles: string[]): { at: number; len: number } | null {
  let best: { at: number; len: number } | null = null
  for (const n of needles) {
    const at = folded.lastIndexOf(n)
    if (at >= 0 && (!best || at > best.at)) best = { at, len: n.length }
  }
  return best
}

/**
 * Motivo que sigue a «**Necesita Control total del Mac**:» / «**Needs Full Mac control**:» (misma línea).
 * Con solo el marcador neutro, lo que lo acompaña en su línea. '' si no hay.
 */
export function escalationReason(text: string): string {
  const { folded, map } = foldWithMap(text)
  const m = lastMatch(folded, PHRASES) ?? lastMatch(folded, [NEUTRAL_MARKER])
  if (!m) return ''
  const at = m.at
  const end = at + m.len
  const from = end < map.length ? map[end] : text.length
  const rest = text.slice(from).split('\n')[0].split(ESCALATE_MARKER).join('')
  return rest
    .replace(/^[\s*_:：-]+/, '')
    .replace(/[\s*_]+$/, '')
    .trim()
}

/** Prompt de la tarea nueva en Control total: encargo original + resumen de lo hecho en sandbox (≤1500 caracteres). */
export function buildContinuationPrompt(entries: MessageEntry[], lang: Lang = getLang()): string {
  const original = firstUserPrompt(entries)
  let summary = lastAssistantText(entries)
  // Se conserva el final: ahí están las conclusiones y el motivo de la escalada.
  if (summary.length > MAX_SUMMARY_CHARS) summary = `…${summary.slice(-(MAX_SUMMARY_CHARS - 1))}`
  if (lang === 'en') {
    return (
      // i18n-ignore: prompt al agente (en el idioma de la interfaz)
      'Continue this task, which I started in sandbox mode, in Full Mac control.\n\n' +
      // i18n-ignore: prompt al agente
      `Original request:\n${original}\n\n` +
      // i18n-ignore: prompt al agente
      `What you did or concluded in the sandbox:\n${summary}`
    )
  }
  return (
    // i18n-ignore: prompt al agente (en el idioma de la interfaz)
    'Continúa en Control total del Mac esta tarea que empecé en modo sandbox.\n\n' +
    // i18n-ignore: prompt al agente
    `Encargo original:\n${original}\n\n` +
    // i18n-ignore: prompt al agente
    `Lo que hiciste o concluiste en sandbox:\n${summary}`
  )
}

// ───────────────────────────── Continuación armada (nivel de módulo) ─────────────────────────────

interface Continuation {
  folder: string
  prompt: string
  at: number
}

/** Continuación pendiente: existe solo tras pulsar el botón y hasta confirmar / cancelar / caducar. */
let cont: Continuation | null = null

const CONT_TTL_MS = 5 * 60_000
/** Margen tras cerrarse el diálogo para que llegue `fullAccess = true` (si no llega, se canceló). */
const CANCEL_GRACE_MS = 3000

useTasks.subscribe((state, prev) => {
  const c = cont
  if (!c) return
  // (c) Cambió la carpeta o pasó demasiado tiempo: se descarta.
  if (state.folder !== c.folder || Date.now() - c.at > CONT_TTL_MS) {
    cont = null
    return
  }
  // (a) El diálogo se cerró: si no se activó el Control total, el usuario canceló.
  if (prev.pendingFullAccess && !state.pendingFullAccess) {
    setTimeout(() => {
      if (cont === c && !useTasks.getState().fullAccess) cont = null
    }, CANCEL_GRACE_MS)
  }
  // (b) Llegó la conexión de Control total de la misma carpeta: se consume (una sola vez).
  if (state.conn?.fullAccess && state.phase === 'ready' && state.folder === c.folder && state.conn !== prev.conn) {
    cont = null
    void sendToTask(c.prompt, currentTasksModel()).catch((e) => useTasks.setState({ error: errorMessage(e) }))
  }
})

function armContinuation(entries: MessageEntry[]): boolean {
  const folder = useTasks.getState().folder
  if (!folder) return false
  const c: Continuation = { folder, prompt: buildContinuationPrompt(entries), at: Date.now() }
  cont = c
  setTimeout(() => {
    if (cont === c) cont = null
  }, CONT_TTL_MS)
  return true
}

// ───────────────────────────── Tarjeta ─────────────────────────────

/** Tarjeta "Esta tarea necesita controlar apps de tu Mac", bajo el último mensaje de una tarea sandbox terminada. */
export function EscalateCard({ taskId, entries }: { taskId: string; entries: MessageEntry[] }): React.JSX.Element | null {
  const t = useT()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const last = lastAssistantEntry(entries)
  if (!taskId || !last || dismissed.has(last.info.id) || !needsFullAccess(lastAssistantText(entries))) return null
  const messageId = last.info.id
  const reason = escalationReason(lastAssistantText(entries))

  const escalate = (): void => {
    if (!armContinuation(entries)) return
    // Abre SIEMPRE el diálogo de confirmación; no hay atajo que lo salte.
    void setAccessMode(true)
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 [[data-theme=dark]_&]:text-amber-400">
          <ShieldAlert size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('tasksComputer.escalate.title')}</p>
          {reason && <p className="mt-0.5 break-words text-sm text-fg">{reason}</p>}
          <p className="mt-0.5 text-xs text-muted">{t('tasksComputer.escalate.body')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={escalate}>
              {t('tasksComputer.escalate.switch')}
            </Button>
            <Button variant="ghost" onClick={() => setDismissed((s) => new Set(s).add(messageId))}>
              {t('tasksComputer.escalate.stay')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
