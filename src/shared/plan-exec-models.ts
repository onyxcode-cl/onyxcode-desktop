/**
 * «Planear con un modelo y ejecutar con otro» en Code (D2). Lógica pura, sin Electron ni React.
 *
 * Dos ajustes opcionales (Ajustes › Modelos): «Modelo para planear» y «Modelo para ejecutar». Vacíos = se usa el modelo de la
 * conversación (comportamiento de siempre). Con alguno definido, el modelo sale por mensaje según el agente: `plan` usa el de
 * planear y `build` el de ejecutar. La persona puede cambiarlo en la conversación (`override`) sin tocar los ajustes.
 * Si el modelo elegido ya no existe o no tiene clave, se usa el de la conversación y se devuelve `fallback` para AVISAR (nunca en silencio).
 */
import type { ModelRef } from './types'

export type PlanExecRole = 'plan' | 'exec'

/** Ajustes guardados (`extras.json › planExecModels`). Falta la clave = sin modelo propio para ese paso. */
export type PlanExecModels = Partial<Record<PlanExecRole, ModelRef>>

export function roleOfAgent(agent: 'build' | 'plan'): PlanExecRole {
  return agent === 'plan' ? 'plan' : 'exec'
}

export interface RoleChoice {
  /** Modelo con el que sale el mensaje. */
  model: ModelRef
  role: PlanExecRole
  /** `role` = el de planear/ejecutar de los ajustes; `override` = el cambiado en la conversación; `conversation` = el de la conversación. */
  source: 'role' | 'override' | 'conversation'
  /** El modelo de planear/ejecutar que NO se pudo usar (ya no existe o sin clave); `null` si no hubo problema. */
  fallback: ModelRef | null
}

export const sameModel = (a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean =>
  !!a && !!b && a.providerID === b.providerID && a.modelID === b.modelID

export function chooseRoleModel(args: {
  agent: 'build' | 'plan'
  config: PlanExecModels | null | undefined
  /** Cambios hechos en la conversación (memoria, no se guardan en los ajustes). */
  override?: PlanExecModels | null
  conversation: ModelRef
  /** `true` si el modelo ya no existe o su proveedor no tiene clave. */
  isUnavailable: (m: ModelRef) => boolean
}): RoleChoice {
  const role = roleOfAgent(args.agent)
  const fromOverride = args.override?.[role]
  const wanted = fromOverride ?? args.config?.[role] ?? null
  if (!wanted) return { model: args.conversation, role, source: 'conversation', fallback: null }
  if (args.isUnavailable(wanted)) return { model: args.conversation, role, source: 'conversation', fallback: wanted }
  return { model: wanted, role, source: fromOverride ? 'override' : 'role', fallback: null }
}

/** ¿Hay un modelo propio para este paso (ajustes o cambio en la conversación)? Si no, el selector sigue siendo el de la conversación. */
export function roleHasOwnModel(
  agent: 'build' | 'plan',
  config: PlanExecModels | null | undefined,
  override?: PlanExecModels | null
): boolean {
  const role = roleOfAgent(agent)
  return !!(override?.[role] ?? config?.[role])
}

/** Copia de `PlanExecModels` con un paso cambiado (`null` = quitar). */
export function withRoleModel(cur: PlanExecModels | null | undefined, role: PlanExecRole, value: ModelRef | null): PlanExecModels {
  const next: PlanExecModels = { ...(cur ?? {}) }
  if (value) next[role] = { providerID: value.providerID, modelID: value.modelID }
  else delete next[role]
  return next
}
