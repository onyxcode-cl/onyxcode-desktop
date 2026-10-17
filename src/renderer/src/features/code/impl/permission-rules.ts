import type { PermissionRuleset } from '@opencode-ai/sdk/v2/client'
import { effectiveModeFor, endsWithRuleset, rulesetForMode } from '@shared/permission-rules'
import type { PermissionMode } from './types'

/** ¿Dos rulesets son iguales (mismas reglas, mismo orden)? */
export function sameRuleset(a: PermissionRuleset | undefined, b: PermissionRuleset | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

/**
 * Traduce un `PermissionMode` al bloque de reglas que se manda a `session.update` / `session.create`. Siempre devuelve el bloque
 * completo y autosuficiente (la lógica y el porqué viven en `@shared/permission-rules`); «plan» también lleva reglas, porque tiene que
 * anular lo que dejó el modo anterior en la misma sesión.
 */
export function rulesetFor(mode: PermissionMode): PermissionRuleset {
  return rulesetForMode(mode) as PermissionRuleset
}

/** Reglas que debe tener la sesión según el modo elegido y el agente activo. */
export function rulesetForState(mode: PermissionMode, agent: string | undefined): PermissionRuleset {
  return rulesetFor(effectiveModeFor(mode, agent))
}

/** ¿La sesión ya termina con el bloque pedido? (idempotencia: no se reenvía ni crece la lista). */
export function sessionHasRuleset(session: PermissionRuleset | undefined, wanted: PermissionRuleset): boolean {
  return endsWithRuleset(session, wanted)
}
