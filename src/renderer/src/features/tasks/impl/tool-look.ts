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
