/**
 * Marca de los mensajes de «despertar» de `bgshell` (`src/main/opencode/shell-bg-wake.ts`), compartida con el renderer para
 * pintarlos como una línea discreta en vez de una burbuja de la persona (F8-B207). El texto completo sigue yendo al modelo.
 */
export const SHELL_BG_WAKE_KEY = 'shell-bg-wake'
export const SHELL_BG_WAKE_HEAD = '[Aviso automático de Lazunox, no lo escribió la persona]'

export type ShellBgWakeKind = 'exit' | 'possibly-stuck' | 'batch'

export interface ShellBgWakeInfo {
  /** Avisos que agrupa el mensaje (1 si es uno solo). */
  count: number
  kind: ShellBgWakeKind
  /** Texto completo (el que lee el modelo), para el detalle plegable. */
  text: string
}

interface PartLike {
  type?: unknown
  text?: unknown
  synthetic?: unknown
  metadata?: unknown
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * ¿Es este mensaje de usuario un aviso automático de `bgshell`? Se reconoce por la marca `metadata.lazunox` o, si el motor la
 * perdió, por el encabezado del texto. Las partes `synthetic` no cuentan (el cliente ya las oculta).
 */
export function shellBgWakeOf(parts: readonly PartLike[]): ShellBgWakeInfo | null {
  const texts = parts.filter((p) => p.type === 'text' && p.synthetic !== true && typeof p.text === 'string' && p.text.length > 0)
  if (texts.length === 0) return null
  const first = texts[0]!
  const meta = asRecord(first.metadata)
  const text = first.text as string
  if (meta?.lazunox !== SHELL_BG_WAKE_KEY && !text.startsWith(SHELL_BG_WAKE_HEAD)) return null
  const jobs = meta?.jobs
  const count = typeof jobs === 'number' && Number.isInteger(jobs) && jobs >= 1 && jobs <= 100000 ? jobs : 1
  const event = meta?.event
  const kind: ShellBgWakeKind = event === 'possibly-stuck' ? 'possibly-stuck' : event === 'batch' ? 'batch' : 'exit'
  return { count, kind, text }
}
