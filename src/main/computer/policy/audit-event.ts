/**
 * Del evento del canal lateral (`POST` del MCP con `phase: 'end'`) a una entrada del registro auditable (plan C §3). Puro.
 * Lista blanca: solo se conserva la herramienta, las coordenadas, el resultado y, para `type_text`, la LONGITUD (el MCP ya recorta
 * el texto del evento a ~120 caracteres: la longitud registrada es la del recorte); para `key`, la combinación. El resto de
 * `text` (nombres de apps, valores de la interfaz) se descarta.
 */
import type { AuditInput } from './audit'

export interface ActionEventLike {
  tool: string
  at?: number
  x?: number
  y?: number
  text?: string
  phase?: 'start' | 'end'
  ok?: boolean
}

/** `null` si el evento no es un final de acción (los `start` y los eventos sin fase no se registran). */
export function auditInputFromEvent(ev: ActionEventLike): AuditInput | null {
  if (ev.phase !== 'end') return null
  const input: AuditInput = { at: ev.at, tool: ev.tool, outcome: ev.ok === false ? 'error' : 'ok' }
  if (typeof ev.x === 'number' && typeof ev.y === 'number') {
    input.x = ev.x
    input.y = ev.y
  }
  if (ev.tool === 'type_text' && typeof ev.text === 'string') input.text = ev.text
  if (ev.tool === 'key' && typeof ev.text === 'string') input.keyCombo = ev.text
  return input
}
