/** P4 (1.8.9): W3 (ruta de WSL en el aviso de carpeta) y W2 (salida «seguir en la carpeta de la tarea»). */
import { describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { describePermission } from './PermissionPrompt'
import { folderRefusal } from './actions'
import { showPathOf } from './path-map'
import type { TasksConnection } from '@shared/ipc-tasks'

const conn = {
  folder: 'C:\\Users\\Bentec\\Lazunox\\Chats\\x',
  directory: '/win/c/Users/Bentec/Lazunox/Chats/x',
  pathMap: { kind: 'wsl', mounts: [{ win: 'C:\\Users\\Bentec\\Lazunox', linux: '/win/c/Users/Bentec/Lazunox' }] }
} as unknown as TasksConnection

const req = (patterns: string[], metadata: Record<string, unknown> = {}): PermissionRequest =>
  ({ id: 'p1', sessionID: 's1', permission: 'external_directory', patterns, always: [], metadata }) as PermissionRequest

describe('W3: el aviso de carpeta muestra C:\\… y no la ruta interna de WSL', () => {
  const show = (p: string): string => showPathOf(conn, p)
  it('con patrón tipo glob (sin metadatos) quita el /* y traduce', () => {
    const d = describePermission(req(['/win/c/Users/Bentec/Lazunox/*']), [], show)
    expect(d.detail).toBe('C:\\Users\\Bentec\\Lazunox')
    expect(d.detail).not.toContain('/win/')
  })
  it('varios patrones se traducen uno a uno', () => {
    const d = describePermission(req(['/win/c/Users/Bentec/Lazunox/*', '/win/c/Users/Bentec/Lazunox/Chats/*']), [], show)
    expect(d.detail).not.toContain('/win/')
  })
  it('con parentDir sigue igual', () => {
    const d = describePermission(req(['/win/c/Users/Bentec/Lazunox/*'], { parentDir: '/win/c/Users/Bentec/Lazunox' }), [], show)
    expect(d.detail).toBe('C:\\Users\\Bentec\\Lazunox')
  })
  it('en macOS (identidad) no cambia la ruta, solo se quita el /*', () => {
    const d = describePermission(req(['/Users/ana/proyectos/*']))
    expect(d.detail).toBe('/Users/ana/proyectos')
  })
})

describe('W2: «seguir en la carpeta de la tarea» solo niega y orienta', () => {
  it('el texto para la IA dice que no use esa carpeta, que siga en la de la tarea y que no salga con cd/..', () => {
    const msg = folderRefusal('stay', 'C:\\Users\\Bentec\\Lazunox')
    expect(msg).toContain('no se puede usar')
    expect(msg).toContain('dentro de la carpeta de la tarea')
    expect(msg).toContain('..')
    expect(msg).not.toMatch(/ya tienes acceso|puedes usar/i)
  })
})
