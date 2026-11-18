import { describe, expect, it } from 'vitest'
import { chatVideoPermissions, videoConfigPermission, videoSessionRules } from './video-permissions'
import { documentsCreateAction } from './documents-permissions'
import type { PermissionModeId } from './permission-rules'

describe('permisos del video', () => {
  it('suelo conservador y solo dos herramientas explícitas en Chat', () => {
    expect(videoConfigPermission()).toEqual({ video_cuadros: 'allow', video_render: 'ask' })
    expect(chatVideoPermissions(true)).toEqual({ video_cuadros: 'allow', video_render: 'allow' })
    expect(chatVideoPermissions(false)).toEqual({ video_cuadros: 'deny', video_render: 'deny' })
  })
  it('render en cada modo tiene el mismo permiso que crear documentos', () => {
    for (const mode of ['manual', 'acceptEdits', 'plan', 'auto', 'bypass'] as PermissionModeId[]) {
      expect(videoSessionRules(mode)).toEqual([
        { permission: 'video_cuadros', pattern: '*', action: 'allow' },
        { permission: 'video_render', pattern: '*', action: documentsCreateAction(mode) }
      ])
    }
  })
})
