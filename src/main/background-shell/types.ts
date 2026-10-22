/**
 * Tipos y errores del shell en segundo plano supervisado (`shell_bg`). Sin dependencias de Electron.
 */

export type ShellBgErrorCode = 'INVALID_INPUT' | 'TOO_MANY_JOBS' | 'NOT_FOUND' | 'SHUTTING_DOWN' | 'SPAWN_FAILED'

/** Error con código estable; su `message` está pensado para que lo lea el modelo (inglés, accionable). */
export class ShellBgError extends Error {
  readonly code: ShellBgErrorCode
  constructor(code: ShellBgErrorCode, message: string) {
    super(message)
    this.name = 'ShellBgError'
    this.code = code
  }
}

/**
 * Estados de un trabajo:
 * - `running`: vivo y con señales de vida recientes.
 * - `possibly-stuck`: vivo pero sin ninguna señal durante `quietMs`. NO se mata solo.
 * - `exited`: terminó solo (con `exitCode` o `signal`).
 * - `stopped`: lo cortó `stop()` / `shutdown()`.
 * - `killed-limit`: lo cortó el tope absoluto opcional `maxRuntimeMs`.
 */
export type JobState = 'running' | 'possibly-stuck' | 'exited' | 'stopped' | 'killed-limit'

export const LIVE_STATES: readonly JobState[] = ['running', 'possibly-stuck']

export interface JobStatus {
  id: string
  state: JobState
  command: string
  cwd: string
  pid: number | null
  startedAt: number
  endedAt: number | null
  durationMs: number
  /** Milisegundos desde la última señal de vida (salida, CPU, archivos). */
  idleMs: number
  quietMs: number
  maxRuntimeMs: number | null
  exitCode: number | null
  signal: string | null
  /** Bytes totales producidos (salida mezclada stdout+stderr). */
  totalBytes: number
  /** Bytes recortados entre cabeza y cola por el tope de tamaño. */
  omittedBytes: number
  /** Ruta del archivo de cabeza de la salida (útil para depurar; la lectura normal es por `read`). */
  outputFile: string
  lastLines: string[]
}

export interface ReadResult {
  id: string
  fromByte: number
  /** Desde aquí continúa la siguiente lectura incremental. */
  nextByte: number
  totalBytes: number
  omittedBytes: number
  /** Hubo recorte justo al leer: `text` empieza con un marcador del hueco. */
  gapSkipped: boolean
  state: JobState
  text: string
}

export type ShellBgEvent =
  | {
      type: 'exit'
      id: string
      command: string
      state: Exclude<JobState, 'running' | 'possibly-stuck'>
      exitCode: number | null
      signal: string | null
      durationMs: number
      lastLines: string[]
    }
  | {
      type: 'possibly-stuck'
      id: string
      command: string
      idleMs: number
      quietMs: number
      /** 1 la primera vez; sube cada `quietMs` más sin señales. */
      repeat: number
      lastLines: string[]
    }
  | { type: 'resumed'; id: string; command: string }

export interface StartOptions {
  cwd: string
  env?: Record<string, string>
  /** Sin señales de vida durante este tiempo => `possibly-stuck`. Por defecto el del manager (15 min). */
  quietMs?: number
  /** Tope absoluto OPCIONAL: pasado este tiempo se corta. Por defecto ninguno. */
  maxRuntimeMs?: number
  /** Rutas absolutas cuyo crecimiento (tamaño) cuenta como señal de vida. */
  watchPaths?: string[]
}
