/**
 * Constructor del backend de Tareas en Windows (distro WSL propia) para `selectBackend` (W5). NO se enlaza si la bandera
 * `tasksWin` está apagada: `main` solo lo construye en win32 y `selectBackend` exige además `TASKS_WIN_BUILD`.
 *
 * Falla CERRADO en cada eslabón (devuelve `null`/`false`; `selectBackend` lo convierte en `WinBackendUnavailable`):
 *  - `create()`: sin pin válido (`wsl-rootfs` + OpenCode de Linux), sin `%LOCALAPPDATA%` o con una ruta de Windows rara → `null`.
 *  - `report()`: exige los DOS informes del PC (`tasks-win-report.{elevated,normal}.json`) en verde, con el esquema estricto y
 *    las reglas de `gateProblems`. La frescura de la carga de Linux (`launcher.py`, `landlock.py`…) se recalcula AQUÍ con los
 *    archivos que lleva esta app; los archivos de `src/` no existen empaquetados, así que su hash lo certifica la guardia de
 *    pruebas en CI (`tasks-win-report.guard.test.ts`) y aquí solo se exige que las dos sesiones coincidan entre sí.
 *    Además `payloadSha`, `rootfsSha` y `opencodeVersion` del informe deben ser los del pin y la carga de esta app.
 * Hoy el instalador no empaqueta ni el pin de la imagen ni los informes: en una app empaquetada este proveedor devuelve siempre
 * «cerrado» (decisión MÁS restrictiva; empaquetarlos es trabajo pendiente de la imagen base y de las pruebas en el PC).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import type { FetchLike } from '../../remote/tunnel/binary'
import { gateProblems, type TasksWinReport } from '../tasks-win-report'
import type { WinBackendProvider } from './index'
import { createWslBackend } from './wsl'
import { createRealWslDeps, PAYLOAD_PY_NAMES, readPayloadPyFiles, readSetupPin } from './wsl-real-deps'
import { expectedPayloadSha, parseSetupPin, type SetupPin } from './wsl-setup'

export interface WinProviderDirs {
  /** `pin.json` (raíz de confianza: versión de OpenCode, URL y sha de su `linux-x64`, y `wsl-rootfs`). */
  pinJson: string
  /** Carpeta con los `.py` de la carga de Linux. */
  payloadDir: string
  /** Carpeta con los informes de ataques del PC. */
  evidenceDir: string
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
}

/** sha256 del contenido con CRLF → LF (igual que la guardia: un checkout con autocrlf no invalida el informe). */
function normHash(buf: Buffer): string {
  return createHash('sha256')
    .update(Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'))
    .digest('hex')
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** ¿Hay informes del PC válidos y que describen ESTA app? Cualquier duda = `false`. */
export async function windowsReportOk(dirs: WinProviderDirs): Promise<boolean> {
  const pin = await readSetupPin(dirs.pinJson)
  if (!pin) return false
  const raws = {
    elevated: await readJson(join(dirs.evidenceDir, 'tasks-win-report.elevated.json')),
    normal: await readJson(join(dirs.evidenceDir, 'tasks-win-report.normal.json'))
  }
  if (raws.elevated === undefined || raws.normal === undefined) return false
  const payloadHashes = new Map<string, string>()
  for (const f of await readPayloadPyFiles(dirs.payloadDir)) payloadHashes.set(`resources/wsl/${f.path}`, normHash(Buffer.from(f.data)))
  try {
    const wsl = await readFile(join(dirs.payloadDir, 'wsl.conf'))
    payloadHashes.set('resources/wsl/wsl.conf', normHash(wsl))
  } catch {
    return false
  }
  const claimed = (rel: string): string | null => {
    const a = (raws.elevated as { build?: { hashes?: Record<string, unknown> } }).build?.hashes?.[rel]
    const b = (raws.normal as { build?: { hashes?: Record<string, unknown> } }).build?.hashes?.[rel]
    return typeof a === 'string' && a === b ? a : null
  }
  const problems = gateProblems(true, raws, {
    hashOf: (rel) => payloadHashes.get(rel) ?? (rel.startsWith('resources/wsl/') ? null : claimed(rel)),
    pin: { rootfsSha: pin.rootfs.sha256, opencodeVersion: pin.opencode.version }
  })
  if (problems.length > 0) return false
  // La carga de Linux del informe es la que lleva esta app (los `.py` + el OpenCode fijado).
  const want = expectedPayloadSha(await readPayloadPyFiles(dirs.payloadDir), pin.opencode)
  return [raws.elevated, raws.normal].every((r) => (r as TasksWinReport).build.payloadSha === want)
}

/** Lectura síncrona del pin (el `create()` de `selectBackend` es síncrono). Null ante cualquier fallo. */
function loadPinSync(file: string): SetupPin | null {
  try {
    return parseSetupPin(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

export function createWinBackendProvider(o: WinProviderOptions): WinBackendProvider {
  return {
    build: o.build ?? TASKS_WIN_BUILD,
    report: async () => {
      try {
        return await windowsReportOk(o.dirs)
      } catch {
        return false
      }
    },
    create: () => {
      const localAppData = o.hostEnv.LOCALAPPDATA ?? o.hostEnv.localappdata
      if (!localAppData) return null
      const pin = loadPinSync(o.dirs.pinJson)
      if (!pin) return null
      if (!PAYLOAD_PY_NAMES.every((n) => existsSync(join(o.dirs.payloadDir, n)))) return null
      return createWslBackend(
        createRealWslDeps({
          fetch: o.fetch,
          localAppData,
          pin,
          payloadDir: o.dirs.payloadDir,
          hostEnv: o.hostEnv,
          policyDisabled: o.policyDisabled,
          log: o.log
        })
      )
    }
  }
}
