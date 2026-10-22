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
export async function ensureFolderReadable(dir: string): Promise<boolean> {
  const native = nativeCode('dialogs')
  if (!native || typeof native.dialog?.checkFolderAccess !== 'function') return true
  try {
    const { status, canReset } = await native.dialog.checkFolderAccess(dir)
    if (status === 'denied' || status === 'timeout') {
      setBlockedFolder({ dir, reason: status, canReset: canReset === true && status === 'denied', resetFailed: prevResetFailed(dir) })
      return false
    }
  } catch {
    return true
  }
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
export async function askMacAgain(dir: string, onOpen: (dir: string) => Promise<unknown>): Promise<void> {
  const native = nativeCode('dialogs')
  let result: 'reset' | 'failed' | 'unsupported' = 'failed'
  try {
    result = (await native?.dialog.resetFolderPermission(dir))?.result ?? 'failed'
  } catch {
    result = 'failed'
  }
  lastResetFailed = result === 'reset' ? null : dir
  setBlockedFolder(null)
  await onOpen(dir)
}
