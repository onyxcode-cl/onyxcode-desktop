/**
 * Modelo puro de las acciones de la tarjeta de permiso en el celular (rediseño PWA, tanda T0): qué botones hay, en qué orden,
 * con qué variante y qué respuesta envía cada uno. Sin React ni store: lo prueba `perm-actions.test.ts` y la tarjeta (T3) solo
 * recorre la lista. No cambia ningún texto ni ninguna respuesta de seguridad.
 *
 * Orden (decisiones-pwa #1):
 * - Destructivo: «Rechazar» primero (ancho completo), luego «Permitir una vez» (peligro) y «Rechazar con indicaciones».
 *   Nunca «Permitir siempre».
 * - No destructivo: «Permitir una vez» primero (ancho completo, primario), «Rechazar», «Rechazar con indicaciones» y, solo si
 *   hoy aparece (`canAlways`), «Permitir siempre» al final.
 * - `kind: 'folder'`: la tarjeta es `FolderRequestCard` (tiene sus propias acciones): sin acciones aquí.
 * - `noting`: con el cuadro de indicaciones abierto, «Rechazar con indicaciones» no se repite.
 */
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'

export type PermActionId = 'once' | 'always' | 'reject' | 'note'
export type PermVariant = 'primary' | 'danger' | 'neutral' | 'outline'

export interface PermAction {
  id: PermActionId
  /** Respuesta que viaja al motor (`note` es un rechazo con un mensaje del usuario). */
  reply: 'once' | 'always' | 'reject'
  variant: PermVariant
  labelKey: 'tasksComputer.perm.once' | 'tasksComputer.perm.always' | 'tasksComputer.perm.reject' | 'tasksComputer.perm.rejectNote'
  /** Ocupa toda la fila. */
  fullWidth: boolean
  /** `always` lleva como `title` el texto de `alwaysHint(request)`. */
  title?: 'alwaysHint'
}

export interface PermActionsInput {
  danger: boolean
  canAlways: boolean
  kind?: 'folder'
  noting: boolean
}

const LABEL = {
  once: 'tasksComputer.perm.once',
  always: 'tasksComputer.perm.always',
  reject: 'tasksComputer.perm.reject',
  note: 'tasksComputer.perm.rejectNote'
} as const

export function permActions({ danger, canAlways, kind, noting }: PermActionsInput): PermAction[] {
  if (kind === 'folder') return []
  const once: PermAction = { id: 'once', reply: 'once', variant: danger ? 'danger' : 'primary', labelKey: LABEL.once, fullWidth: !danger }
  const reject: PermAction = { id: 'reject', reply: 'reject', variant: 'neutral', labelKey: LABEL.reject, fullWidth: danger }
  const note: PermAction = { id: 'note', reply: 'reject', variant: 'neutral', labelKey: LABEL.note, fullWidth: false }
  const always: PermAction = {
    id: 'always',
    reply: 'always',
    variant: 'outline',
    labelKey: LABEL.always,
    fullWidth: true,
    title: 'alwaysHint'
  }
  const list = danger ? [reject, once, note] : [once, reject, note]
  // «Permitir siempre» nunca en un permiso destructivo, aunque quien llame diga `canAlways`.
  if (canAlways && !danger) list.push(always)
  return noting ? list.filter((a) => a.id !== 'note') : list
}

/** Funciones del motor que usa una respuesta (las reales: `replyPermission` y `replyPermissionAlways` de `actions.ts`). */
export interface PermReplyApi {
  replyPermission: (requestID: string, reply: 'once' | 'always' | 'reject', message?: string) => Promise<void>
  replyPermissionAlways: (request: PermissionRequest) => Promise<void>
}

/** Qué llamada hace cada acción. `message` solo cuenta en `note` (indicaciones al agente; vacío = rechazo simple). */
export function runPermAction(id: PermActionId, request: PermissionRequest, api: PermReplyApi, message?: string): Promise<void> {
  if (id === 'always') return api.replyPermissionAlways(request)
  if (id === 'note') return api.replyPermission(request.id, 'reject', message?.trim() || undefined)
  return api.replyPermission(request.id, id)
}
