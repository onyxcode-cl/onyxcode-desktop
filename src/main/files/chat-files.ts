/**
 * Archivos que la IA crea o menciona en el Chat: qué son, si se pueden mostrar dentro de la app y si se pueden abrir con el programa
 * del sistema. Todo lo que llega del renderer se valida aquí (texto del modelo = dato no confiable):
 *  - ruta absoluta, sin NUL, dentro de las carpetas permitidas (con `realpath`: un enlace que escapa se rechaza) y archivo regular;
 *  - nunca ejecutables ni lanzadores (misma lista que Tareas, `open-policy.ts`, más algunos de Windows): ni se muestran ni se abren, solo
 *    «Mostrar en la carpeta»; tampoco archivos con bit de ejecución ni sin extensión;
 *  - archivos con nombre de secreto (`.env`, llaves, credenciales) no se ofrecen en absoluto.
 * Módulo sin Electron: las carpetas permitidas las entrega quien lo llama.
 */
import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, sep } from 'node:path'
import { BLOCKED_OPEN_EXTENSIONS } from '../tasks/open-policy'
import type { ChatFileInfo, ChatFileKind, ChatFileReadResult } from '@shared/ipc-extras'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.svg', '.ico'])
const MARKDOWN_EXTS = new Set(['.md', '.markdown'])
const TEXT_EXTS = new Set(['.txt', '.log', '.csv', '.tsv', '.text'])
const CODE_EXTS = new Set([
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.xml',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.scss',
  '.sql',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.swift',
  '.kt',
  '.vue',
  '.svelte',
  '.tex'
])
const HTML_EXTS = new Set(['.html', '.htm'])
/** Se muestran en el visor nativo (que revisa el tipo por bytes mágicos al abrir). */
const NATIVE_VIEW_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.pptx'])
const OFFICE_EXTS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.xlsm',
  '.pptx',
  '.doc',
  '.xls',
  '.ppt',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
  '.pages',
  '.numbers',
  '.key'
])

/**
 * Se pueden MOSTRAR como texto (no ejecutan nada al verse) pero abrirlos con el programa del sistema podría lanzarlos
 * (p. ej. `.js` con Windows Script Host, `.svg` en un navegador con scripts): para estos solo «Ver aquí» y «Mostrar en la carpeta».
 */
const NO_SYSTEM_OPEN_EXTENSIONS = new Set([
  '.js',
  '.jse',
  '.mjs',
  '.cjs',
  '.vbe',
  '.hta',
  '.reg',
  '.scr',
  '.cpl',
  '.msc',
  '.wsh',
  '.gadget',
  '.appimage',
  '.run',
  '.bin',
  '.svg'
])

/** Nombres que parecen secretos: no se ofrece ni verlos ni abrirlos. */
const SENSITIVE_NAME =
  /^(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|auth\.json|credentials(\..*)?|secrets?(\..*)?|.*\.(pem|key|p12|pfx|keystore|kdbx))$/i

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TEXT_BYTES = 512 * 1024
const MAX_PATHS = 40

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

export class ChatFileError extends Error {}

/** Tipo de archivo según la extensión (`blocked` = ejecutable o lanzador). */
export function classifyChatFile(path: string): ChatFileKind {
  const ext = extname(path).toLowerCase()
  if (BLOCKED_OPEN_EXTENSIONS.has(ext)) return 'blocked'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (HTML_EXTS.has(ext)) return 'html'
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (TEXT_EXTS.has(ext)) return 'text'
  if (CODE_EXTS.has(ext)) return 'code'
  if (OFFICE_EXTS.has(ext)) return 'office'
  return 'other'
}

/** ¿Se puede mostrar dentro de la app? */
export function canViewChatFile(path: string): boolean {
  const kind = classifyChatFile(path)
  if (kind === 'blocked' || kind === 'other') return false
  if (kind === 'office') return NATIVE_VIEW_EXTS.has(extname(path).toLowerCase())
  return true
}

/** ¿Se muestra con el visor nativo (PDF/Word/Excel/PowerPoint) y no como contenido en la propia interfaz? */
export function isNativeViewable(path: string): boolean {
  return NATIVE_VIEW_EXTS.has(extname(path).toLowerCase())
}

export function isSensitiveName(path: string): boolean {
  return SENSITIVE_NAME.test(basename(path))
}

function inside(real: string, realRoot: string): boolean {
  const base = realRoot.endsWith(sep) ? realRoot : realRoot + sep
  return real === realRoot || real.startsWith(base)
}

/** Valida y resuelve. `path` del resultado es la ruta real. Lanza `ChatFileError` si no es un archivo permitido. */
export function resolveChatFile(roots: readonly string[], path: string): ChatFileInfo {
  if (typeof path !== 'string' || !path || path.includes('\0') || !isAbsolute(path)) throw new ChatFileError('Ruta inválida')
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    throw new ChatFileError('El archivo no existe')
  }
  const realRoots: string[] = []
  for (const r of roots) {
    try {
      if (r) realRoots.push(realpathSync(r))
    } catch {
      // carpeta que ya no existe: no autoriza nada
    }
  }
  if (!realRoots.some((r) => inside(real, r))) throw new ChatFileError('El archivo está fuera de las carpetas permitidas')
  const st = statSync(real)
  if (!st.isFile()) throw new ChatFileError('No es un archivo')
  if (isSensitiveName(real) || isSensitiveName(path)) throw new ChatFileError('Archivo reservado')
  // El tipo se decide sobre la ruta real: un enlace «a.png» hacia «x.sh» no engaña.
  const kind = classifyChatFile(real)
  const ext = extname(real).toLowerCase()
  const executable = process.platform !== 'win32' && (st.mode & 0o111) !== 0
  const blocked = kind === 'blocked' || executable || !ext
  return {
    path: real,
    name: basename(real),
    bytes: st.size,
    kind: blocked ? 'blocked' : kind,
    canView: !blocked && canViewChatFile(real),
    canOpen: !blocked && !NO_SYSTEM_OPEN_EXTENSIONS.has(ext)
  }
}

/** Información de los candidatos válidos (los demás se omiten en silencio). Máximo 40, sin repetidos. */
export function chatFilesInfo(roots: readonly string[], paths: readonly string[]): ChatFileInfo[] {
  const out: ChatFileInfo[] = []
  const seen = new Set<string>()
  for (const p of paths.slice(0, MAX_PATHS)) {
    try {
      const info = resolveChatFile(roots, p)
      if (seen.has(info.path)) continue
      seen.add(info.path)
      out.push({ ...info, path: p }) // el renderer reconoce su propia ruta; main revalida en cada acción
    } catch {
      // candidato inválido o inexistente: sin tarjeta
    }
  }
  return out
}

/** Lanza si abrir con el programa del sistema no es seguro (ejecutables, lanzadores, secretos…). Devuelve la ruta real. */
export function assertOpenable(roots: readonly string[], path: string): string {
  const info = resolveChatFile(roots, path)
  if (!info.canOpen) throw new ChatFileError('Este tipo de archivo no se abre desde aquí')
  return info.path
}

/** «Mostrar en la carpeta»: vale para cualquier archivo permitido, también los ejecutables (no los ejecuta). */
export function assertRevealable(roots: readonly string[], path: string): string {
  return resolveChatFile(roots, path).path
}

/** Lanza si el archivo no se puede mostrar en el visor nativo (PDF/Office). Devuelve la ruta real. */
export function assertNativeViewable(roots: readonly string[], path: string): string {
  const info = resolveChatFile(roots, path)
  if (!info.canView || !isNativeViewable(info.path)) throw new ChatFileError('Este archivo no se puede mostrar aquí')
  return info.path
}

function readHead(path: string, max: number): { buf: Buffer; total: number } {
  const total = statSync(path).size
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(Math.min(total, max))
    const n = readSync(fd, buf, 0, buf.length, 0)
    return { buf: buf.subarray(0, n), total }
  } finally {
    closeSync(fd)
  }
}

/** Contenido para mostrar en la propia interfaz: imagen (data URL) o texto (con tope). El PDF/Office va por el visor nativo. */
export function readChatFile(roots: readonly string[], path: string): ChatFileReadResult {
  let info: ChatFileInfo
  try {
    info = resolveChatFile(roots, path)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (!info.canView || isNativeViewable(info.path)) return { ok: false, reason: 'unsupported' }
  try {
    if (info.kind === 'image') {
      if (info.bytes > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-large' }
      const { buf } = readHead(info.path, MAX_IMAGE_BYTES)
      const mime = IMAGE_MIME[extname(info.path).toLowerCase()] ?? 'application/octet-stream'
      return { ok: true, kind: 'image', dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    }
    const { buf, total } = readHead(info.path, MAX_TEXT_BYTES)
    if (buf.subarray(0, 8192).includes(0)) return { ok: false, reason: 'unsupported' }
    // Si se truncó a mitad de un carácter UTF-8, el último carácter inválido se descarta.
    const text = buf.toString('utf8').replace(/�$/, '')
    return { ok: true, kind: info.kind as 'text' | 'markdown' | 'code' | 'html', text, truncated: total > MAX_TEXT_BYTES }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}
