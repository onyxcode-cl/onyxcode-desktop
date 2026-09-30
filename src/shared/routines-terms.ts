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

export const ROUTINES_TERMS_TITLE = 'Rutinas y los términos de OpenCode'
export const ROUTINES_TERMS_BODY =
  'Las rutinas se ejecutan solas, aunque no estés mirando la app. Los términos de servicio de OpenCode restringen los procesos que corren o se activan mientras no has iniciado sesión en sus servicios, y dejan a OpenCode decidir qué cuenta como infracción; pueden suspender el acceso. Es tu responsabilidad usar las rutinas de acuerdo con esos términos (opencode.ai/legal/terms-of-service).'
export const ROUTINES_TERMS_CANCEL = 'Cancelar'
export const ROUTINES_TERMS_CONFIRM = 'Entiendo, activar rutinas'
export const ROUTINES_NOTICE_TEXT = 'Tus rutinas no se ejecutan solas hasta que aceptes el aviso sobre los términos de OpenCode'
export const ROUTINES_NOTICE_BUTTON = 'Ver aviso y activar'
