/**
 * Gestor de archivos del proyecto (crear / renombrar / eliminar), siempre dentro de la raíz del proyecto.
 * Sin Electron: la Papelera llega inyectada (`shell.trashItem` en producción; carpeta de pruebas en E2E).
 *
 * Reglas (mismo espíritu que `discardTarget` de git/service.ts):
 *  - rutas relativas a la raíz, sin `..`, sin vacíos, sin absolutas; la raíz se compara con `realpath`;
 *  - ni la raíz ni nada dentro de `.git` (cualquier nivel, sin distinguir mayúsculas) se crea/renombra/elimina;
 *  - las carpetas intermedias no pueden ser enlaces simbólicos (no se escapa por ellos); el último componente
 *    NO se resuelve: un enlace simbólico se renombra/elimina como enlace;
 *  - nombres válidos (sin separadores, `..`, nombres reservados de Windows, longitud) y NUNCA se sobrescribe.
 */
import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { t } from '@shared/i18n'

export class FileOpError extends Error {}

const RESERVED_WIN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const CONTROL = /[\u0000-\u001f\u007f]/

/** Valida el nombre de UNA entrada. Devuelve el nombre tal cual (sin recortar) o lanza `FileOpError`. */
export function validateName(name: unknown, platform: string = process.platform): string {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') throw new FileOpError(t('common.files.invalidName'))
  if (CONTROL.test(name) || /[/\\]/.test(name) || name.includes(':')) throw new FileOpError(t('common.files.invalidName'))
  if (platform === 'win32' && /[<>"|?*]/.test(name)) throw new FileOpError(t('common.files.invalidName'))
  if (name !== name.trim() || name.endsWith('.')) throw new FileOpError(t('common.files.invalidName'))
  if (Buffer.byteLength(name, 'utf8') > 255) throw new FileOpError(t('common.files.tooLong'))
  // Reservados de Windows: se rechazan en todas las plataformas (el proyecto puede acabar en un equipo Windows).
  if (RESERVED_WIN.test(name)) throw new FileOpError(t('common.files.reserved', { name }))
  if (name.toLowerCase() === '.git') throw new FileOpError(t('common.files.protected', { path: name }))
  return name
}

/** Raíz real del proyecto (debe existir y ser carpeta). */
export function projectRoot(cwd: string): string {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0'))
    throw new FileOpError(t('common.files.outside', { path: String(cwd) }))
  const abs = resolve(cwd)
  try {
    if (!statSync(abs).isDirectory()) throw new Error('no es carpeta')
    return realpathSync(abs)
  } catch {
    throw new FileOpError(t('common.files.notFound', { path: abs }))
  }
}

export interface Target {
  /** Ruta relativa a la raíz, con `/` (`''` = la raíz). */
  rel: string
  abs: string
}

/**
 * Resuelve una ruta relativa dentro de la raíz real. `allowRoot`: acepta `''`/`.` (la raíz) como destino
 * (carpeta contenedora al crear). Las carpetas intermedias que existan no pueden ser enlaces simbólicos.
 */
export function projectTarget(realRoot: string, input: string, opts: { allowRoot?: boolean } = {}): Target {
  if (typeof input !== 'string' || input.includes('\0')) throw new FileOpError(t('common.files.outside', { path: String(input) }))
  const p = input === '.' ? '' : input
  if (p === '') {
    if (!opts.allowRoot) throw new FileOpError(t('common.files.protected', { path: '.' }))
    return { rel: '', abs: realRoot }
  }
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p)) throw new FileOpError(t('common.files.outside', { path: p }))
  const parts = p.split(/[\\/]/)
  if (parts.includes('..')) throw new FileOpError(t('common.files.outside', { path: p }))
  if (parts.some((x) => x === '' || x === '.')) throw new FileOpError(t('common.files.outside', { path: p }))
  if (parts.some((x) => x.toLowerCase() === '.git')) throw new FileOpError(t('common.files.protected', { path: p }))
  const abs = join(realRoot, ...parts)
  // Defensa adicional: tras normalizar debe seguir bajo la raíz.
  const rel = relative(realRoot, abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new FileOpError(t('common.files.outside', { path: p }))
  let cur = realRoot
  for (const part of parts.slice(0, -1)) {
    cur = join(cur, part)
    let st
    try {
      st = lstatSync(cur)
    } catch {
      break // aún no existe: nada que seguir
    }
    if (st.isSymbolicLink()) throw new FileOpError(t('common.files.symlinkDir', { path: p }))
  }
  return { rel: parts.join('/'), abs }
}

const lstatOrNull = (p: string): ReturnType<typeof lstatSync> | null => {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}

function wrap(err: unknown): FileOpError {
  if (err instanceof FileOpError) return err
  return new FileOpError(t('common.files.opFailed', { reason: (err as Error)?.message ?? String(err) }))
}

/** Crea un archivo vacío o una carpeta dentro de `parent` (relativa a la raíz). Nunca sobrescribe. */
export function createEntry(cwd: string, parent: string, name: string, kind: 'file' | 'dir'): { path: string } {
  const root = projectRoot(cwd)
  validateName(name)
  const dir = projectTarget(root, parent, { allowRoot: true })
  const st = lstatOrNull(dir.abs)
  if (!st) throw new FileOpError(t('common.files.notFound', { path: dir.rel || '.' }))
  if (!st.isDirectory()) throw new FileOpError(t('common.files.notDir', { path: dir.rel || '.' }))
  const target = projectTarget(root, dir.rel ? `${dir.rel}/${name}` : name)
  if (lstatOrNull(target.abs)) throw new FileOpError(t('common.files.exists', { name }))
  try {
    if (kind === 'dir') mkdirSync(target.abs)
    else closeSync(openSync(target.abs, 'wx')) // 'wx': falla si existe (sin condición de carrera)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') throw new FileOpError(t('common.files.exists', { name }))
    throw wrap(err)
  }
  return { path: target.rel }
}

/** Renombra una entrada (en su misma carpeta). Un enlace simbólico se renombra como enlace. Nunca sobrescribe. */
export function renameEntry(cwd: string, path: string, name: string): { path: string } {
  const root = projectRoot(cwd)
  validateName(name)
  const src = projectTarget(root, path)
  const srcSt = lstatOrNull(src.abs)
  if (!srcSt) throw new FileOpError(t('common.files.notFound', { path: src.rel }))
  const parts = src.rel.split('/')
  parts[parts.length - 1] = name
  const dst = projectTarget(root, parts.join('/'))
  if (dst.rel === src.rel) return { path: src.rel }
  const dstSt = lstatOrNull(dst.abs)
  if (dstSt) {
    // Solo cambia mayúsculas/minúsculas en un disco que no las distingue: es la misma entrada.
    const same = dstSt.ino === srcSt.ino && dstSt.dev === srcSt.dev && dst.rel.toLowerCase() === src.rel.toLowerCase()
    if (!same) throw new FileOpError(t('common.files.exists', { name }))
  }
  try {
    renameSync(src.abs, dst.abs)
  } catch (err) {
    throw wrap(err)
  }
  return { path: dst.rel }
}

/** Manda la entrada a la Papelera (nunca borrado definitivo). Un enlace simbólico va como enlace. */
export async function trashEntry(cwd: string, path: string, trash: (abs: string) => Promise<void>): Promise<void> {
  const root = projectRoot(cwd)
  const tg = projectTarget(root, path)
  if (!lstatOrNull(tg.abs)) throw new FileOpError(t('common.files.notFound', { path: tg.rel }))
  try {
    await trash(tg.abs)
  } catch (err) {
    throw new FileOpError(t('common.files.trashFailed', { reason: (err as Error)?.message ?? String(err) }))
  }
}
