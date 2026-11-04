/** Tipo de paso para la bitácora: decide el icono y el color de cada fila (Mac, web, crear, leer, terminal…). */
import { computerToolKind } from './computer-tools'

export type StepKind = 'mac' | 'web' | 'create' | 'read' | 'terminal' | 'other'

export function stepKind(tool: string): StepKind {
  if (computerToolKind(tool)) return 'mac'
  if (tool === 'webfetch' || tool === 'websearch' || tool.startsWith('browser')) return 'web'
  if (tool === 'write' || tool === 'edit' || tool === 'multiedit' || tool === 'patch' || tool === 'apply_patch') return 'create'
  if (tool === 'read' || tool === 'list' || tool === 'glob' || tool === 'grep') return 'read'
  if (tool === 'bash') return 'terminal'
  return 'other'
}

/** Clases de color por tipo (fondo suave + color del icono); legibles en claro y oscuro. */
export const STEP_TONE: Record<StepKind, { bg: string; fg: string }> = {
  mac: { bg: 'bg-amber-500/15', fg: 'text-amber-600 [[data-theme=dark]_&]:text-amber-400' },
  web: { bg: 'bg-sky-500/15', fg: 'text-sky-600 [[data-theme=dark]_&]:text-sky-400' },
  create: { bg: 'bg-emerald-500/15', fg: 'text-emerald-600 [[data-theme=dark]_&]:text-emerald-400' },
  read: { bg: 'bg-hover', fg: 'text-muted' },
  terminal: { bg: 'bg-violet-500/15', fg: 'text-violet-600 [[data-theme=dark]_&]:text-violet-400' },
  other: { bg: 'bg-hover', fg: 'text-muted' }
}

/** Hora de inicio del paso (ms) si la herramienta ya empezó. */
export function stepStartedAt(state: unknown): number | null {
  const t = (state as { time?: { start?: unknown } } | null)?.time?.start
  return typeof t === 'number' && t > 0 ? t : null
}

/** Cuánto tardó el paso (ms), si ya terminó y los tiempos tienen sentido; null mientras corre o si faltan datos. */
export function stepDurationMs(state: unknown): number | null {
  const t = (state as { time?: { start?: unknown; end?: unknown } } | null)?.time
  if (!t || typeof t.start !== 'number' || typeof t.end !== 'number' || t.start <= 0) return null
  const ms = t.end - t.start
  return ms >= 0 ? ms : null
}

/** «<1 s», «2 s», «1 min 5 s», «1 h 2 min» (abreviaturas iguales en español e inglés). */
export function formatStepDuration(ms: number): string {
  const total = Math.round(Math.max(0, ms) / 1000)
  if (total < 1) return '<1 s'
  if (total < 60) return `${total} s`
  const m = Math.floor(total / 60)
  if (m < 60) return total % 60 ? `${m} min ${total % 60} s` : `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}
