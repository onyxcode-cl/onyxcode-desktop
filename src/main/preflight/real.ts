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
import { getOpencodeInfo } from '../opencode/binary'
import { resolveOpencodeAsync } from '../opencode/server'
import type { ComputerService } from '../computer/service'
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
    sandbox: sandboxStatus
      ? async () => sandboxStatus().then((s) => (s.backend === 'wsl' ? { state: s.state, detail: s.detail } : null))
      : undefined,
    helperPresent: computer ? () => computer.helperPath() !== null : undefined,
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

/** Corre la revisión. En las pruebas automáticas (modo E2E sin pantalla, nunca en producción) se omite. */
export async function runPreflight(): Promise<PreflightReport> {
  const deps = realDeps()
  const report = E2E_HEADLESS ? skippedReport(deps) : await runPreflightChecks(deps)
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
