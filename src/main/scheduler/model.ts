import { resolveModel, type ProviderLike } from '@shared/ai-availability'
import type { ModelRef } from '@shared/types'

/**
 * Modelo con el que se ejecuta una rutina: el guardado en la rutina si el motor aún lo ofrece; si su proveedor ya no está
 * disponible (cuenta desconectada o cambiada), el de la primera IA conectada (OpenCode Go primero). `null` = no hay ninguna
 * IA válida (la ejecución falla con un mensaje claro). Sin lista de proveedores se usa el guardado tal cual.
 */
export function pickRoutineModel(
  saved: ModelRef,
  data: { providers: ProviderLike[]; default: Record<string, string> } | null | undefined
): ModelRef | null {
  if (!data) return saved
  return resolveModel(saved, data.providers, data.default)
}
