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
import { FolderOpen, ShieldAlert } from 'lucide-react'
import { friendlyAppName, labeledAppName, MAC_FIXED_BLOCKED, WIN_FIXED_BLOCKED, type LabeledApp } from '@shared/blocked-apps'
import type { GrantsSnapshot } from '@shared/ipc-tasks'
import { Button } from '../../../components/Button'
import type { Lang } from '@shared/i18n'
import { getLang, useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { isWindowsPlatform } from '../../../lib/platform'
import type { MessageEntry } from '../../../stores/sessions'
import { lastAssistantEntry, lastAssistantText } from '../../../lib/conversation/entries'
import { reveal, sendToTask, setAccessMode } from './actions'
import { BlockedRow } from './BlockedAppNotice'
import { currentTasksModel, useTasks, type BlockedAppEntry } from './store'
import { firstUserPrompt } from './transcript'

// Se re-exportan para no romper a quien las importaba de acá (la implementación vive en
// `lib/conversation/entries.ts`, compartida con Code).
export { lastAssistantEntry, lastAssistantText }

// ───────────────────────────── Detección y prompt (funciones puras) ─────────────────────────────

/**
 * Marcador neutro (independiente del idioma) que el prompt del agente le pide escribir al terminar el turno
 * cuando necesita Control total. Es el contrato preferido; las frases de abajo son el respaldo.
 */
export const ESCALATE_MARKER = '[[LAZUNOX:NEEDS_FULL_CONTROL]]'
const NEUTRAL_MARKER = ESCALATE_MARKER.toLowerCase()
// Contrato con el agente (sus prompts están en español/inglés), no es texto de interfaz.
const PHRASES = [
  'necesita control total del mac', // i18n-ignore: contrato con el agente
  'needs full mac control', // i18n-ignore: contrato con el agente
  'needs full control of the mac', // i18n-ignore: contrato con el agente
  'needs full control of your mac' // i18n-ignore: contrato con el agente
]
const MAX_SUMMARY_CHARS = 1500

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

/**
 * ¿El texto pide Control total? Solo cuenta la ÚLTIMA línea no vacía (ignorando espacios): o bien el
 * marcador neutro solo en esa línea, o bien la frase del contrato al inicio de la línea (con su
 * decoración markdown). Citar la frase o el marcador en medio de un párrafo, o con texto después, NO escala.
 */
export function needsFullAccess(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return false
  const { folded } = foldWithMap(lines[lines.length - 1])
  const line = folded.trim()
  if (line.endsWith(NEUTRAL_MARKER)) {
    // Marcador al final de la línea: lo único que puede precederlo es decoración (no texto corrido).
    const before = line.slice(0, line.length - NEUTRAL_MARKER.length).replace(/[\s*_`>#-]+/g, '')
    return before === ''
  }
  const bare = line.replace(/^[\s*_`>#-]+/, '')
  return PHRASES.some((p) => bare.startsWith(p))
}

/** Marcador `[[LAZUNOX:OPEN_FOLDER]]`: el agente pide mostrar el resultado en Finder/Explorador (no cambia de modo). */
export const OPEN_FOLDER_MARKER = '[[LAZUNOX:OPEN_FOLDER]]'
/** Prefijo del marcador `[[LAZUNOX:NEEDS_APP:<App>]]` (pide usar otra app; escala al alcance «El computador completo»). */
export const NEEDS_APP_PREFIX = '[[LAZUNOX:NEEDS_APP:'
const MAX_APP_NAME = 60
/** El motivo viene del agente: se recorta para que no llene la tarjeta. */
export const MAX_REASON_CHARS = 300
const DECORATION = /[\s*_`>#-]+/g

export type EscalationKind = 'folder' | 'app' | 'full'
export interface Escalation {
  kind: EscalationKind
  /** Nombre de la app (solo `app`). */
  app: string
  /** Motivo en una frase ('' si no hay). */
  reason: string
}

/** Última línea no vacía del texto y la línea no vacía anterior (ambas sin recortar decoración). */
function lastTwoLines(text: string): { last: string; prev: string } {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  return { last: lines[lines.length - 1] ?? '', prev: lines[lines.length - 2] ?? '' }
}

function clipReason(text: string): string {
  return text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…` : text
}

function cleanReason(line: string): string {
  return clipReason(
    line
      .replace(/^[\s*_`>#:：-]+/, '')
      .replace(/[\s*_`]+$/, '')
      .trim()
  )
}

/**
 * Qué pide el agente al terminar el turno. Solo cuenta la ÚLTIMA línea no vacía:
 *  - `[[LAZUNOX:OPEN_FOLDER]]` sola (decoración markdown aparte) → `folder`;
 *  - `[[LAZUNOX:NEEDS_APP:<App>]]` sola → `app` (el motivo es la línea anterior);
 *  - `[[LAZUNOX:NEEDS_FULL_CONTROL]]` o la frase «Necesita Control total del Mac» (compatibilidad) → `full`.
 * Citar un marcador en medio de un párrafo, o con texto después, NO cuenta.
 */
export function parseEscalation(text: string): Escalation | null {
  const { last, prev } = lastTwoLines(text)
  if (!last) return null
  const line = last.trim()
  const lower = line.toLowerCase()
  const bareMarker = (marker: string): boolean =>
    lower.endsWith(marker.toLowerCase()) && line.slice(0, line.length - marker.length).replace(DECORATION, '') === ''
  if (bareMarker(OPEN_FOLDER_MARKER)) return { kind: 'folder', app: '', reason: cleanReason(prev) }
  const m = /^[\s*_`>#-]*\[\[LAZUNOX:NEEDS_APP:([^\]\n[]{1,60})\]\][\s*_`]*$/i.exec(line)
  if (m) {
    const app = m[1].trim().slice(0, MAX_APP_NAME)
    if (app) return { kind: 'app', app, reason: cleanReason(prev) }
  }
  if (needsFullAccess(text)) return { kind: 'full', app: '', reason: escalationReason(text) }
  return null
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
  return clipReason(
    rest
      .replace(/^[\s*_:：-]+/, '')
      .replace(/[\s*_]+$/, '')
      .trim()
  )
}

/** Prompt de la tarea nueva en Control total: encargo original + resumen de lo hecho en sandbox (≤1500 caracteres). */
export function buildContinuationPrompt(entries: MessageEntry[], lang: Lang = getLang(), app = ''): string {
  const original = firstUserPrompt(entries)
  let summary = lastAssistantText(entries)
  // Se conserva el final: ahí están las conclusiones y el motivo de la escalada.
  if (summary.length > MAX_SUMMARY_CHARS) summary = `…${summary.slice(-(MAX_SUMMARY_CHARS - 1))}`
  if (app) {
    return lang === 'en'
      ? // i18n-ignore: prompt al agente (en el idioma de la interfaz)
        `Continue this task, which I started in "A folder" scope, in "The entire computer". The agent asked to use this app: ${app}.\n\n` +
          // i18n-ignore: prompt al agente
          `Original request:\n${original}\n\nWhat you did or concluded in the sandbox:\n${summary}`
      : // i18n-ignore: prompt al agente (en el idioma de la interfaz)
        `Continúa en «El computador completo» esta tarea que empecé en «Una carpeta». El agente pidió usar: ${app}.\n\n` +
          // i18n-ignore: prompt al agente
          `Encargo original:\n${original}\n\nLo que hiciste o concluiste en sandbox:\n${summary}`
  }
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

// ───────────────────────────── ¿Está bloqueada la app que pide el agente? ─────────────────────────────

/** Minúsculas, sin tildes, sin «.exe» ni separadores: «Bitwarden.exe» y «bitwarden» comparan igual. */
function normApp(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/[^a-z0-9]+/g, '')
}

function sameApp(a: string, b: string): boolean {
  const x = normApp(a)
  const y = normApp(b)
  if (!x || !y) return false
  if (x === y) return true
  // «1Password 8» pide la app «1Password»: coincide por prefijo, pero solo con nombres largos (no «Mail» con «Mailchimp»).
  return Math.min(x.length, y.length) >= 6 && (x.startsWith(y) || y.startsWith(x))
}

/**
 * ¿La app que pide el agente está bloqueada? 'fixed' = lista de seguridad de Lazunox; 'user' = la bloqueó la persona (guardada
 * en el snapshot de permisos); 'session' = dijo que no en esta tarea (aviso ya recibido en el hilo). Se compara por NOMBRE
 * (el agente no conoce el id de la app). Pura.
 */
export function blockedKindFor(
  app: string,
  opts: { grants: GrantsSnapshot | null; entries?: BlockedAppEntry[]; win: boolean; fixedName: (a: LabeledApp) => string }
): BlockedAppEntry['kind'] | null {
  if (!app.trim()) return null
  for (const a of opts.win ? WIN_FIXED_BLOCKED : MAC_FIXED_BLOCKED) {
    const idName = /\.exe$/i.test(a.id) ? a.id.replace(/\.exe$/i, '') : friendlyAppName(a.id.replace(/\.$/, ''))
    if (sameApp(app, a.name) || sameApp(app, opts.fixedName(a)) || sameApp(app, idName)) return 'fixed'
  }
  for (const e of opts.entries ?? []) if (sameApp(app, e.name)) return e.kind
  const g = opts.grants
  if (g) {
    for (const key of g.denied) {
      if (sameApp(app, g.deniedNames?.[key] || friendlyAppName(key))) return 'user'
    }
  }
  return null
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

function armContinuation(entries: MessageEntry[], app = ''): boolean {
  const folder = useTasks.getState().folder
  if (!folder) return false
  const c: Continuation = { folder, prompt: buildContinuationPrompt(entries, getLang(), app), at: Date.now() }
  cont = c
  setTimeout(() => {
    if (cont === c) cont = null
  }, CONT_TTL_MS)
  return true
}

// ───────────────────────────── Tarjeta ─────────────────────────────

/**
 * Tarjeta bajo el último mensaje de una tarea sandbox terminada, según el marcador final del agente:
 *  - `full`: «Esta tarea necesita controlar apps de tu Mac» (marcador de siempre);
 *  - `app`: «Esta tarea necesita {App}» (el botón cambia el alcance; NO concede la app: el permiso por app llega después);
 *  - `folder`: botón «Abrir carpeta en Finder» (`tasks:reveal`, sin cambiar de modo).
 */
export function EscalateCard({ taskId, entries }: { taskId: string; entries: MessageEntry[] }): React.JSX.Element | null {
  const t = useT()
  const folder = useTasks((s) => s.folder)
  const grants = useTasks((s) => s.grants)
  const blockedEntries = useTasks((s) => s.blockedApps[taskId])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const last = lastAssistantEntry(entries)
  if (!taskId || !last || dismissed.has(last.info.id)) return null
  const esc = parseEscalation(lastAssistantText(entries))
  if (!esc) return null
  const messageId = last.info.id
  const dismiss = (): void => setDismissed((s) => new Set(s).add(messageId))

  if (esc.kind === 'folder') {
    if (!folder) return null
    return (
      <div className="rounded-xl border border-border bg-elevated p-3.5 desk:rounded-card">
        <div className="flex items-start gap-3 desk:gap-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hover text-muted desk:h-9 desk:w-9 desk:rounded-[10px]">
            <FolderOpen size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold desk:text-title-sm">{t('tasksComputer.escalate.folder.title')}</p>
            {esc.reason && <p className="mt-0.5 break-words text-sm text-fg">{esc.reason}</p>}
            <p className="mt-0.5 text-xs text-muted">{t('tasksComputer.escalate.folder.body')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void reveal(folder).catch((e) => useTasks.setState({ error: errorMessage(e) }))}>
                {t('tasks.ws.openFinder')}
              </Button>
              <Button variant="ghost" onClick={dismiss}>
                {t('tasksComputer.delete.notNow')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isApp = esc.kind === 'app'
  // App bloqueada (lista fija, bloqueada por la persona o negada en esta tarea): no se ofrece escalar, solo el aviso de bloqueo.
  if (isApp) {
    const kind = blockedKindFor(esc.app, {
      grants,
      entries: blockedEntries,
      win: isWindowsPlatform(),
      fixedName: (a) => labeledAppName(a, t)
    })
    if (kind) return <BlockedRow entry={{ bundleId: `escalate:${esc.app}`, name: esc.app, kind }} />
  }
  const escalate = (): void => {
    if (!armContinuation(entries, esc.app)) return
    // Abre SIEMPRE el diálogo de confirmación; no hay atajo que lo salte.
    void setAccessMode(true)
  }

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3.5 desk:rounded-card">
      <div className="flex items-start gap-3 desk:gap-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning desk:h-9 desk:w-9 desk:rounded-[10px]">
          <ShieldAlert size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold desk:text-title-sm">
            {isApp ? t('tasksComputer.escalate.app.title', { app: esc.app }) : t('tasksComputer.escalate.title')}
          </p>
          {isApp && <p className="mt-0.5 text-sm text-fg">{t('tasksComputer.escalate.app.lead')}</p>}
          {esc.reason && <p className="mt-0.5 break-words text-sm text-fg">{esc.reason}</p>}
          <p className="mt-0.5 text-xs text-muted">{t(isApp ? 'tasksComputer.escalate.app.warn' : 'tasksComputer.escalate.body')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={escalate}>
              {t(isApp ? 'tasksComputer.escalate.app.switch' : 'tasksComputer.escalate.switch')}
            </Button>
            <Button variant="ghost" onClick={dismiss}>
              {t('tasksComputer.escalate.stay')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
