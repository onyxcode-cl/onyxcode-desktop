/**
 * Revisión de arranque con las dependencias reales (Electron, ArtCraft, motor, Control del PC, entorno aislado). La lógica y sus
 * pruebas están en `service.ts`; aquí solo se cablea y se guarda el último informe para Diagnóstico.
 */
import { app } from 'electron'
import { rmSync, statfsSync, writeFileSync } from 'node:fs'
import { arch, homedir } from 'node:os'
import { join } from 'node:path'
import type { PreflightId, PreflightReport } from '@shared/preflight'
import { blocking, ordered } from '@shared/preflight'
import { classifyAppLocation } from '@shared/mac-permissions'
import type { TasksSandboxStatus } from '@shared/ipc-tasks'
import { describeError, recordProblem } from '../diagnostics/problem-log'
import { makeRedactor } from '../diagnostics/redact'
import { E2E_HEADLESS } from '../e2e-headless'
import { craftService } from '../office/craft/service'
import { runtimesService } from '../runtimes/service'
import { getOpencodeInfo } from '../opencode/binary'
import { resolveOpencodeAsync } from '../opencode/server'
import type { ComputerService } from '../computer/service'
import { detectFullDiskAccess } from './full-disk'
import { failureDetail, placementOf, runPreflightChecks, skippedReport, type PreflightDeps } from './service'

export interface PreflightSources {
  /** Ausente si esta plataforma no ofrece Control del PC. */
  computer?: ComputerService
  /** Estado del entorno aislado; ausente si no aplica (solo Windows con WSL). */
  sandboxStatus?: () => Promise<TasksSandboxStatus>
}

let sources: PreflightSources = {}
let last: PreflightReport | null = null
let lastBlockingKey = ''

/** Lo llama el cableado de Tareas cuando ya conoce el servicio de Control del PC y del entorno aislado. */
export function configurePreflight(s: PreflightSources): void {
  sources = s
}

/** Último informe de la revisión (para el informe de Diagnóstico); `null` si todavía no se corrió. */
export function lastPreflightReport(): PreflightReport | null {
  return last
}

function userDataWritable(): boolean {
  const probe = join(app.getPath('userData'), '.preflight-escritura')
  try {
    writeFileSync(probe, String(Date.now()))
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

function realDeps(): PreflightDeps {
  const { computer, sandboxStatus } = sources
  const mac = process.platform === 'darwin' && computer
  return {
    platform: process.platform,
    appVersion: app.getVersion(),
    now: Date.now,
    engine: async () => {
      const resolved = await resolveOpencodeAsync()
      const info = await getOpencodeInfo(() => resolved)
      return { found: info.found, version: info.version }
    },
    craft: () => craftService().check(),
    runtimes: () => {
      const snap = runtimesService().snapshot()
      return {
        offered: snap.offered,
        ready: snap.ready,
        broken: snap.items.some((i) => i.state === 'broken'),
        sizeBytes: snap.missingBytes,
        version: snap.items.find((i) => i.id === 'node')?.version
      }
    },
    sandbox: sandboxStatus
      ? async () => sandboxStatus().then((s) => (s.backend === 'wsl' ? { state: s.state, detail: s.detail } : null))
      : undefined,
    helperPresent: computer ? () => computer.helperPath() !== null : undefined,
    fullDisk: process.platform === 'darwin' ? () => detectFullDiskAccess() : undefined,
    mac: mac
      ? {
          status: () => computer.status(),
          placement: () =>
            placementOf({
              execPath: process.execPath,
              home: homedir(),
              packaged: app.isPackaged,
              platform: process.platform,
              classify: classifyAppLocation
            })
        }
      : undefined,
    freeBytes: () => {
      const s = statfsSync(app.getPath('userData'))
      return s.bavail * s.bsize
    },
    userDataWritable,
    onCheckError: (id, err) =>
      recordProblem({
        source: 'main',
        level: 'warn',
        message: `Revisión de arranque: la comprobación «${id}» falló`,
        stack: describeError(err).stack,
        detail: { error: describeError(err).message }
      })
  }
}

/**
 * Solo para las capturas de pantalla (`scripts/shot-desktop.mjs`): con `LAZUNOX_TEST_PREFLIGHT` y el modo E2E sin pantalla (nunca en la
 * app empaquetada) se simula un equipo de primer uso con la lógica REAL de `runPreflightChecks`: motor presente (`primer-uso`) o ausente
 * (`sin-motor`), ArtCraft sin descargar y, en macOS, permisos sin dar y la app fuera de Aplicaciones.
 */
function testDeps(kind: string): PreflightDeps {
  const base = realDeps()
  return {
    ...base,
    engine: async () => (kind === 'sin-motor' ? { found: false, version: null } : { found: true, version: '1.18.32' }),
    craft: () => ({ state: 'missing', version: '0.5.0', sizeBytes: 205_000_000, parts: [] }),
    runtimes: () => ({ offered: process.platform === 'darwin', ready: false, broken: false, sizeBytes: 67_329_746 }),
    sandbox: undefined,
    helperPresent: undefined,
    fullDisk: process.platform === 'darwin' ? async () => 'denied' : undefined,
    mac:
      process.platform === 'darwin'
        ? { status: async () => ({ accessibility: false, screenRecording: false }), placement: () => 'elsewhere' }
        : undefined,
    freeBytes: () => 50e9,
    userDataWritable: () => true
  }
}

/** Corre la revisión. En las pruebas automáticas (modo E2E sin pantalla, nunca en producción) se omite. */
export async function runPreflight(): Promise<PreflightReport> {
  const deps = realDeps()
  const testKind = E2E_HEADLESS ? process.env.LAZUNOX_TEST_PREFLIGHT : undefined
  const report = testKind
    ? await runPreflightChecks(testDeps(testKind))
    : E2E_HEADLESS
      ? skippedReport(deps)
      : await runPreflightChecks(deps)
  last = report
  // Una nota en el registro de problemas cuando falta algo esencial (una vez por combinación, no en cada «Revisar de nuevo»).
  const block = blocking(report)
  const key = block.map((c) => `${c.id}:${c.reason ?? ''}`).join('|')
  if (key && key !== lastBlockingKey)
    recordProblem({
      source: 'main',
      level: 'warn',
      message: 'Revisión de arranque: falta algo esencial',
      detail: Object.fromEntries(block.map((c) => [c.id, c.reason ?? 'falta']))
    })
  lastBlockingKey = key
  return report
}

/** Anota un fallo de instalación y devuelve el detalle redactado para «Copiar detalle». */
export function reportPreflightFailure(o: { id: PreflightId; code?: string; message?: string }): { detail: string } {
  const comp = last ? ordered(last).find((c) => c.id === o.id) : undefined
  const raw = failureDetail({
    id: o.id,
    code: o.code,
    message: o.message,
    platform: process.platform,
    arch: arch(),
    appVersion: app.getVersion(),
    componentDetail: [comp?.reason ? `estado ${comp.reason}` : '', comp?.detail ?? ''].filter(Boolean).join('; ')
  })
  const redact = makeRedactor({ exact: [], home: homedir() })
  const detail = raw.split('\n').map(redact).join('\n')
  recordProblem({
    source: 'main',
    message: `Revisión de arranque: no se pudo preparar «${o.id}» (${o.code ?? 'desconocido'})`,
    detail: { componente: o.id, codigo: o.code ?? 'desconocido', ...(o.message ? { mensaje: o.message.slice(0, 300) } : {}) }
  })
  return { detail }
}
