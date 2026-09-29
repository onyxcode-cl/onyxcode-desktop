/**
 * Workspace trust de Code: carpeta pendiente de confirmación + `openProjectTrusted`, la única
 * forma de abrir un proyecto desde una entrada de la UI (`TrustGate` en `ProjectPicker.tsx` pinta el diálogo).
 * La primera vez que se confía en una carpeta se guarda en `trustedFolders` (localStorage).
 */
import { useEffect, useState } from 'react'
import { useCode } from './store'

let pendingTrustResolve: ((trust: boolean) => void) | null = null
const trustListeners = new Set<(dir: string | null) => void>()
let pendingTrustDir: string | null = null

function setPendingTrust(dir: string | null): void {
  pendingTrustDir = dir
  for (const l of trustListeners) l(dir)
}

/** Hook: carpeta esperando confirmación de confianza (o `null`). */
export function usePendingTrust(): string | null {
  const [dir, setDir] = useState(pendingTrustDir)
  useEffect(() => {
    trustListeners.add(setDir)
    setDir(pendingTrustDir)
    return () => {
      trustListeners.delete(setDir)
    }
  }, [])
  return dir
}

/**
 * Si la carpeta no es de confianza, pide confirmación (resuelve `true`/`false`). Si ya lo es, `true` directo.
 * Una petición nueva mientras hay otra pendiente resuelve la anterior con `false` (no queda colgada).
 */
export function ensureTrusted(dir: string): Promise<boolean> {
  if (useCode.getState().isTrusted(dir)) return Promise.resolve(true)
  pendingTrustResolve?.(false)
  pendingTrustResolve = null
  return new Promise<boolean>((resolve) => {
    pendingTrustResolve = resolve
    setPendingTrust(dir)
  })
}

export function resolveTrust(trust: boolean): void {
  const dir = pendingTrustDir
  const resolve = pendingTrustResolve
  pendingTrustResolve = null
  setPendingTrust(null)
  if (trust && dir) useCode.getState().trustFolder(dir)
  resolve?.(trust)
}

/** Confirma la confianza (si hace falta) y abre el proyecto. Devuelve `false` si el usuario no confió. */
export async function openProjectTrusted(dir: string): Promise<boolean> {
  if (!(await ensureTrusted(dir))) return false
  await useCode.getState().openProject(dir)
  return true
}
