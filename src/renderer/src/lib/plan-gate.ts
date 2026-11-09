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

/**
 * El servidor de Control del Mac rechaza `computer_request_access` si el agente lo llama sin apps («Indica en "apps"… En este modo no
 * hace falta plan.»). Es un reintento interno del agente, no algo que la persona deba leer ni un fallo de su tarea (p. ej. en una tarea de
 * documentos): no se muestra ni cuenta como error.
 */
// Las comillas pueden llegar escapadas (\"apps\") o tipográficas según el puente MCP: se aceptan todas, y también la frase final sola.
const INTERNAL_ACCESS_RE =
  /Indica (?:en \\?["“]apps\\?["”] las apps que vas a controlar|al menos una app en \\?["“]apps\\?["”])|En este modo no hace falta plan/

export function isInternalAccessNoise(text: string | undefined | null): boolean {
  return !!text && INTERNAL_ACCESS_RE.test(text)
}

const SUBAGENT_BLOCK_RE = /Lanzamiento de subagente bloqueado por Lazunox/i
// «Solo explorar» lo frena la regla `task general deny` de la sesión; el motor responde con su texto de regla denegada.
const TASK_RULE_DENIED_RE = /specified a rule which prevents you from using this specific tool call/i

export type SubagentBlock = 'escalation' | 'rule' | 'unverified'

/**
 * Un ayudante (`task`) que Lazunox no dejó lanzar. Solo presentación: reconoce el texto del guardián
 * (`src/main/opencode/subagent-guard.ts`) o la regla de «Solo explorar» para explicarlo en llano; no cambia ningún permiso.
 */
export function subagentBlockKind(text: string | undefined | null): SubagentBlock | null {
  if (!text) return null
  if (TASK_RULE_DENIED_RE.test(text)) return 'rule'
  if (!SUBAGENT_BLOCK_RE.test(text)) return null
  return /tendria mas libertad|tendría más libertad/i.test(text) ? 'escalation' : 'unverified'
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
