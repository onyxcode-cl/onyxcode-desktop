/**
 * El servidor de Control total bloquea toda herramienta hasta que el usuario apruebe el plan y le devuelve a la IA un texto técnico
 * («Todavia no hay un plan aprobado…»). Eso no es un fallo: es la puerta de seguridad. Aquí se reconoce para mostrarlo con palabras
 * llanas y no contarlo como error.
 */
import { humanizeSystemError } from '@shared/ai-errors'
import { t } from '@shared/i18n'

const PLAN_GATE_RE = /todav[ií]a no hay un plan aprobado/i

const REJECTED_RE = /user rejected permission|rejected permission to use/i

/** El motor devuelve este texto cuando la persona pulsó «Rechazar» (o el modo de permisos lo denegó): no es un fallo de la herramienta. */
export function isRejectedText(text: string | undefined | null): boolean {
  return !!text && REJECTED_RE.test(text)
}

export function isPlanGateText(text: string | undefined | null): boolean {
  return !!text && PLAN_GATE_RE.test(text)
}

/**
 * Texto de error listo para mostrar: el de la puerta del plan se cambia por un aviso claro y un fallo crudo del sistema
 * de una sola línea (`EPERM: operation not permitted, open '…'`) se explica en llano. La salida larga de un comando
 * (varias líneas) no se toca: ahí el texto original es justo lo que se quiere leer. `technical` (Code, para quien programa)
 * conserva el texto crudo del sistema y solo traduce la puerta del plan.
 */
export function friendlyToolError(text: string, technical = false): string {
  if (isPlanGateText(text)) return t('tasks.gate.waiting')
  if (isRejectedText(text)) return t('code.tool.rejectedHint')
  if (!technical && text && !text.trim().includes('\n')) return humanizeSystemError(text) ?? text
  return text
}
