/**
 * Fallos de ArtCraft → registro permanente de problemas (`origen craft`). Hasta ahora solo hacían `console.warn` y nadie los veía
 * (ni la persona ni quien da soporte). Guarda el código y el mensaje del `OfficeError`, la plataforma y la arquitectura y, en las
 * descargas, los bytes recibidos. Sin datos sensibles: el registro además redacta rutas del usuario y claves.
 */
import { describeError, recordProblem, type ProblemInput } from '../../diagnostics/problem-log'
import { OfficeError } from '../download'

/** Dónde ocurrió el fallo (texto fijo, sale en el registro). */
export type CraftStage = 'instalación' | 'vista web' | 'documento' | 'apertura externa' | 'reintento automático'

export interface CraftProblemDeps {
  record?: (p: ProblemInput) => void
  platform?: string
  arch?: string
  /** `warn` para lo esperable (p. ej. ArtCraft aún no instalado); por defecto `error`. */
  level?: 'error' | 'warn'
}

export function recordCraftProblem(
  stage: CraftStage,
  err: unknown,
  extra: Record<string, string | number> = {},
  deps: CraftProblemDeps = {}
): void {
  // Cancelar a propósito no es un problema.
  if (err instanceof OfficeError && err.code === 'cancelled') return
  const { message, stack } = describeError(err)
  const detail: Record<string, string | number> = {
    etapa: stage,
    codigo: err instanceof OfficeError ? err.code : 'desconocido',
    plataforma: deps.platform ?? process.platform,
    arquitectura: deps.arch ?? process.arch,
    ...extra
  }
  if (err instanceof OfficeError && typeof err.received === 'number') detail.bytes = err.received
  const input: ProblemInput = { source: 'craft', level: deps.level ?? 'error', message: `ArtCraft (${stage}): ${message}`, stack, detail }
  try {
    ;(deps.record ?? recordProblem)(input)
  } catch {
    /* el registro nunca debe romper la app */
  }
}
