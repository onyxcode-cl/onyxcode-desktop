import { useEffect, useMemo } from 'react'
import { aiAvailability, firstFreeModel, resolveModel, sendGate, type AiAvailability, type SendGate } from '@shared/ai-availability'
import type { ModelRef } from '@shared/types'
import { useProviders } from '../stores/providers'
import { useServer } from '../stores/server'

export interface AiGate {
  /** Modelo que se usará de verdad (`null` = ninguno válido). No se persiste. */
  effective: ModelRef | null
  gate: SendGate
  avail: AiAvailability
  /** Modelo gratuito que ofrece «Probar un modelo gratuito» (o `null`). */
  free: ModelRef | null
}

/** Hook: dispara la carga de proveedores y resuelve el modelo efectivo y si se puede enviar. */
export function useAiGate(wanted: ModelRef): AiGate {
  const client = useServer((s) => s.client)
  const providers = useProviders((s) => s.providers)
  const defaults = useProviders((s) => s.defaults)
  const loaded = useProviders((s) => s.loaded)
  const load = useProviders((s) => s.load)

  useEffect(() => {
    if (client) void load(client)
  }, [client, load])

  const { providerID, modelID } = wanted
  return useMemo(
    () => computeAiGate({ providerID, modelID }, loaded ? providers : null, defaults),
    [providerID, modelID, providers, defaults, loaded]
  )
}

function computeAiGate(wanted: ModelRef, providers: Parameters<typeof aiAvailability>[0], defaults: Record<string, string>): AiGate {
  const avail = aiAvailability(providers)
  const effective = resolveModel(wanted, providers, defaults)
  return { effective, gate: sendGate(avail, effective), avail, free: firstFreeModel(providers) }
}

/** Igual que `useAiGate` pero no reactivo: para acciones (enviar) que leen el estado actual. */
export function currentAiGate(wanted: ModelRef): AiGate {
  const { providers, defaults, loaded } = useProviders.getState()
  return computeAiGate(wanted, loaded ? providers : null, defaults)
}
