/**
 * Lógica pura de la salida de un comando ejecutado con ▶ en la terminal de Code: limpieza (ANSI, `\r` de barras de progreso),
 * secretos, detección de «espera entrada» (contraseña, s/n), reconocimiento del regreso al prompt y armado del mensaje para la IA.
 * NUNCA se capturan teclas: solo lo que el shell imprime.
 */
import { clipTail, scrubTerminalSecrets, MAX_TERMINAL_CONTEXT_CHARS } from './terminal-context'
import { REDACT_MASK } from './redact-patterns'
import { emulateTerminal, type EmulateOptions } from './terminal-emulate'

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

/** Texto limpio como lo vería una persona (emulación mínima de terminal: `\r`, borrados, ANSI), SIN tachar secretos todavía. */
export function plainOutput(raw: string, opts: EmulateOptions = {}): string {
  const out = emulateTerminal(raw, opts).split('\n')
  while (out.length && out[0] === '') out.shift()
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/**
 * Busca el eco del comando tecleado en el texto (ignorando espacios y saltos: el eco se parte por el ancho del terminal y zsh/bash lo
 * redibujan) y devuelve lo que viene DESPUÉS, más lo que había ANTES (el prompt). `partial`: el eco aún no llegó entero; `gaveup`:
 * no se encontró (no se toca nada).
 */
export function stripEcho(text: string, command: string): { state: 'ok' | 'partial' | 'gaveup'; text: string; before: string } {
  const exp = command.replace(/\s+/g, '')
  if (!exp) return { state: 'gaveup', text, before: '' }
  let partial = false
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== exp[0]) continue
    let j = 0
    let i = start
    let skips = 0
    for (; i < text.length && j < exp.length; i++) {
      const c = text[i]
      if (/\s/.test(c)) continue
      if (c === exp[j]) j++
      else if (++skips > 8) break
    }
    if (j >= exp.length) {
      return { state: 'ok', text: text.slice(i).replace(/^[ \t]*\n/, ''), before: text.slice(0, start) }
    }
    if (i >= text.length && skips <= 8) partial = true
  }
  return partial || text.trim() === '' || text.length < exp.length + 60
    ? { state: 'partial', text: '', before: '' }
    : { state: 'gaveup', text, before: '' }
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
  return lastLineIsPrompt(lines[lines.length - 1], p)
}

function lastLineIsPrompt(line: string, trimmedPrompt: string): boolean {
  const last = line.trim()
  const tail = trimmedPrompt.slice(-Math.min(12, trimmedPrompt.length))
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
  /** El shell volvió a mostrar su prompt (el comando terminó). */
  promptReturned: boolean
  /** ¿Se conoce el prompt del shell (aprendido antes o leído antes del eco)? Sin él no se puede saber cuándo vuelve. */
  promptKnown: boolean
}

export interface OutputContext {
  /** Comando tal como se tecleó (todas sus líneas). Con él se quita el eco y se reconoce el regreso del prompt. */
  command: string
  cols: number
}

const EMPTY_VIEW: OutputView = {
  lines: [],
  lineCount: 0,
  text: '',
  clipped: false,
  mostlySecret: false,
  waitKind: null,
  promptReturned: false,
  promptKnown: false
}

/**
 * Vista de la salida capturada. Con `ctx` (ejecuciones con ▶): la fila del prompt aprendido se siembra antes de emular, se consume el
 * eco del comando y se quita el prompt final de regreso; solo queda lo que imprimió el comando. Sin `ctx`: limpieza simple.
 */
export function outputView(raw: string, promptLine = '', ctx?: OutputContext): OutputView {
  let plain: string
  let promptReturned = false
  let promptKnown = promptLine.trim().length >= 2
  if (ctx) {
    const emulated = plainOutput(raw, { cols: ctx.cols, seed: promptLine })
    const echo = stripEcho(emulated, ctx.command)
    if (echo.state === 'partial') return EMPTY_VIEW
    plain = echo.state === 'ok' ? echo.text : emulated
    const lines = plain.split('\n')
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    // Prompt efectivo: el aprendido antes de ejecutar o, si no se pudo, el que quedó antes del eco.
    const learned = echo.state === 'ok' ? (echo.before.split('\n').pop() ?? '').trim() : ''
    const tp = promptLine.trim() || learned
    promptKnown = tp.length >= 2
    if (
      echo.state === 'ok' &&
      promptKnown &&
      lines.length &&
      !detectInputPrompt(lines.join('\n')) &&
      lastLineIsPrompt(lines[lines.length - 1], tp)
    ) {
      lines.pop()
      promptReturned = true
    }
    while (lines.length && lines[0].trim() === '') lines.shift()
    plain = lines.join('\n')
  } else {
    plain = plainOutput(raw)
    if (!detectInputPrompt(plain) && endsWithPrompt(plain, promptLine)) plain = plain.split('\n').slice(0, -1).join('\n')
  }
  const waitKind = detectInputPrompt(plain)
  const scrubbed = scrubTerminalSecrets(plain)
  const all = scrubbed.split('\n')
  const clip = clipTail(scrubbed, MAX_TERMINAL_CONTEXT_CHARS)
  return {
    lines: scrubbed === '' ? [] : all.slice(-OUTPUT_VIEW_LINES),
    lineCount: scrubbed === '' ? 0 : all.length,
    text: clip.text,
    clipped: clip.clipped,
    mostlySecret: mostlySecret(plain, scrubbed),
    waitKind,
    promptReturned,
    promptKnown
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
