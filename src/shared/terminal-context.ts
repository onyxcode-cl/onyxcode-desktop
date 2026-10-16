/**
 * Lógica pura de «Preguntar a la IA sobre esto» (terminal de Code): limpia lo que hay en la terminal, tacha secretos, recorta y
 * lo arma como un bloque citado listo para el compositor. NADA se envía: la persona lo revisa y pulsa enviar.
 */
import { maskSecretPatterns, REDACT_MASK } from './redact-patterns'

/** Tope del texto citado (caracteres). Si se pasa, se conserva el FINAL (lo último que salió suele ser el error). */
export const MAX_TERMINAL_CONTEXT_CHARS = 8000
export const TERMINAL_TAIL_LINES = 60

/** Secuencias CSI/OSC/DCS, otros escapes de 2 bytes y caracteres de control (salvo salto de línea y tabulador). */
const ANSI_RE = new RegExp(
  [
    '\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)', // OSC
    '\\u001b[PX^_][^\\u001b]*\\u001b\\\\', // DCS/SOS/PM/APC
    '\\u001b\\[[0-?]*[ -/]*[@-~]', // CSI
    '\\u001b[@-Z\\\\-_]', // escapes de 2 bytes
    '\\u009b[0-?]*[ -/]*[@-~]'
  ].join('|'),
  'g'
)
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS_RE, '')
}

/** Asignaciones tipo `export API_KEY=…`, `OPENAI_TOKEN: …`, `DB_PASSWORD=…`: oculta el valor y conserva el nombre. */
const ENV_SECRET_RE =
  /\b([A-Za-z0-9_.-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)[A-Za-z0-9_.-]*["']?\s*[=:]\s*["']?)[^\s"']+/gi
/** Cabeceras `Authorization: …`, `Cookie: …`, `Set-Cookie: …`, `-H "X-Api-Key: …"` hasta el final de la línea. */
const HEADER_RE = /\b((?:proxy-)?authorization|cookie|set-cookie|x-api-key|x-auth-token)(["']?\s*:\s*)[^\n]*/gi
/** Bloques de llave privada (PEM) completos o cortados por el recorte. */
const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g

/** Quita secretos: reutiliza los patrones compartidos (`redact-patterns`) y añade variables de entorno, cabeceras y llaves PEM. */
export function scrubTerminalSecrets(text: string): string {
  let out = text.replace(PEM_RE, REDACT_MASK)
  out = out.replace(HEADER_RE, `$1$2${REDACT_MASK}`)
  out = out.replace(ENV_SECRET_RE, `$1${REDACT_MASK}`)
  return maskSecretPatterns(out)
}

/** Limpia ANSI, quita secretos y espacios sobrantes (líneas en blanco seguidas, espacios al final). */
export function cleanTerminalText(raw: string): string {
  const lines = scrubTerminalSecrets(stripAnsi(raw))
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
  const out: string[] = []
  for (const l of lines) {
    if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(l)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/** Recorta por el principio hasta `max` caracteres (cortando en un salto de línea si se puede). */
export function clipTail(text: string, max: number = MAX_TERMINAL_CONTEXT_CHARS): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false }
  let tail = text.slice(text.length - max)
  const nl = tail.indexOf('\n')
  if (nl > -1 && nl < tail.length - 1 && nl < 400) tail = tail.slice(nl + 1)
  return { text: tail, clipped: true }
}

/** Valla de código más larga que cualquier racha de comillas invertidas del texto (mínimo 3). */
function fenceFor(text: string): string {
  let longest = 0
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  return '`'.repeat(Math.max(3, longest + 1))
}

export interface TerminalAskResult {
  /** Texto para el compositor; `null` si no había nada que citar. */
  text: string | null
  clipped: boolean
  lineCount: number
}

/** Arma «intro + bloque ```text```» con lo que había en la terminal (ya limpio y sin secretos). */
export function buildTerminalAsk(raw: string, intro: string, clippedNote: string): TerminalAskResult {
  const cleaned = cleanTerminalText(raw)
  if (!cleaned.trim()) return { text: null, clipped: false, lineCount: 0 }
  const { text, clipped } = clipTail(cleaned)
  const fence = fenceFor(text)
  const note = clipped ? `${clippedNote}\n` : ''
  return { text: `${intro}\n\n${note}${fence}text\n${text}\n${fence}\n`, clipped, lineCount: text.split('\n').length }
}
