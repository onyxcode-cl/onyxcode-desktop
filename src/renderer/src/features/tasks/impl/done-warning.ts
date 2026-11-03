/**
 * «Terminado con avisos» (W6): una tarea que acabó sin error pero cuyo plan quedó con pasos sin hacer, o a la que se le pidió CREAR un
 * Word/Excel/PowerPoint/PDF y no dejó ninguno, no debe verse como un «Terminado» limpio. Funciones puras, sin store: reciben lo que ya tiene
 * la pantalla (mensajes del turno, plan guardado, archivos entregados).
 */
import type { Todo } from '@opencode-ai/sdk/v2/client'
import type { MessageEntry } from '../../../stores/sessions'
import { extOf, isHelperFile, isVisibleText } from './util'
import { turnEntries, turnTodos } from './work-progress'

export type DoneWarning = { kind: 'plan'; left: number } | { kind: 'deliverable'; types: string[] } | null

const CREATE =
  /\b(crea|crear|creame|créame|haz|hazme|hacer|genera|generar|genérame|prepara|preparar|arma|armar|elabora|elaborar|redacta|redactar|escribe|escríbeme|create|make|generate|build|write|prepare|draft)\b/i
const KINDS: Array<{ ext: string; re: RegExp }> = [
  { ext: 'docx', re: /\.docx\b|\b(word|documento word|informe en word)\b/i },
  { ext: 'xlsx', re: /\.xlsx\b|\b(excel|planilla|hoja de c[aá]lculo|spreadsheet)\b/i },
  { ext: 'pptx', re: /\.pptx\b|\b(powerpoint|presentaci[oó]n|diapositivas|slides|deck)\b/i },
  { ext: 'pdf', re: /\.pdf\b/i }
]

/** Texto del último mensaje del usuario (la petición del turno que acaba de terminar). */
function lastRequest(entries: MessageEntry[]): string {
  const te = turnEntries(entries)
  const first = te[0]
  if (!first || first.info.role !== 'user') return ''
  return first.parts
    .filter(isVisibleText)
    .map((p) => p.text)
    .join('\n')
}

/** Tipos de archivo que el usuario pidió CREAR (vacío si solo pidió leer, resumir o preguntar). */
export function requestedTypes(text: string): string[] {
  if (!CREATE.test(text)) return []
  return KINDS.filter((k) => k.re.test(text)).map((k) => k.ext)
}

export function doneWarning(args: {
  entries: MessageEntry[]
  storeTodos: Todo[]
  /** `undefined` = aún no se cargaron los entregables (no se juzga). */
  files: Array<{ path: string; relPath: string }> | undefined
}): DoneWarning {
  const todos = turnTodos(args.entries) ?? args.storeTodos
  const left = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress').length
  if (left > 0) return { kind: 'plan', left }
  if (!args.files) return null
  const wanted = requestedTypes(lastRequest(args.entries))
  if (wanted.length === 0) return null
  const have = new Set(args.files.filter((f) => !isHelperFile(f)).map((f) => extOf(f.path)))
  const missing = wanted.filter((w) => !have.has(w))
  return missing.length === wanted.length ? { kind: 'deliverable', types: missing } : null
}
