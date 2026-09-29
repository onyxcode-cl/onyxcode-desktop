/**
 * Política gestionada de Cowork (`managed.json`), de solo lectura.
 *
 * Ubicación: `/Library/Application Support/${APP_NAME}/managed.json` (solo un administrador puede
 * escribir ahí). En desarrollo (`!app.isPackaged`) se puede forzar otra ruta con la variable de
 * entorno `LAPIS_MANAGED_POLICY`.
 *
 * La política solo RESTRINGE (salvo `extraAllowedHosts`, decidido por la organización), y la
 * validación es estricta y falla hacia el lado seguro:
 *  - un booleano presente con un tipo inválido cuenta como `true` (restricción activa);
 *  - `allowedFolderRoots` inválido cuenta como lista vacía (no se permite ninguna carpeta);
 *  - un archivo ilegible o con JSON inválido activa todas las restricciones booleanas;
 *  - los hosts o valores numéricos inválidos se descartan (solo ampliarían permisos).
 */
import { app } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { APP_NAME } from '@shared/brand'
import type { ManagedPolicy } from '@shared/ipc-cowork'

const HOST_RE = /^[a-z0-9.-]{1,255}$/i
const BOOLEAN_KEYS = [
  'disableFullAccess',
  'disableCustomHosts',
  'disableAlwaysAllow',
  'disableRoutines',
  // Lote C: Modo auto y navegador propio, mismo criterio fail-closed que el resto.
  'disableAutoMode',
  'disableBrowser'
] as const

/** Política con todas las restricciones booleanas activas (archivo presente pero inválido). */
function lockedDown(source: string): ManagedPolicy {
  const out: ManagedPolicy = { source }
  for (const k of BOOLEAN_KEYS) out[k] = true
  return out
}

function expandRoot(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return resolve(p)
}

/** Valida y normaliza el contenido de un `managed.json` ya parseado. Puro (probable sin Electron). */
export function parseManagedPolicy(raw: unknown, source: string): ManagedPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return lockedDown(source)
  const r = raw as Record<string, unknown>
  const out: ManagedPolicy = { source }

  for (const k of BOOLEAN_KEYS) {
    if (!(k in r)) continue
    // Fail-closed: cualquier valor que no sea exactamente `false` activa la restricción.
    if (r[k] !== false) out[k] = true
  }

  if ('allowedFolderRoots' in r) {
    const v = r.allowedFolderRoots
    if (Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '')) {
      // Rutas absolutas o con `~`; las relativas se descartan (no tienen sentido en una política).
      const roots = (v as string[]).map((x) => x.trim()).filter((x) => x === '~' || x.startsWith('~/') || x.startsWith('/'))
      out.allowedFolderRoots = roots.map(expandRoot)
    } else {
      out.allowedFolderRoots = []
    }
  }

  if (Array.isArray(r.extraAllowedHosts)) {
    const hosts = (r.extraAllowedHosts as unknown[])
      .filter((h): h is string => typeof h === 'string' && HOST_RE.test(h.trim()))
      .map((h) => h.trim().toLowerCase())
    if (hosts.length) out.extraAllowedHosts = [...new Set(hosts)]
  }

  const days = r.maxAutoArchiveDays
  if (typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 365) out.maxAutoArchiveDays = days
  return out
}

function policyFile(): string {
  const override = process.env.LAPIS_MANAGED_POLICY
  if (override && !app.isPackaged) return resolve(override)
  return join('/Library/Application Support', APP_NAME, 'managed.json')
}

interface Cached {
  file: string
  mtimeMs: number
  size: number
  policy: ManagedPolicy | null
}
let cache: Cached | null = null

/**
 * Política gestionada vigente, o `null` si no hay `managed.json`. Se relee solo si el archivo
 * cambia (mtime/tamaño), así que un cambio del administrador surte efecto sin reiniciar.
 * `file` permite forzar la ruta (pruebas).
 */
export function loadManagedPolicy(file: string = policyFile()): ManagedPolicy | null {
  let st
  try {
    st = statSync(file)
  } catch {
    cache = { file, mtimeMs: 0, size: 0, policy: null }
    return null
  }
  if (cache && cache.file === file && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.policy
  let policy: ManagedPolicy
  try {
    policy = parseManagedPolicy(JSON.parse(readFileSync(file, 'utf8')), file)
  } catch (err) {
    console.error('[cowork] managed.json ilegible; se aplican todas las restricciones:', err)
    policy = lockedDown(file)
  }
  cache = { file, mtimeMs: st.mtimeMs, size: st.size, policy }
  return policy
}
