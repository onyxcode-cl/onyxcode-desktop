/**
 * Consentimiento de la BETA OPCIONAL de Tareas (y, por añadidura, de Control del PC) en Windows (decisión del dueño, 2026-10-07).
 * Es la puerta del usuario: sin él `tasksWin` queda apagada (`resolveTasksWin`, `optIn`). Mismo patrón que
 * `computer/policy/consent-win.ts` (que se reutiliza: normalización, versión vigente, vista y controlador con casilla +
 * armado de 600 ms), pero con archivo PROPIO:
 *
 *  - `userData/tasks-win-beta-consent.json` = `{version, at}`, modo 0600, escritura atómica (`createFileConsentStore`).
 *  - Lo escribe SOLO `main`, por el canal `tasks:winBeta` (que exige casilla + armado). El renderer no puede fabricarlo:
 *    `settings.json` (que sí escribe, `settings:set`) NO cuenta; `settings.tasksWinBeta` es LEGADO e ignorado.
 *  - Ausente, corrupto, ilegible o de otra versión (anterior o posterior) = SIN consentimiento (falla cerrado). Subir
 *    `TASKS_WIN_BETA_CONSENT_VERSION` al cambiar lo que promete el aviso invalida los consentimientos anteriores.
 *  - Revocar es inmediato y se relee del disco en cada lectura, así que no hay estado en memoria que pueda quedar viejo.
 * Sin Electron: solo `node:fs`.
 */
import { join } from 'node:path'
import {
  createConsentController,
  isConsentValid,
  normalizeConsent,
  type ConsentController,
  type ConsentStore
} from '../computer/policy/consent-win'
import { createFileConsentStore } from '../computer/win-storage'

/** Versión del aviso de la beta. Subirla invalida los consentimientos guardados. */
export const TASKS_WIN_BETA_CONSENT_VERSION = 1
/** Archivo dentro de `userData`. */
export const TASKS_WIN_BETA_CONSENT_FILE = 'tasks-win-beta-consent.json'

export function tasksWinBetaConsentPath(userDataDir: string): string {
  return join(userDataDir, TASKS_WIN_BETA_CONSENT_FILE)
}

/** Almacén en disco del consentimiento (lectura que falla cerrado, escritura atómica, 0600). */
export function createTasksWinBetaStore(userDataDir: string): ConsentStore {
  return createFileConsentStore(tasksWinBetaConsentPath(userDataDir))
}

/** ¿Hay consentimiento beta VIGENTE? Es lo que `main` pasa como `optIn` a `resolveTasksWin`. Cualquier duda = `false`. */
export function readTasksWinBetaConsent(userDataDir: string, current: number = TASKS_WIN_BETA_CONSENT_VERSION): boolean {
  try {
    return isConsentValid(normalizeConsent(createTasksWinBetaStore(userDataDir).read()), current)
  } catch {
    return false
  }
}

/** Controlador de la tarjeta (casilla + armado de 600 ms + revocación inmediata) sobre un almacén. */
export function createTasksWinBetaController(
  store: ConsentStore,
  now: () => number = Date.now,
  current: number = TASKS_WIN_BETA_CONSENT_VERSION
): ConsentController {
  return createConsentController(store, now, current)
}
