/** Contrato del evento del motor propio; independiente del modo plan y de su bandera. */
import type { ModelRef } from './types'

export interface ModelChanged {
  sessionID: string
  anterior: ModelRef
  nuevo: ModelRef & { variant?: string }
  motivo: string
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 200 && v.trim() === v && !/[\s\u0000-\u001f\u007f]/u.test(v)
const keys = (v: Record<string, unknown>, allowed: string[]): boolean => Object.keys(v).every((k) => allowed.includes(k))

/** Rechaza campos ausentes, tipos incorrectos, identificadores vacíos y claves inesperadas. */
export function parseModelChanged(value: unknown): ModelChanged | null {
  if (!record(value) || !keys(value, ['sessionID', 'anterior', 'nuevo', 'motivo']) || !id(value.sessionID)) return null
  const { anterior, nuevo, motivo } = value
  if (!record(anterior) || !keys(anterior, ['providerID', 'modelID']) || !id(anterior.providerID) || !id(anterior.modelID)) return null
  if (!record(nuevo) || !keys(nuevo, ['providerID', 'modelID', 'variant']) || !id(nuevo.providerID) || !id(nuevo.modelID)) return null
  if ('variant' in nuevo && !id(nuevo.variant)) return null
  if (typeof motivo !== 'string' || !motivo.trim() || motivo.length > 4096) return null
  return {
    sessionID: value.sessionID,
    anterior: { providerID: anterior.providerID, modelID: anterior.modelID },
    nuevo: {
      providerID: nuevo.providerID,
      modelID: nuevo.modelID,
      ...(typeof nuevo.variant === 'string' ? { variant: nuevo.variant } : {})
    },
    motivo
  }
}
