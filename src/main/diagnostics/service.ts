/**
 * Servicio de Diagnóstico: entrega registros del motor YA redactados. Es el ÚNICO camino por el que un
 * registro sale de main (IPC `diag:*`, portapapeles y archivo exportado); nada devuelve texto sin pasar por
 * `makeRedactor`. No incluye los registros del sandbox de Tareas.
 *
 * Fuentes:
 *  - `engine`      anillo en memoria con lo que escribe `opencode serve` (stdout/stderr).
 *  - `engine-file` últimos 256 KB del `.log` más reciente de `userData/opencode-data/opencode/log`.
 *  - `report`      informe: versiones, estado del servidor y las últimas 200 líneas del motor.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, fstatSync } from 'node:fs'
import { join } from 'node:path'
import { APP_NAME } from '@shared/brand'
import type { DiagLogs, DiagSource } from '@shared/diagnostics'
import type { ServerStatus } from '@shared/types'
import { appAuthFile, opencodeDataHome } from '../opencode/data-dir'
import { collectMcpSecrets, collectStringValues, makeRedactor, type Redactor } from './redact'

export const ENGINE_FILE_TAIL_BYTES = 256 * 1024
export const DEFAULT_MAX_LINES = 500
export const REPORT_ENGINE_LINES = 200

export interface DiagnosticsDeps {
  userData: string
  home: string
  /** Ruta de `opencode.json` de la app (MCP con cabeceras/entorno secretos). */
  mcpConfigPath: string
  server: {
    recentLog(max?: number): string[]
    secrets(): string[]
    getStatus(): ServerStatus
  }
  /** Versiones para el informe (`app`, `electron`, `chrome`, `node`, `sistema`…). */
  versions: () => Record<string, string>
  now: () => number
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** Últimos `bytes` de un archivo (por desplazamiento); descarta la primera línea si quedó cortada. */
export function readFileTail(path: string, bytes: number): { lines: string[]; truncated: boolean } {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    let read = 0
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, start + read)
      if (n <= 0) break
      read += n
    }
    const lines = buf.subarray(0, read).toString('utf8').split(/\r?\n/)
    if (lines[lines.length - 1] === '') lines.pop()
    if (start > 0) lines.shift()
    return { lines, truncated: start > 0 }
  } finally {
    closeSync(fd)
  }
}

/** `.log` más reciente (por fecha de modificación) de una carpeta, o null. */
export function newestLog(dir: string): string | null {
  if (!existsSync(dir)) return null
  let best: { path: string; mtime: number } | null = null
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.log')) continue
    const path = join(dir, name)
    try {
      const st = statSync(path)
      if (st.isFile() && (!best || st.mtimeMs > best.mtime)) best = { path, mtime: st.mtimeMs }
    } catch {
      /* desapareció */
    }
  }
  return best?.path ?? null
}

/** `AAAAMMDD-HHmm` en hora local. */
export function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export function exportFileName(ms: number): string {
  return `${APP_NAME}-diagnostico-${stamp(ms)}.txt`
}

export class DiagnosticsService {
  constructor(private readonly deps: DiagnosticsDeps) {}

  /** Redactor con los secretos de AHORA (la contraseña del sidecar cambia en cada arranque; las claves, al guardarlas). */
  private redactor(): Redactor {
    const { deps } = this
    const exact = [
      ...deps.server.secrets(),
      ...collectStringValues(readJson(appAuthFile(deps.userData))),
      ...collectMcpSecrets(readJson(deps.mcpConfigPath))
    ]
    return makeRedactor({ exact, home: deps.home })
  }

  /** Todas las líneas de una fuente, redactadas, más si el origen estaba recortado. */
  private collect(source: DiagSource, redact: Redactor): { lines: string[]; truncated: boolean } {
    const { deps } = this
    if (source === 'engine') {
      return { lines: deps.server.recentLog().map(redact), truncated: false }
    }
    if (source === 'engine-file') {
      const file = newestLog(join(opencodeDataHome(deps.userData), 'opencode', 'log'))
      if (!file) return { lines: [], truncated: false }
      try {
        const t = readFileTail(file, ENGINE_FILE_TAIL_BYTES)
        return { lines: t.lines.map(redact), truncated: t.truncated }
      } catch {
        return { lines: [], truncated: false }
      }
    }
    return { lines: this.report(redact), truncated: false }
  }

  private report(redact: Redactor): string[] {
    const { deps } = this
    const status = deps.server.getStatus()
    const out: string[] = [`${APP_NAME} — informe de diagnóstico`, `Generado: ${new Date(deps.now()).toISOString()}`, '', 'Versiones']
    for (const [k, v] of Object.entries(deps.versions())) out.push(`  ${k}: ${v}`)
    out.push('', 'Motor (OpenCode)', `  estado: ${status.state}`, `  reinicios: ${status.restarts}`)
    if (status.version) out.push(`  versión: ${status.version}`)
    if (status.error) out.push(`  último error: ${status.error}`)
    out.push('', `Últimas ${REPORT_ENGINE_LINES} líneas del motor`)
    out.push(...deps.server.recentLog(REPORT_ENGINE_LINES))
    // Todo el informe (también los datos de estado) pasa por el redactor, una línea a la vez.
    return out.flatMap((l) => l.split(/\r?\n/)).map(redact)
  }

  /** Líneas para la pantalla: las últimas `maxLines`. */
  getLogs(source: DiagSource, maxLines = DEFAULT_MAX_LINES): DiagLogs {
    const { lines, truncated } = this.collect(source, this.redactor())
    const cut = lines.length > maxLines
    return {
      source,
      lines: cut ? lines.slice(lines.length - maxLines) : lines,
      truncated: truncated || cut,
      generatedAt: this.deps.now()
    }
  }

  /** Texto completo (redactado) de una fuente, para copiar o exportar. */
  getText(source: DiagSource): { text: string; lines: number } {
    const { lines } = this.collect(source, this.redactor())
    return { text: lines.join('\n') + (lines.length ? '\n' : ''), lines: lines.length }
  }

  /** Informe + registro del archivo, para «Exportar…». */
  getExport(): { text: string; fileName: string } {
    const redact = this.redactor()
    const report = this.report(redact)
    const file = this.collect('engine-file', redact)
    const text = [...report, '', `Registro del motor (archivo${file.truncated ? ', solo el final' : ''})`, ...file.lines].join('\n') + '\n'
    return { text, fileName: exportFileName(this.deps.now()) }
  }
}
