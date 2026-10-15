/**
 * Detector de documentos generados en disco (Excel, Word, PowerPoint, PDF, HTML) en un turno del asistente de Code.
 * Función pura: devuelve rutas CANDIDATAS (absolutas, sin duplicados); main comprueba que existen, que están dentro del
 * proyecto y que son documentos (`files:docInfo`). Fuentes: herramientas de escritura/edición, salida (y redirecciones) de
 * comandos y rutas mencionadas en el texto del asistente.
 */
import type { Part } from '@opencode-ai/sdk/v2/client'

const EXT = 'xlsx|xlsm|docx|pptx|pdf|html|htm'
/** Ruta absoluta (posix o con unidad de Windows) que termina en una extensión de documento; admite espacios y acentos. */
const ABS_RE = new RegExp(`(?:(?<![\\w/.~:-])\\/|(?<![\\w])[A-Za-z]:[\\\\/])[^\\n"'\`<>|*?]{0,300}?\\.(?:${EXT})(?![\\w])`, 'gi')
/** Palabra suelta (sin espacios) con extensión de documento: sirve para rutas relativas en la salida de un comando. */
const TOKEN_RE = new RegExp(`[^\\s"'\`<>|*?:()\\[\\]{},;]+\\.(?:${EXT})(?![\\w])`, 'gi')
/** Destino de una redirección o de `-o`/`--output` en el texto de un comando. */
const REDIR_RE = new RegExp(`(?:\\s>>?|\\s-o|\\s--(?:output|outfile|out|to))[\\s=]+["']?([^\\s"'<>|;&]+\\.(?:${EXT}))(?![\\w])`, 'gi')

const WRITE_TOOLS = new Set(['write', 'edit', 'multiedit'])
const PATCH_TOOLS = new Set(['patch', 'apply_patch'])

const isAbs = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)
const isDocPath = (p: string): boolean => new RegExp(`\\.(?:${EXT})$`, 'i').test(p)

/** Normaliza `.` y `..` y las barras repetidas (sin tocar el disco). */
export function normalizeAbs(p: string): string {
  const win = /^[A-Za-z]:/.test(p)
  const sep = win ? '\\' : '/'
  const drive = win ? p.slice(0, 2) : ''
  const parts = (win ? p.slice(2) : p).split(/[\\/]+/)
  const out: string[] = []
  for (const s of parts) {
    if (!s || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return drive + sep + out.join(sep)
}

/** Resuelve una ruta (absoluta o relativa al proyecto) a absoluta normalizada; `null` si es relativa y no hay proyecto. */
function resolvePath(p: string, root: string | null): string | null {
  const clean = p.trim().replace(/^file:\/\//, '')
  if (!clean || clean.includes('\0')) return null
  if (isAbs(clean)) return normalizeAbs(clean)
  if (!root || clean.startsWith('~')) return null
  return normalizeAbs(`${root}/${clean}`)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Rutas de archivo que nombra un parche (`*** Add/Update File:`, `+++ b/…`). */
function patchPaths(patch: string): string[] {
  const out: string[] = []
  for (const m of patch.matchAll(/^\*{3} (?:Add|Update|Move to) File:\s*(.+)$/gm)) out.push(m[1].trim())
  for (const m of patch.matchAll(/^\+{3} (?:b\/)?(.+)$/gm)) out.push(m[1].trim())
  return out
}

function scanText(text: string, relative: boolean, add: (p: string) => void): void {
  for (const m of text.matchAll(ABS_RE)) add(m[0])
  if (!relative) return
  // Sin las rutas absolutas ya vistas: «/a/Mis Docs/final.pdf» no debe leerse además como «final.pdf» relativo.
  for (const m of text.replace(ABS_RE, ' ').matchAll(TOKEN_RE)) {
    const tok = m[0]
    if (isAbs(tok) || tok.startsWith('~') || /^[a-z]+:\/\//i.test(tok)) continue
    add(tok)
  }
}

export interface DocScanInput {
  /** Partes de los mensajes del asistente del turno, en orden. */
  parts: readonly Part[]
  /** Carpeta del proyecto (para resolver rutas relativas). */
  root: string | null
}

/** Rutas absolutas candidatas a documento generado en el turno, sin duplicados y en orden de aparición. */
export function detectDocFiles({ parts, root }: DocScanInput): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const add = (raw: string): void => {
    const abs = resolvePath(raw, root)
    if (!abs || !isDocPath(abs) || seen.has(abs)) return
    seen.add(abs)
    found.push(abs)
  }
  for (const p of parts) {
    if (p.type === 'text') {
      if (!p.synthetic && !p.ignored) scanText(p.text, false, add)
      continue
    }
    if (p.type !== 'tool' || p.state.status !== 'completed') continue
    const input = (p.state.input ?? {}) as Record<string, unknown>
    const tool = p.tool
    if (WRITE_TOOLS.has(tool)) {
      const f = str(input.filePath) || str(input.path) || str(input.file_path)
      if (f) add(f)
    } else if (PATCH_TOOLS.has(tool)) {
      for (const f of patchPaths(str(input.patchText) || str(input.patch))) add(f)
    } else if (tool === 'bash') {
      const cmd = str(input.command)
      for (const m of cmd.matchAll(REDIR_RE)) add(m[1])
      scanText(str(p.state.output), true, add)
    }
  }
  return found
}
