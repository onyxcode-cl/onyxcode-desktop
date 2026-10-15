/**
 * Archivos de documento que el asistente generó en disco (tarjeta de archivo del modo Code).
 * Todo lo que llega del renderer se valida aquí: ruta absoluta, dentro de la carpeta del proyecto (con `realpath`, así un
 * enlace simbólico que escapa se rechaza), extensión de documento (nunca ejecutables) y archivo regular sin bit de ejecución.
 */
import { realpathSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, sep } from 'node:path'
import { assertSafeToOpen } from '../tasks/open-policy'

export const DOC_FILE_EXTS = ['.xlsx', '.xlsm', '.docx', '.pptx', '.pdf', '.html', '.htm'] as const
const EXTS = new Set<string>(DOC_FILE_EXTS)

export interface DocFileInfo {
  /** Ruta del archivo (la misma que pidió el renderer). */
  path: string
  name: string
  bytes: number
}

export class DocFileError extends Error {}

/** Valida y resuelve; lanza `DocFileError` si no es un documento permitido dentro de `root`. `path` del resultado es la ruta real. */
export function resolveDocFile(root: string, path: string): DocFileInfo {
  if (typeof path !== 'string' || !path || path.includes('\0') || !isAbsolute(path)) throw new DocFileError('Ruta inválida')
  if (!EXTS.has(extname(path).toLowerCase())) throw new DocFileError('Tipo de archivo no permitido')
  let realRoot: string
  let real: string
  try {
    realRoot = realpathSync(root)
    real = realpathSync(path)
  } catch {
    throw new DocFileError('El archivo no existe')
  }
  // La extensión también se comprueba sobre la ruta real (un enlace «a.pdf» hacia «x.sh» se rechaza).
  if (!EXTS.has(extname(real).toLowerCase())) throw new DocFileError('Tipo de archivo no permitido')
  const base = realRoot.endsWith(sep) ? realRoot : realRoot + sep
  if (!real.startsWith(base)) throw new DocFileError('El archivo está fuera de la carpeta del proyecto')
  const st = statSync(real)
  if (!st.isFile()) throw new DocFileError('No es un archivo')
  try {
    assertSafeToOpen(real)
  } catch {
    throw new DocFileError('Archivo no seguro para abrir')
  }
  return { path: real, name: basename(real), bytes: st.size }
}

/** Información de los candidatos que sí son válidos (los demás se omiten en silencio). Máximo 40. */
export function docFilesInfo(root: string, paths: string[]): DocFileInfo[] {
  const out: DocFileInfo[] = []
  const seen = new Set<string>()
  for (const p of paths.slice(0, 40)) {
    try {
      const info = resolveDocFile(root, p)
      if (seen.has(info.path)) continue
      seen.add(info.path)
      out.push({ ...info, path: p }) // el renderer reconoce su propia ruta; main revalida al abrir
    } catch {
      // candidato inválido o inexistente: sin tarjeta
    }
  }
  return out
}
