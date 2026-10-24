/**
 * Archivo de ganchos de usuario (`userData/hooks/hooks.json`, carpeta 0700, archivo 0600; ver `@shared/user-hooks`). Es el ÚNICO sitio del que el
 * motor lee ganchos: un proyecto no puede traer los suyos. La app lo crea solo cuando la persona guarda algo; escritura atómica (temporal con
 * modo 0600 + rename). El contenido no se registra: los errores de aquí solo llevan el código del sistema, nunca el texto.
 */
import { app } from 'electron'
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { HOOKS_MAX_FILE_BYTES, validateHooksText, type HooksIssue } from '@shared/user-hooks'

export const HOOKS_DIR_NAME = 'hooks'
export const HOOKS_FILE_NAME = 'hooks.json'

export const hooksDir = (userData: string = app.getPath('userData')): string => join(userData, HOOKS_DIR_NAME)
export const hooksFile = (userData: string = app.getPath('userData')): string => join(hooksDir(userData), HOOKS_FILE_NAME)

/** Contenido guardado (`''` si todavía no hay archivo, o si no se puede leer o pesa más que el tope). Nunca lanza. */
export function readHooks(userData: string = app.getPath('userData')): { text: string; exists: boolean } {
  const file = hooksFile(userData)
  try {
    const st = statSync(file)
    if (!st.isFile() || st.size > HOOKS_MAX_FILE_BYTES) return { text: '', exists: st.isFile() }
    return { text: readFileSync(file, 'utf8'), exists: true }
  } catch {
    return { text: '', exists: false }
  }
}

export type WriteHooksResult = { ok: true } | { ok: false; issues: HooksIssue[] }

/** Valida (misma lógica que en la ventana) y escribe de forma atómica. Un fallo de disco devuelve el código `writeFailed`. */
export function writeHooks(text: string, userData: string = app.getPath('userData')): WriteHooksResult {
  const v = validateHooksText(text)
  if (!v.ok) return { ok: false, issues: v.issues }
  const dir = hooksDir(userData)
  const file = hooksFile(userData)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    chmodSync(dir, 0o700)
    // `wx` + 0600: el temporal nace privado; un temporal viejo de otro arranque se descarta antes.
    rmSync(tmp, { force: true })
    const fd = openSync(tmp, 'wx', 0o600)
    try {
      writeSync(fd, v.text)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
    chmodSync(file, 0o600)
    return { ok: true }
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // nada que limpiar
    }
    // Solo el código del sistema (EACCES, ENOSPC…): jamás el contenido ni la ruta.
    console.error('[ganchos] no se pudo guardar el archivo de ganchos:', (err as NodeJS.ErrnoException)?.code ?? 'desconocido')
    return { ok: false, issues: [{ code: 'writeFailed' }] }
  }
}
