/**
 * Lógica pura del asistente de primer uso: qué decidir al arrancar y en qué paso empezar.
 * Sin React ni IPC (se prueba con `steps.test.ts`).
 */
import type { ServerState } from '@shared/types'

export const ONBOARDING_STEPS = ['opencode', 'auth', 'model', 'modes', 'permissions'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/** Proveedor del catálogo de OpenCode (`provider.list().all`) reducido a lo que se necesita. */
export interface ProviderState {
  id: string
  source: string
}

export interface OnboardingInputs {
  /** `settings.onboarded`. */
  onboarded: boolean
  /** Resultado de `app:opencodeInfo` (`unknown` mientras no responde). */
  binary: 'unknown' | 'found' | 'missing'
  server: ServerState
  /** Proveedores conectados según el servidor; `null` mientras no se conocen. */
  connected: ProviderState[] | null
}

export type OnboardingDecision =
  /** Ya completado: no mostrar nada. */
  | { kind: 'hidden' }
  /** Faltan datos para decidir (no mostrar todavía). */
  | { kind: 'wait' }
  /** Todo ya funcionaba (usuario existente): marcar `onboarded` en silencio. */
  | { kind: 'complete' }
  | { kind: 'show'; step: OnboardingStep }

/**
 * ¿Cuenta como proveedor configurado por el usuario? Un servidor recién instalado ya «conecta» el
 * proveedor gratuito `opencode` (origen `custom`, sin clave): eso no cuenta, o el asistente no
 * aparecería nunca a un usuario nuevo.
 */
export function isConfiguredProvider(p: ProviderState): boolean {
  return !(p.id === 'opencode' && p.source === 'custom')
}

export function hasConfiguredProvider(connected: ProviderState[]): boolean {
  return connected.some(isConfiguredProvider)
}

/**
 * Se muestra SOLO si `onboarded !== true` Y (falta el binario O ningún proveedor configurado).
 * Con binario presente hay que esperar al servidor y a la lista de proveedores; si el servidor
 * falla con un binario que existe, no se decide (lo cubre el aviso superior).
 */
export function decideOnboarding(i: OnboardingInputs): OnboardingDecision {
  if (i.onboarded) return { kind: 'hidden' }
  if (i.binary === 'unknown') return { kind: 'wait' }
  if (i.binary === 'missing') return { kind: 'show', step: 'opencode' }
  if (i.server !== 'ready' || i.connected === null) return { kind: 'wait' }
  return hasConfiguredProvider(i.connected) ? { kind: 'complete' } : { kind: 'show', step: 'auth' }
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step)
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? null
}

export function prevStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) - 1] ?? null
}

/** ¿Se puede pasar del paso `step` al siguiente? Solo el paso 1 exige que OpenCode funcione. */
export function canAdvance(step: OnboardingStep, s: { binaryFound: boolean; serverReady: boolean }): boolean {
  return step === 'opencode' ? s.binaryFound && s.serverReady : true
}
