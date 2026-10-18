/**
 * Formato de lo que el bot manda de una sesión (entrega 2): respuesta final partida en trozos de HTML válido, líneas de avance en
 * lenguaje llano y recortes con inicio y final. Funciones puras: todo lo que sale pasa por tapar → recortar → escapar (`text.ts`).
 *
 * Reglas de la partición (`chunkAnswer`):
 *  - El texto se tapa ANTES de partirlo (una clave cortada por la mitad entre dos trozos quedaría a la vista).
 *  - Cada trozo mide, YA ESCAPADO y con sus etiquetas, a lo más `max` caracteres (por debajo del tope de 4096 de Telegram).
 *  - Se parte entre líneas; una línea más larga que el trozo se parte por palabras y, si no hay, a la fuerza.
 *  - Los bloques de código (```) que cruzan un trozo se cierran y se vuelven a abrir: ningún trozo deja una etiqueta abierta.
 *  - Solo hay `<b>`, `<code>` y `<pre>`, y las dos primeras no cruzan líneas: lo que no se puede cerrar en su línea queda como texto.
 */
import { TELEGRAM_LIMITS } from '@shared/telegram'
import { escapeHtml, redactForTelegram, stripControl, truncateMiddle } from './text'

const OPEN = '<pre>'
const CLOSE = '</pre>'

/** Convierte una línea de Markdown simple (`**negrita**`, `código`, `# título`) en HTML de Telegram; todo lo demás se escapa. */
export function inlineHtml(line: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
  if (heading) return `<b>${inlineHtmlPlain(heading[1] as string)}</b>`
  return inlineHtmlPlain(line)
}

function inlineHtmlPlain(line: string): string {
  // Primero se aíslan los trozos de código (lo de dentro no se interpreta); la negrita solo se busca fuera de ellos, así las
  // etiquetas nunca se cruzan.
  const out: string[] = []
  const re = /`([^`\n]{1,300})`/g
  let last = 0
  for (const m of line.matchAll(re)) {
    out.push(boldHtml(line.slice(last, m.index)))
    out.push(`<code>${escapeHtml(m[1] as string)}</code>`)
    last = (m.index ?? 0) + m[0].length
  }
  out.push(boldHtml(line.slice(last)))
  return out.join('')
}

function boldHtml(text: string): string {
  const out: string[] = []
  let last = 0
  for (const m of text.matchAll(/\*\*([^*\n]{1,300}?)\*\*/g)) {
    out.push(escapeHtml(text.slice(last, m.index)))
    out.push(`<b>${escapeHtml(m[1] as string)}</b>`)
    last = (m.index ?? 0) + m[0].length
  }
  out.push(escapeHtml(text.slice(last)))
  return out.join('')
}

/** Parte `text` en piezas que, ya escapadas, no pasen de `limit` (corta por palabras si puede). */
function splitByEscapedLength(text: string, limit: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > 0) {
    if (escapeHtml(rest).length <= limit) {
      out.push(rest)
      break
    }
    let n = Math.min(rest.length, limit)
    while (n > 1 && escapeHtml(rest.slice(0, n)).length > limit) n = Math.floor(n * 0.9)
    const cut = rest.lastIndexOf(' ', n)
    const at = cut > n * 0.5 ? cut : n
    out.push(rest.slice(0, at))
    rest = rest.slice(at)
  }
  return out
}

/**
 * La respuesta (Markdown simple) como trozos de HTML válido. Un texto vacío da una lista vacía.
 * Si hay muchos trozos, quien llama decide mandarla como archivo (`TELEGRAM_LIMITS.maxChunks`).
 */
export function chunkAnswer(raw: string, max: number = TELEGRAM_LIMITS.chunkMax): string[] {
  const clean = stripControl(redactForTelegram(raw)).replace(/\r\n?/g, '\n').trim()
  if (!clean) return []
  const out: string[] = []
  let cur = ''
  let inPre = false
  const flush = (): void => {
    if (inPre) cur = cur.replace(/\n$/, '') + CLOSE
    else cur = cur.replace(/\n+$/, '')
    if (cur.replace(/<[^>]*>/g, '').trim()) out.push(cur)
    cur = ''
    inPre = false
  }
  const push = (html: string, pre: boolean, term = '\n'): void => {
    for (let guard = 0; guard < 4; guard++) {
      let add = ''
      if (pre !== inPre) {
        if (inPre) add += CLOSE + '\n'
        if (pre) add += OPEN
      }
      add += html + term
      const tail = pre ? CLOSE.length : 0
      if (cur.length + add.length + tail <= max || cur === '') {
        cur += add
        inPre = pre
        return
      }
      flush()
    }
  }
  let fence = false
  for (const line of clean.split('\n')) {
    if (/^\s*```/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) {
      const pieces = splitByEscapedLength(line, max - OPEN.length - CLOSE.length - 8)
      pieces.forEach((piece, i) => push(escapeHtml(piece), true, i < pieces.length - 1 ? '' : '\n'))
      continue
    }
    // Línea corriente: si no cabe en un trozo se parte antes de darle formato.
    const pieces = splitByEscapedLength(line, Math.floor(max / 2))
    pieces.forEach((piece, i) => push(inlineHtml(piece), false, i < pieces.length - 1 ? '' : '\n'))
  }
  flush()
  return out
}

/** Todo el texto, tapado y sin controles, como bytes para mandarlo como archivo (respuesta muy larga o «Ver todo»). */
export function plainFileText(raw: string): string {
  return stripControl(redactForTelegram(raw)).replace(/\r\n?/g, '\n')
}

/** Recorte con inicio y final de una salida de comando o diff para el mensaje de avance (ya escapado). */
export function previewBlock(raw: string, max: number, omitted: (n: number) => string): { html: string; trimmed: boolean } {
  const clean = stripControl(redactForTelegram(raw)).replace(/\r\n?/g, '\n').trim()
  const trimmed = clean.length > max
  return { html: escapeHtml(truncateMiddle(clean, max, omitted)), trimmed }
}

/** «hace 5 min» en dos o tres tamaños: lo dice quien llama con las claves de texto. */
export function agoParts(now: number, then: number): { unit: 'now' | 'min' | 'hour' | 'day'; n: number } {
  const s = Math.max(0, Math.floor((now - then) / 1000))
  if (s < 60) return { unit: 'now', n: 0 }
  if (s < 3600) return { unit: 'min', n: Math.floor(s / 60) }
  if (s < 86400) return { unit: 'hour', n: Math.floor(s / 3600) }
  return { unit: 'day', n: Math.floor(s / 86400) }
}
