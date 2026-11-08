/**
 * Workspace trust de Code: carpeta pendiente de confirmación + `openProjectTrusted`, la única
 * forma de abrir un proyecto desde una entrada de la UI (`TrustGate` en `ProjectPicker.tsx` pinta el diálogo).
 * La primera vez que se confía en una carpeta se guarda en `trustedFolders` (localStorage).
 *
 * W-A2: antes de decidir, se lee qué trae la carpeta (`project.scan`, solo disco, nunca el motor: el motor arranca los
 * conectores `local` del proyecto apenas la carga, así que esto tiene que pasar ANTES de abrir). El resultado alimenta el
 * diálogo (qué se ve) y las reglas de la sesión (`setFolderMcp`, en `permission-rules.ts`): cada conector de la carpeta
 * pregunta al usarse, salvo que la persona ya lo haya marcado de confianza en Ajustes.
 */
import { useEffect, useState } from 'react'
import type { ProjectScanItem, ProjectScanResult } from '@shared/ipc-code'
import { nativeCode } from './client'
import { clearFolderMcp, setFolderMcp } from './permission-rules'
import { useCode, type TrustedScan } from './store'
import { ensureFolderReadable } from './folder-access'

/** Lo que se le pide pintar al diálogo: la carpeta y, si hay algo que mostrar, el escaneo y qué parte es nueva. */
export interface PendingTrust {
  dir: string
  /** `null`: no se pudo revisar la carpeta (sin API nativa, o la lectura falló o venció el plazo). */
  scan: ProjectScanResult | null
  /** Elementos a listar en el diálogo (todo, o solo lo nuevo si la carpeta ya era de confianza). */
  items: ProjectScanItem[]
  /** La carpeta YA era de confianza: esto es una re-pregunta porque trajo algo nuevo. */
  again: boolean
}

let pendingTrustResolve: ((trust: boolean) => void) | null = null
const trustListeners = new Set<(p: PendingTrust | null) => void>()
let pendingTrust: PendingTrust | null = null

function setPendingTrust(p: PendingTrust | null): void {
  pendingTrust = p
  for (const l of trustListeners) l(p)
}

/** Hook: carpeta esperando confirmación de confianza (o `null`). */
export function usePendingTrust(): PendingTrust | null {
  const [p, setP] = useState(pendingTrust)
  useEffect(() => {
    trustListeners.add(setP)
    setP(pendingTrust)
    return () => {
      trustListeners.delete(setP)
    }
  }, [])
  return p
}

/** Lee qué trae la carpeta. `null` si no hay API nativa (pruebas, celular sin motor) o la lectura falla: nunca lanza. */
async function scanFolder(dir: string): Promise<ProjectScanResult | null> {
  const native = nativeCode()
  if (!native || typeof native.project?.scan !== 'function') return null
  try {
    return await native.project.scan(dir)
  } catch {
    return null
  }
}

const scanToTrustedScan = (scan: ProjectScanResult): TrustedScan => ({ huella: scan.huella, ids: scan.items.map((i) => i.id) })

/**
 * Si la carpeta no es de confianza, pide confirmación (resuelve `true`/`false`). Si ya lo es, puede igual repreguntar si
 * trajo algo nuevo desde la última vez (huella distinta y conectores o complementos que no estaban). Una petición nueva
 * mientras hay otra pendiente resuelve la anterior con `false` (no queda colgada).
 */
export function ensureTrusted(dir: string): Promise<boolean> {
  if (useCode.getState().isTrusted(dir)) return ensureTrustedAgain(dir)
  // Carpeta nueva: se pregunta de inmediato, SIN esperar el escaneo (que puede tardar hasta ~3 s en una carpeta de red). Mientras tanto
  // las reglas de esta sesión preguntan por CUALQUIER conector (falla cerrado); el escaneo llega después y afina el diálogo y las reglas.
  setFolderMcp(dir, null)
  const promise = showDialog(dir, null, [], false)
  void scanFolder(dir).then((scan) => {
    setFolderMcp(dir, scan)
    // Solo si el diálogo sigue abierto y es el de esta MISMA carpeta (si ya se resolvió, o es otra carpeta, no se toca).
    if (pendingTrust && pendingTrust.dir === dir) setPendingTrust({ dir, scan, items: scan ? scan.items : [], again: false })
  })
  return promise
}

/** Carpeta ya de confianza: se escanea antes de decidir (sin dialogo visible mientras tanto) si hace falta repreguntar. */
async function ensureTrustedAgain(dir: string): Promise<boolean> {
  const scan = await scanFolder(dir)
  setFolderMcp(dir, scan)
  if (!scan) return true // no se pudo revisar ahora: no se bloquea (las reglas quedan en `askAll`, falla cerrado)
  const prev = useCode.getState().trustedScans[dir]
  if (prev && prev.huella === scan.huella) return true
  // Confianza vieja sin huella (versión anterior) o huella distinta: solo repregunta si hay algo NUEVO que valga la pena ver.
  const seen = new Set(prev?.ids ?? [])
  const risky = scan.items.filter((i) => i.risky)
  const toShow = prev ? risky.filter((i) => !seen.has(i.id)) : risky
  if (toShow.length === 0) {
    // Nada nuevo que importe (o primera huella de una carpeta vieja sin nada riesgoso): se guarda en silencio.
    useCode.getState().trustFolder(dir, scanToTrustedScan(scan))
    return true
  }
  return showDialog(dir, scan, toShow, true)
}

function showDialog(dir: string, scan: ProjectScanResult | null, items: ProjectScanItem[], again: boolean): Promise<boolean> {
  pendingTrustResolve?.(false)
  pendingTrustResolve = null
  return new Promise<boolean>((resolve) => {
    pendingTrustResolve = resolve
    setPendingTrust({ dir, scan, items, again })
  })
}

export function resolveTrust(trust: boolean): void {
  const p = pendingTrust
  const resolve = pendingTrustResolve
  pendingTrustResolve = null
  setPendingTrust(null)
  if (trust && p) {
    if (p.scan) useCode.getState().trustFolder(p.dir, scanToTrustedScan(p.scan))
    else useCode.getState().trustFolder(p.dir)
  } else if (!trust && p) {
    // No confió: las reglas de esta carpeta no se guardan con lo que trajo este escaneo (se repite igual al reintentar).
    clearFolderMcp(p.dir)
  }
  resolve?.(trust)
}

/**
 * Confirma la confianza (si hace falta), comprueba que macOS deja leer la carpeta (F8-B210) y abre el proyecto. Devuelve `false`
 * si el usuario no confió o si la carpeta no se puede leer (en ese caso queda la tarjeta de permisos y no se arranca el motor).
 */
export async function openProjectTrusted(dir: string, opts: { passive?: boolean; fresh?: boolean } = {}): Promise<boolean> {
  if (!(await ensureTrusted(dir))) return false
  // Acción de la persona: si macOS guardó un «No permitir», se vuelve a preguntar (ver `ensureFolderReadable`). `passive` (restaurar al
  // arrancar) nunca insiste.
  if (!(await ensureFolderReadable(dir, { reask: !opts.passive }))) return false
  if (opts.fresh) await useCode.getState().openProject(dir, { fresh: true })
  else await useCode.getState().openProject(dir)
  return true
}
