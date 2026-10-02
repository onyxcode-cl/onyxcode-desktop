/**
 * Lógica pura del asistente de primer uso: qué decidir al arrancar y en qué paso empezar.
 * Sin React ni IPC (se prueba con `steps.test.ts`).
 */
import { isConfiguredProvider } from '@shared/ai-availability'
import { APP_NAME } from '@shared/brand'
import { t } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import { currentPlatform } from '../../lib/platform'
import type { OpencodeInfo, OpencodeSource, ServerState } from '@shared/types'

export const ONBOARDING_STEPS = ['opencode', 'auth', 'model', 'modes', 'permissions'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/** Pasos de esta plataforma: «Permisos de macOS» solo existe en macOS (Control del PC y Tareas no están en Windows). */
export function stepsFor(platform: string = currentPlatform()): readonly OnboardingStep[] {
  return platform === 'darwin' ? ONBOARDING_STEPS : ONBOARDING_STEPS.filter((s) => s !== 'permissions')
}

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
  /** De dónde sale el binario (informativo: con el embebido `binary` nunca es `missing` en la app empaquetada). */
  source?: OpencodeSource | null
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

export { isConfiguredProvider }

/** Nombres visibles de los proveedores conectados que cuenta como configurados (sin el gratuito preinstalado). */
export function connectedNames(connected: ProviderState[] | null, names: Record<string, string>): string[] {
  return (connected ?? []).filter(isConfiguredProvider).map((p) => names[p.id] ?? p.id)
}

/** Aviso del paso «Conecta tu IA»: qué modos funcionan con cualquier proveedor y cuál tiene una excepción. */
export function connectTasksNotice(): string {
  return t('wizard.connectTasksNotice', { tasks: MODE_LABELS.tasks, app: APP_NAME, fullControl: t('wizard.fullControlShort') })
}
export function connectTermsNotice(): string {
  return t('wizard.connectTermsNotice')
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

export function stepIndex(step: OnboardingStep, platform: string = currentPlatform()): number {
  return stepsFor(platform).indexOf(step)
}

export function nextStep(step: OnboardingStep, platform: string = currentPlatform()): OnboardingStep | null {
  return stepsFor(platform)[stepIndex(step, platform) + 1] ?? null
}

export function prevStep(step: OnboardingStep, platform: string = currentPlatform()): OnboardingStep | null {
  return stepsFor(platform)[stepIndex(step, platform) - 1] ?? null
}

/** Cómo presentar el paso 1: informativo con el motor incluido; con el CLI propio o sin binario, el flujo de siempre. */
export type OpencodeStepMode = 'loading' | 'bundled' | 'found' | 'missing'

export function opencodeStepMode(info: Pick<OpencodeInfo, 'found' | 'source'> | null): OpencodeStepMode {
  if (info === null) return 'loading'
  if (!info.found) return 'missing'
  return info.source === 'bundled' ? 'bundled' : 'found'
}

export function stepTitle(step: OnboardingStep, mode: OpencodeStepMode): string {
  if (step === 'opencode') return mode === 'bundled' ? t('wizard.stepTitle.bundled') : t('wizard.stepTitle.install')
  return {
    auth: t('wizard.stepTitle.auth'),
    model: t('wizard.stepTitle.model'),
    modes: t('wizard.stepTitle.modes'),
    permissions: t('wizard.stepTitle.permissions')
  }[step]
}

/**
 * ¿Se puede pasar del paso `step` al siguiente? El paso 1 exige que OpenCode funcione, salvo con el motor
 * incluido: allí es solo informativo (no hay nada que instalar) y el paso 2 avisa si el servidor aún no responde.
 */
export function canAdvance(
  step: OnboardingStep,
  s: { binaryFound: boolean; serverReady: boolean; source?: OpencodeSource | null }
): boolean {
  if (step !== 'opencode') return true
  if (s.binaryFound && s.source === 'bundled') return true
  return s.binaryFound && s.serverReady
}
