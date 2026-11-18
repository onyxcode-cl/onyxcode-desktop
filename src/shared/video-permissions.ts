/** Permisos fijos de video, iguales a los de crear/renderizar documentos en Code. */
import { documentsCreateAction } from './documents-permissions'
import type { PermissionModeId, PermissionRuleLike, RuleAction } from './permission-rules'
export const VIDEO_SERVER = 'video'
export const VIDEO_TOOLS = ['video_cuadros', 'video_render'] as const
export function videoConfigPermission(): Record<string, RuleAction> {
  return { video_cuadros: 'allow', video_render: 'ask' }
}
export function videoSessionRules(mode: PermissionModeId, agent?: string): PermissionRuleLike[] {
  return [
    { permission: 'video_cuadros', pattern: '*', action: 'allow' },
    { permission: 'video_render', pattern: '*', action: documentsCreateAction(mode, agent) }
  ]
}
export function chatVideoPermissions(enabled: boolean): Record<string, RuleAction> {
  return { video_cuadros: enabled ? 'allow' : 'deny', video_render: enabled ? 'allow' : 'deny' }
}
