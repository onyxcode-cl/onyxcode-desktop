/**
 * Carpeta que macOS no deja leer (F8-B210): estado de la tarjeta «macOS no dejó a Lazunox leer esta carpeta» y la comprobación
 * previa a abrir un proyecto. Va aparte de la confianza (`trust.ts`): aquí no se decide si fiarse de la carpeta, sino si el
 * sistema deja leerla. Sin caché: cada intento vuelve a leer la carpeta desde el proceso principal.
 */
import { useEffect, useState } from 'react'
import { nativeCode } from './client'

export interface BlockedFolder {
  dir: string
  /** `denied`: macOS dijo que no. `timeout`: no respondió (aviso sin contestar o volumen colgado). */
  reason: 'denied' | 'timeout'
  /** La carpeta está en una zona que macOS protege con permiso propio: se puede pedir que vuelva a preguntar. */
  canReset?: boolean
  /**
   * `engine`: Lazunox sí puede leerla, pero el motor (lanzado con `lazunox-disclaim`, identidad TCC propia) no. Entonces NO se ofrece
   * «Volver a preguntar a macOS»: `tccutil reset … <APP_ID>` solo borra la decisión de Lazunox y no puede restablecer un ejecutable
   * suelto como el motor; la salida es activarlo en Ajustes del Sistema y «Volver a comprobar».
   */
  cause?: 'app' | 'engine'
  /** El último «Volver a preguntar» no pudo borrar la decisión: la tarjeta lo dice y queda «Abrir Ajustes del Sistema». */
  resetFailed?: boolean
}

let blocked: BlockedFolder | null = null
const listeners = new Set<(b: BlockedFolder | null) => void>()

export function setBlockedFolder(b: BlockedFolder | null): void {
  blocked = b
  for (const l of listeners) l(b)
}

/** Hook: carpeta bloqueada actual (o `null`). */
export function useBlockedFolder(): BlockedFolder | null {
  const [b, setB] = useState(blocked)
  useEffect(() => {
    listeners.add(setB)
    setB(blocked)
    return () => {
      listeners.delete(setB)
    }
  }, [])
  return b
}

/**
 * `true` si se puede seguir abriendo la carpeta. Si macOS la deniega (o no responde) deja la tarjeta visible y devuelve `false`.
 * Falla abierto: sin API nativa (celular) o ante un error de la propia comprobación, sigue adelante y que el motor informe.
 */
export async function ensureFolderReadable(dir: string, opts: { reask?: boolean } = {}): Promise<boolean> {
  const native = nativeCode('dialogs')
  if (!native || typeof native.dialog?.checkFolderAccess !== 'function') return true
  try {
    let { status, canReset, cause } = await native.dialog.checkFolderAccess(dir)
    // Acción EXPLÍCITA de la persona (elegir carpeta, abrir un reciente…) y macOS tiene guardado un «No permitir» para esa zona: se borra
    // esa decisión (la de Lazunox y la de su motor) y se vuelve a comprobar UNA vez, lo que hace que macOS muestre otra vez «Permitir /
    // No permitir». Así un clic equivocado en «No permitir» no deja la zona bloqueada para siempre. Si vuelve a decir que no, queda la
    // tarjeta (nunca hay bucle). Las comprobaciones pasivas (`reask` falso) jamás insisten.
    if (opts.reask && status === 'denied' && canReset === true && typeof native.dialog.resetFolderPermission === 'function') {
      const reset = await native.dialog
        .resetFolderPermission(dir, cause === 'engine' ? 'engine' : 'all')
        .then((r) => r?.result)
        .catch(() => 'failed' as const)
      if (reset === 'reset') {
        lastResetFailed = null
        ;({ status, canReset, cause } = await native.dialog.checkFolderAccess(dir))
      } else {
        lastResetFailed = dir
      }
    }
    if (status === 'denied' || status === 'timeout') {
      setBlockedFolder({
        dir,
        reason: status,
        cause: cause === 'engine' ? 'engine' : 'app',
        canReset: canReset === true && status === 'denied',
        resetFailed: prevResetFailed(dir)
      })
      return false
    }
  } catch {
    return true
  }
  if (lastResetFailed === dir) lastResetFailed = null
  setBlockedFolder(null)
  return true
}

let lastResetFailed: string | null = null
function prevResetFailed(dir: string): boolean {
  return lastResetFailed === dir
}

/**
 * «Volver a preguntar a macOS» (solo tras el clic): pide a main que borre la decisión de privacidad de Lazunox para esa zona y vuelve
 * a comprobar la carpeta, lo que hace que macOS muestre de nuevo «Permitir / No permitir». `onOpen` abre el proyecto si ya se puede.
 */
export async function askMacAgain(
  dir: string,
  onOpen: (dir: string, opts?: { passive?: boolean }) => Promise<unknown>,
  scope: 'all' | 'engine' = 'all'
): Promise<void> {
  const native = nativeCode('dialogs')
  let result: 'reset' | 'failed' | 'unsupported' = 'failed'
  try {
    result = (await native?.dialog.resetFolderPermission(dir, scope))?.result ?? 'failed'
  } catch {
    result = 'failed'
  }
  lastResetFailed = result === 'reset' ? null : dir
  setBlockedFolder(null)
  // Ya se acaba de borrar la decisión por este clic: la nueva comprobación no vuelve a borrarla (máximo un aviso por clic).
  await onOpen(dir, { passive: true })
}
