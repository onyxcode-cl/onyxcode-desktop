/**
 * Detección de «Acceso total al disco» de macOS (F8-B210). Solo LEE: intenta abrir (sin leer contenido) recursos que macOS solo deja
 * abrir a las apps con ese permiso. Nunca pide nada al sistema ni muestra qué hay dentro. Si no se tiene el permiso la apertura falla
 * con EPERM/EACCES y macOS no muestra ninguna ventana (este permiso no se pregunta: solo se activa a mano en Ajustes).
 *
 * Sondas, en orden: `~/Library/Safari` (carpeta que siempre existe en un usuario normal y la más usada para esta prueba), la base de
 * permisos del usuario y la del sistema (`TCC.db`; solo se abre y se cierra, jamás se lee). `granted` si alguna se abre; `denied` si
 * alguna da EPERM/EACCES y ninguna se abrió; `unknown` si todas faltan, vencen o fallan por otra causa.
 */
import { open, opendir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type FullDiskState = 'granted' | 'denied' | 'unknown'

export interface FullDiskProbe {
  kind: 'dir' | 'file'
  path: string
}

export interface FullDiskDeps {
  probes: FullDiskProbe[]
  /** Abre y cierra el recurso sin leerlo; rechaza con el error del sistema. */
  open: (p: FullDiskProbe) => Promise<void>
  timeoutMs: number
}

export const FULL_DISK_TIMEOUT_MS = 1000

export function defaultFullDiskDeps(): FullDiskDeps {
  const home = homedir()
  return {
    probes: [
      { kind: 'dir', path: join(home, 'Library', 'Safari') },
      { kind: 'file', path: join(home, 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db') },
      { kind: 'file', path: '/Library/Application Support/com.apple.TCC/TCC.db' }
    ],
    timeoutMs: FULL_DISK_TIMEOUT_MS,
    open: async (p) => {
      if (p.kind === 'dir') await (await opendir(p.path)).close()
      else await (await open(p.path, 'r')).close()
    }
  }
}

export async function detectFullDiskAccess(deps: FullDiskDeps = defaultFullDiskDeps()): Promise<FullDiskState> {
  const one = async (p: FullDiskProbe): Promise<'ok' | 'denied' | 'other'> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<'other'>((r) => {
      timer = setTimeout(() => r('other'), deps.timeoutMs)
    })
    const attempt = deps.open(p).then(
      () => 'ok' as const,
      (err: NodeJS.ErrnoException | null) => (err?.code === 'EPERM' || err?.code === 'EACCES' ? ('denied' as const) : ('other' as const))
    )
    try {
      return await Promise.race([attempt, late])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const results = await Promise.all(deps.probes.map(one))
  if (results.includes('ok')) return 'granted'
  if (results.includes('denied')) return 'denied'
  return 'unknown'
}
