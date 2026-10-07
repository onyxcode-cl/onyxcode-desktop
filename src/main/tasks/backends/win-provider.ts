/**
 * Constructor del backend de Tareas en Windows (distro WSL propia) para `selectBackend` (W5). NO se enlaza si la bandera
 * `tasksWin` está apagada: `main` solo lo construye en win32 y `selectBackend` exige además `TASKS_WIN_BUILD`.
 *
 * Falla CERRADO en cada eslabón (devuelve `null`/`{ok:false}`; `selectBackend` lo convierte en `WinBackendUnavailable`):
 *  - `create()`: sin pin válido (`wsl-rootfs` + OpenCode de Linux), sin `%LOCALAPPDATA%` o con una ruta de Windows rara → `null`.
 *    El backend recibe `localSource`: `<resources>/wsl/images/<imagen o opencode>` si el archivo existe (instalación sin red).
 *  - `gate()` (decisión del dueño, 2026-10-07: SUSTITUYE a la guardia de informes del PC; `tasks-win-report.ts` queda archivado
 *    sin uso en producción; el mismo día se quitó también el consentimiento beta — «no quiero nada beta» — así que esta puerta
 *    es ahora la ÚNICA que protege el arranque). Se consulta en CADA arranque de servidor y exige TODO, en este orden:
 *      1. `elevated`: Lazunox NO corre elevado (administrador). Si no se sabe, se trata como elevado;
 *      2. `pin`: `pin.json` empaquetado válido (`wsl-rootfs` + `assets['linux-x64']`);
 *      3. `bundle`: huella del paquete incluido (`<resources>/wsl/images/`): `lstat` sin enlaces, tamaño y sha256 en flujo contra
 *         el pin (hash cacheado por ruta+tamaño+mtime, solo los aciertos). Es integridad contra corrupción, NO contra un
 *         atacante local con permiso de escritura (puede cambiar archivo y pin a la vez);
 *      4. `payload`: la carga de Linux (los `.py`) se lee y se calcula su `expectedPayloadSha` con la huella del pin;
 *      5. `state` (solo `run`): `state.json` del usuario con `rootfsSha === pin.rootfs.sha256` y `payloadSha` igual al calculado
 *         (cierra el hueco de `wsl-status`, que solo compara el número de versión);
 *      6. `policy` (solo `run`): política `disableWslTasks`.
 *    Para `purpose: 'setup'` (preparar o consultar la distro desde la tarjeta) se omite 5 y 6: la primera instalación todavía
 *    no tiene `state.json` y la política la informa el estado `policyDisabled` del backend.
 *    Que la distro esté `ready` NO lo comprueba la puerta: lo hace `startTasksServer` con `backend.status()`.
 * Nada de esto se ha probado en un Windows real.
 */
import { lstat, readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { sha256File } from '../../remote/tunnel/binary'
import type { FetchLike } from '../../remote/tunnel/binary'
import { detectElevated } from '../win-elevation'
import type { GatePurpose, GateReason, GateResult, WinBackendProvider } from './index'
import { createWslBackend } from './wsl'
import { createRealWslDeps, PAYLOAD_PY_NAMES, readPayloadPyFiles, readSetupPin } from './wsl-real-deps'
import { expectedPayloadSha, parseSetupPin, wslSetupPaths, type SetupPin } from './wsl-setup'

export interface WinProviderDirs {
  /** `pin.json` (raíz de confianza: versión de OpenCode, URL y sha de su `linux-x64`, y `wsl-rootfs`). */
  pinJson: string
  /** Carpeta con los `.py` de la carga de Linux. */
  payloadDir: string
  /** Imagen y OpenCode de Linux incluidos (`<resources>/wsl/images`). Por defecto `<payloadDir>/images`. */
  imagesDir?: string
  /** OBSOLETO (informes de la guardia archivada): se ignora. */
  evidenceDir?: string
}

export interface WinProviderOptions {
  dirs: WinProviderDirs
  /** `createManualFetch(net)`. */
  fetch: FetchLike
  /** `process.env` del anfitrión (solo se reenvía lo permitido a `wsl.exe`). */
  hostEnv: Record<string, string | undefined>
  /** Política de la organización (`disableWslTasks`). */
  policyDisabled?: () => boolean
  /** Para pruebas; por defecto la constante real. */
  build?: boolean
  log?: (m: string) => void
  /** `true` elevado, `false` normal, cualquier otra cosa = elevado (cierra). Por defecto `whoami /groups`. */
  isElevated?: () => Promise<boolean | null>
  /** Contenido de `state.json` (por defecto, el del usuario en `%LOCALAPPDATA%\\Lazunox\\wsl`). Pruebas. */
  readState?: () => Promise<unknown>
}

const OPENCODE_IMAGE = 'opencode-linux-x64.tar.gz'
const rootfsImageName = (version: string): string => `lazunox-rootfs-${version}-x64.tar.gz`

// ───────── Huella del paquete incluido ─────────

/** sha256 ya calculado por (ruta) y validez por tamaño+mtime. Solo se guardan los ACIERTOS: un hash malo se recalcula. */
const fingerprintCache = new Map<string, { size: number; mtimeMs: number; sha: string }>()
export function clearBundleFingerprintCache(): void {
  fingerprintCache.clear()
}
export function bundleFingerprintCacheSize(): number {
  return fingerprintCache.size
}

async function fileMatches(path: string, size: number, sha256: string): Promise<boolean> {
  const st = await lstat(path)
  if (st.isSymbolicLink() || !st.isFile() || st.size !== size) return false
  const hit = fingerprintCache.get(path)
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha === sha256
  const got = await sha256File(path)
  if (got !== sha256) {
    fingerprintCache.delete(path)
    return false
  }
  fingerprintCache.set(path, { size: st.size, mtimeMs: st.mtimeMs, sha: got })
  return true
}

/** ¿El paquete incluido es EXACTAMENTE el del pin? Ausente, enlace, carpeta, otro tamaño u otro sha = `false`. */
export async function bundleFingerprintOk(imagesDir: string, pin: SetupPin): Promise<boolean> {
  try {
    return (
      (await fileMatches(join(imagesDir, rootfsImageName(pin.rootfs.version)), pin.rootfs.size, pin.rootfs.sha256)) &&
      (await fileMatches(join(imagesDir, OPENCODE_IMAGE), pin.opencode.size, pin.opencode.sha256))
    )
  } catch {
    return false
  }
}

// ───────── Lecturas del disco ─────────

/** Lectura síncrona del pin (el `create()` de `selectBackend` es síncrono). Null ante cualquier fallo. */
function loadPinSync(file: string): SetupPin | null {
  try {
    return parseSetupPin(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** `state.json` real del usuario (sin enlaces). Cualquier fallo = `undefined`. */
async function readStateFile(localAppData: string | undefined): Promise<unknown> {
  try {
    const file = wslSetupPaths(localAppData).statePath
    const st = await lstat(file)
    if (st.isSymbolicLink() || !st.isFile() || st.size > 64 * 1024) return undefined
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

export function createWinBackendProvider(o: WinProviderOptions): WinBackendProvider {
  const imagesDir = o.dirs.imagesDir ?? join(o.dirs.payloadDir, 'images')
  const localAppData = (): string | undefined => o.hostEnv.LOCALAPPDATA ?? o.hostEnv.localappdata

  const check = async (purpose: GatePurpose): Promise<GateResult> => {
    const closed = (reason: GateReason): GateResult => ({ ok: false, reason })
    // 1. Elevación: solo `false` pasa (no saberlo cuenta como elevado).
    let elevated: unknown
    try {
      elevated = await (o.isElevated ?? detectElevated)()
    } catch {
      elevated = null
    }
    if (elevated !== false) return closed('elevated')
    // 2. Pin empaquetado.
    const pin = await readSetupPin(o.dirs.pinJson)
    if (!pin) return closed('pin')
    // 3. Huella del paquete incluido.
    if (!(await bundleFingerprintOk(imagesDir, pin))) return closed('bundle')
    // 4. Carga de Linux (los `.py` de esta app + la huella del OpenCode fijado).
    let payloadSha: string
    try {
      payloadSha = expectedPayloadSha(await readPayloadPyFiles(o.dirs.payloadDir), pin.opencode)
    } catch {
      return closed('payload')
    }
    if (purpose === 'setup') return { ok: true }
    // 5. `state.json` del usuario: la imagen y la carga importadas son las de ESTE pin.
    let state: unknown
    try {
      state = await (o.readState ?? (() => readStateFile(localAppData())))()
    } catch {
      return closed('state')
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return closed('state')
    const st = state as { rootfsSha?: unknown; payloadSha?: unknown }
    if (st.rootfsSha !== pin.rootfs.sha256 || st.payloadSha !== payloadSha) return closed('state')
    // 6. Política de la organización.
    let disabled = false
    try {
      disabled = o.policyDisabled?.() === true
    } catch {
      disabled = true
    }
    if (disabled) return closed('policy')
    return { ok: true }
  }

  return {
    build: o.build ?? TASKS_WIN_BUILD,
    gate: async (purpose = 'run') => {
      try {
        const r = await check(purpose === 'setup' ? 'setup' : 'run')
        return r.ok ? { ok: true } : { ok: false, reason: r.reason }
      } catch {
        return { ok: false, reason: 'state' }
      }
    },
    create: () => {
      const lad = localAppData()
      if (!lad) return null
      const pin = loadPinSync(o.dirs.pinJson)
      if (!pin) return null
      if (!PAYLOAD_PY_NAMES.every((n) => existsSync(join(o.dirs.payloadDir, n)))) return null
      return createWslBackend(
        createRealWslDeps({
          fetch: o.fetch,
          localAppData: lad,
          pin,
          payloadDir: o.dirs.payloadDir,
          localSource: (kind) => {
            const f = join(imagesDir, kind === 'rootfs' ? rootfsImageName(pin.rootfs.version) : OPENCODE_IMAGE)
            return existsSync(f) ? f : null
          },
          hostEnv: o.hostEnv,
          policyDisabled: o.policyDisabled,
          log: o.log
        })
      )
    }
  }
}
