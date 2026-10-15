/**
 * El servidor de Control total bloquea toda herramienta hasta que el usuario apruebe el plan y le devuelve a la IA un texto técnico
 * («Todavia no hay un plan aprobado…»). Eso no es un fallo: es la puerta de seguridad. Aquí se reconoce para mostrarlo con palabras
 * llanas y no contarlo como error.
 */
import { t } from '@shared/i18n'

const PLAN_GATE_RE = /todav[ií]a no hay un plan aprobado/i

export function isPlanGateText(text: string | undefined | null): boolean {
  return !!text && PLAN_GATE_RE.test(text)
}

/** Texto de error listo para mostrar: el de la puerta del plan se cambia por un aviso claro. */
export function friendlyToolError(text: string): string {
  return isPlanGateText(text) ? t('tasks.gate.waiting') : text
}
