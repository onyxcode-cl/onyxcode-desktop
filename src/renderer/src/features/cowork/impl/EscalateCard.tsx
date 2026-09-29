/**
 * Escalada sandbox → Control total. El agente `cowork` (sandbox) no puede abrir apps, teclear en
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
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import { sendToTask, setAccessMode } from './actions'
import { currentCoworkModel, useCowork } from './store'
import { firstUserPrompt, lastAssistantText } from './transcript'

// Se re-exporta para no romper a quien lo importaba de aquí (la implementación vive en `transcript.ts`).
export { lastAssistantText }

// ───────────────────────────── Detección y prompt (funciones puras) ─────────────────────────────

const MARKER = 'necesita control total del mac'
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

/** ¿El texto pide Control total? (busca «necesita control total del mac», sin tildes ni mayúsculas). */
export function needsFullAccess(text: string): boolean {
  return foldWithMap(text).folded.includes(MARKER)
}

/** Motivo que sigue a «**Necesita Control total del Mac**:» (misma línea). '' si no hay. */
export function escalationReason(text: string): string {
  const { folded, map } = foldWithMap(text)
  const at = folded.lastIndexOf(MARKER)
  if (at < 0) return ''
  const end = at + MARKER.length
  const from = end < map.length ? map[end] : text.length
  const rest = text.slice(from).split('\n')[0]
  return rest
    .replace(/^[\s*_:：-]+/, '')
    .replace(/[\s*_]+$/, '')
    .trim()
}

/** Prompt de la tarea nueva en Control total: encargo original + resumen de lo hecho en sandbox (≤1500 caracteres). */
export function buildContinuationPrompt(entries: MessageEntry[]): string {
  const original = firstUserPrompt(entries)
  let summary = lastAssistantText(entries)
  // Se conserva el final: ahí están las conclusiones y el motivo de la escalada.
  if (summary.length > MAX_SUMMARY_CHARS) summary = `…${summary.slice(-(MAX_SUMMARY_CHARS - 1))}`
  return (
    'Continúa en Control total del Mac esta tarea que empecé en modo sandbox.\n\n' +
    `Encargo original:\n${original}\n\n` +
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

useCowork.subscribe((state, prev) => {
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
      if (cont === c && !useCowork.getState().fullAccess) cont = null
    }, CANCEL_GRACE_MS)
  }
  // (b) Llegó la conexión de Control total de la misma carpeta: se consume (una sola vez).
  if (state.conn?.fullAccess && state.phase === 'ready' && state.folder === c.folder && state.conn !== prev.conn) {
    cont = null
    void sendToTask(c.prompt, currentCoworkModel()).catch((e) =>
      useCowork.setState({ error: errorMessage(e) })
    )
  }
})

function armContinuation(entries: MessageEntry[]): boolean {
  const folder = useCowork.getState().folder
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
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 [[data-theme=dark]_&]:text-amber-400">
          <ShieldAlert size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Esta tarea necesita controlar apps de tu Mac</p>
          {reason && <p className="mt-0.5 break-words text-sm text-fg">{reason}</p>}
          <p className="mt-0.5 text-xs text-muted">
            El modo sandbox no puede abrir apps, hacer clic, teclear en otras apps ni capturar la pantalla. Si cambias a Control total, se
            abrirá una tarea nueva con tu encargo y un resumen de lo hecho hasta ahora; antes te pediremos confirmar el cambio y el agente
            pedirá tu aprobación para actuar.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={escalate}>
              Cambiar a Control total y continuar
            </Button>
            <Button variant="ghost" onClick={() => setDismissed((s) => new Set(s).add(messageId))}>
              Seguir en sandbox
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
