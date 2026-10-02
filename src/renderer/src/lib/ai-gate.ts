import { useEffect, useMemo, useRef } from 'react'
import {
  aiAvailability,
  firstFreeModel,
  isChoiceUnavailable,
  resolveModel,
  sendGate,
  type AiAvailability,
  type SendGate
} from '@shared/ai-availability'
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
  /** Solo con `strict`: el modelo elegido falta en la lista cargada (no se sustituye; ver `isChoiceUnavailable`). */
  unavailable: boolean
}

export interface AiGateOptions {
  /** La elección del usuario manda: si falta, se marca «no disponible» y se bloquea el envío en vez de cambiarla por otro modelo. */
  strict?: boolean
}

/** Hook: dispara la carga de proveedores y resuelve el modelo efectivo y si se puede enviar. */
export function useAiGate(wanted: ModelRef, opts: AiGateOptions = {}): AiGate {
  const client = useServer((s) => s.client)
  const providers = useProviders((s) => s.providers)
  const defaults = useProviders((s) => s.defaults)
  const loaded = useProviders((s) => s.loaded)
  const load = useProviders((s) => s.load)

  useEffect(() => {
    if (client) void load(client)
  }, [client, load])

  const { providerID, modelID } = wanted
  const strict = opts.strict === true
  const result = useMemo(
    () => computeAiGate({ providerID, modelID }, loaded ? providers : null, defaults, strict),
    [providerID, modelID, providers, defaults, loaded, strict]
  )

  // La lista pudo quedar vieja (cargada antes de conectar la IA o de que el servidor trajera sus modelos): antes de dar el
  // modelo por no disponible se recarga una vez por modelo.
  const reloaded = useRef('')
  useEffect(() => {
    if (!client || !result.unavailable) return
    const key = `${providerID}/${modelID}`
    if (reloaded.current === key) return
    reloaded.current = key
    void load(client, true)
  }, [client, load, result.unavailable, providerID, modelID])

  return result
}

function computeAiGate(
  wanted: ModelRef,
  providers: Parameters<typeof aiAvailability>[0],
  defaults: Record<string, string>,
  strict = false
): AiGate {
  const avail = aiAvailability(providers)
  const unavailable = strict && isChoiceUnavailable(wanted, providers)
  // Con la elección no disponible no hay modelo efectivo: nunca se envía con otro y nada se persiste.
  const effective = unavailable ? null : resolveModel(wanted, providers, defaults)
  return { effective, gate: sendGate(avail, effective, unavailable), avail, free: firstFreeModel(providers), unavailable }
}

/** Igual que `useAiGate` pero no reactivo: para acciones (enviar) que leen el estado actual. */
export function currentAiGate(wanted: ModelRef, opts: AiGateOptions = {}): AiGate {
  const { providers, defaults, loaded } = useProviders.getState()
  return computeAiGate(wanted, loaded ? providers : null, defaults, opts.strict === true)
}
