/**
 * Archivo de ganchos de usuario (`userData/hooks/hooks.json`, carpeta 0700, archivo 0600; ver `@shared/user-hooks`). Es el ÚNICO sitio del que el
 * motor lee ganchos: un proyecto no puede traer los suyos. La app lo crea solo cuando la persona guarda algo; escritura atómica (temporal con
 * modo 0600 + rename). El contenido no se registra: los errores de aquí solo llevan el código del sistema, nunca el texto.
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOOKS_DIR_NAME, HOOKS_FILE_NAME, HOOKS_MAX_FILE_BYTES, validateHooksText, type HooksIssue } from '@shared/user-hooks'
import { settingsStore } from '../store'

export { HOOKS_DIR_NAME, HOOKS_FILE_NAME }

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

/** Huella sha256 (hexadecimal) de unos bytes. */
export const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Guarda la huella de lo que la persona acaba de guardar y apaga el aviso «Revisa tus ganchos». Es la ÚNICA vía (junto a la migración de
 * `store.ts`) por la que una huella llega a los Ajustes: el renderer no puede escribirla.
 */
const saveTrustInSettings = (sha: string): void => {
  settingsStore.set({ userHooksSha256: sha, userHooksReview: false })
}

/**
 * Valida (misma lógica que en la ventana) y escribe de forma atómica. Luego guarda la huella (sha256) de los bytes escritos: el motor solo ejecuta
 * un archivo que coincida con ella. Un fallo de disco, o de guardar la huella, devuelve el código `writeFailed` (con la huella vieja los ganchos
 * simplemente no corren hasta que se guarde de nuevo: falla cerrado).
 */
export function writeHooks(
  text: string,
  userData: string = app.getPath('userData'),
  saveTrust: (sha: string) => void = saveTrustInSettings
): WriteHooksResult {
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
    // La huella se calcula sobre ESTOS bytes, los mismos que se escriben (y que el motor leerá).
    const bytes = Buffer.from(v.text, 'utf8')
    const fd = openSync(tmp, 'wx', 0o600)
    try {
      writeFileSync(fd, bytes)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
    chmodSync(file, 0o600)
    saveTrust(sha256Hex(bytes))
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
