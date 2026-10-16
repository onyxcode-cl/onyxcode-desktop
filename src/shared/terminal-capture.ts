/**
 * Lógica pura de la salida de un comando ejecutado con ▶ en la terminal de Code: limpieza (ANSI, `\r` de barras de progreso),
 * secretos, detección de «espera entrada» (contraseña, s/n), reconocimiento del regreso al prompt y armado del mensaje para la IA.
 * NUNCA se capturan teclas: solo lo que el shell imprime.
 */
import { clipTail, scrubTerminalSecrets, stripAnsi, MAX_TERMINAL_CONTEXT_CHARS } from './terminal-context'
import { REDACT_MASK } from './redact-patterns'

/** Líneas que muestra la tarjeta de salida (con scroll). */
export const OUTPUT_VIEW_LINES = 40
/** Inactividad con el prompt reconocido sin volver: el comando sigue corriendo (servidor, vigía…): se comparte una vez con nota. */
export const STABLE_RUNNING_MS = 5000
/** Inactividad cuando no se pudo reconocer el prompt: se da por terminado. */
export const STABLE_DONE_MS = 3000
/** Pausa tras ver un prompt de entrada o el regreso al prompt, para juntar el resto de la salida. */
export const SETTLE_MS = 400

/** Cuando es `true`, cada ejecución con ▶ comparte su salida con la IA sola (decisión del dueño). Cambiar aquí lo apaga de raíz. */
export const AUTO_SHARE_DEFAULT = true

export type WaitKind = 'password' | 'answer'

/** Cada línea queda con lo último que dejó un `\r` (barras de progreso) y sin ANSI. */
export function collapseCarriageReturns(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => {
      const i = l.lastIndexOf('\r')
      return i === -1 ? l : l.slice(i + 1).length ? l.slice(i + 1) : l.slice(0, i)
    })
    .join('\n')
}

/** Texto limpio (sin ANSI ni `\r`), SIN tachar secretos todavía. */
export function plainOutput(raw: string): string {
  const out = stripAnsi(collapseCarriageReturns(raw))
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
  while (out.length && out[0] === '') out.shift()
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

const ANSWER_RE =
  /(?:\(\s*y\s*\/\s*n\s*\)|\[\s*y\s*\/\s*n\s*\]|\[\s*s\s*\/\s*n\s*\]|\(\s*yes\s*\/\s*no\s*\)|continue\?|¿continuar\?|proceed\?|are you sure)[^\n]*$/i

/** ¿La última línea espera que la persona escriba algo? (`[sudo] contraseña`, `Password:`, `(y/n)`, `Continue?`…). */
export function detectInputPrompt(text: string): WaitKind | null {
  const last =
    text
      .split('\n')
      .filter((l) => l.trim() !== '')
      .pop() ?? ''
  if (!last) return null
  if (/(?:\[sudo\]|passphrase|password|contrase[ñn]a)[^\n]*:\s*$/i.test(last)) return 'password'
  if (ANSWER_RE.test(last)) return 'answer'
  return null
}

/** ¿La última línea de la salida es el prompt que había antes de ejecutar (el shell volvió a esperar órdenes)? */
export function endsWithPrompt(text: string, promptLine: string): boolean {
  const p = promptLine.trim()
  if (p.length < 2) return false
  const lines = text.split('\n')
  if (lines.length < 2) return false // la primera línea es el eco del comando
  const last = lines[lines.length - 1].trim()
  const tail = p.slice(-Math.min(12, p.length))
  return last.length > 0 && last.endsWith(tail)
}

/** ¿Tras tachar secretos casi no queda nada? (la salida era, sobre todo, una clave). */
export function mostlySecret(plain: string, scrubbed: string): boolean {
  const orig = plain.replace(/\s+/g, '')
  if (orig.length === 0 || !scrubbed.includes(REDACT_MASK)) return false
  const rest = scrubbed.split(REDACT_MASK).join('').replace(/\s+/g, '')
  return rest.length / orig.length < 0.2
}

export interface OutputView {
  /** Últimas líneas ya sin secretos (lo que muestra la tarjeta). */
  lines: string[]
  lineCount: number
  /** Salida completa limpia y sin secretos, recortada por el principio al tope. */
  text: string
  clipped: boolean
  mostlySecret: boolean
  waitKind: WaitKind | null
}

/** Vista de la salida capturada. `promptLine`: si la salida termina en el prompt, esa última línea se quita. */
export function outputView(raw: string, promptLine = ''): OutputView {
  let plain = plainOutput(raw)
  const waitKind = detectInputPrompt(plain)
  if (!waitKind && endsWithPrompt(plain, promptLine)) plain = plain.split('\n').slice(0, -1).join('\n')
  const scrubbed = scrubTerminalSecrets(plain)
  const all = scrubbed.split('\n')
  const clip = clipTail(scrubbed, MAX_TERMINAL_CONTEXT_CHARS)
  return {
    lines: scrubbed === '' ? [] : all.slice(-OUTPUT_VIEW_LINES),
    lineCount: scrubbed === '' ? 0 : all.length,
    text: clip.text,
    clipped: clip.clipped,
    mostlySecret: mostlySecret(plain, scrubbed),
    waitKind
  }
}

export type ShareStatus = 'done' | 'waiting' | 'running'

export interface ShareMessageTexts {
  intro: string
  clippedNote: string
  runningNote: string
  waitingNote: string
}

/** Fenza de código más larga que cualquier racha de comillas invertidas del texto. */
function fence(text: string): string {
  let longest = 0
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * Mensaje corto para la IA: «Ejecuté el comando y esto salió:» + bloque ```text```. Con contraseña pendiente solo va lo previo y
 * la nota; con el comando todavía corriendo, la nota «sigue en ejecución». `null` si no hay nada que compartir.
 */
export function buildShareMessage(view: OutputView, status: ShareStatus, texts: ShareMessageTexts): string | null {
  if (view.text.trim() === '') return null
  const f = fence(view.text)
  const notes = [
    view.clipped ? texts.clippedNote : '',
    status === 'running' ? texts.runningNote : '',
    status === 'waiting' ? texts.waitingNote : ''
  ]
    .filter(Boolean)
    .join('\n')
  return `${texts.intro}\n\n${notes ? notes + '\n' : ''}${f}text\n${view.text}\n${f}\n`
}
