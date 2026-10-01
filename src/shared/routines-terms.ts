/**
 * Aviso de Rutinas y los términos de OpenCode: lógica pura y textos, compartidos por el planificador (main)
 * y la vista de Rutinas (renderer). Las rutinas programadas se ejecutan solas; hasta que el usuario reconoce
 * el aviso (`Settings.routinesTermsAcknowledged`) no se ejecutan automáticamente. «Ejecutar ahora» (manual)
 * no depende de esto.
 */
import type { Settings } from './types'

/** ¿Puede el planificador ejecutar rutinas por horario (sin el usuario delante)? Solo tras el reconocimiento. */
export function shouldRunUnattended(settings: Pick<Settings, 'routinesTermsAcknowledged'> | null | undefined): boolean {
  return settings?.routinesTermsAcknowledged === true
}

/** ¿Hay que mostrar el aviso no bloqueante en la vista? Rutinas activas sin reconocimiento. */
export function needsRoutinesNotice(acknowledged: boolean, routines: ReadonlyArray<{ enabled: boolean }>): boolean {
  return !acknowledged && routines.some((r) => r.enabled)
}

/** ¿Hay que pedir el reconocimiento antes de crear/activar (o guardar activada) una rutina programada? */
export function needsRoutinesConsent(acknowledged: boolean, willBeEnabled: boolean): boolean {
  return !acknowledged && willBeEnabled
}

// Los textos del aviso (título, cuerpo, botones) viven en el diccionario de idioma (`routines.terms.*`).
