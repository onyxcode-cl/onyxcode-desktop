import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'

// Mismo stub mínimo del store que usa TaskConversation.render.test.tsx.
vi.mock('./store', () => ({
  useTasks: Object.assign(() => undefined, { getState: () => ({}), setState: () => undefined, subscribe: () => () => undefined })
}))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { describePermission, PermissionCard } from './PermissionPrompt'

const DIFF =
  'Index: /w/a.txt\n===================================================================\n--- /w/a.txt\n+++ /w/a.txt\n@@ -1,2 +1,2 @@\n uno\n-dos\n+DOS\n'
const edit = (diff: string): PermissionRequest =>
  ({
    id: 'per_1',
    sessionID: 's',
    permission: 'edit',
    patterns: ['a.txt'],
    metadata: { filepath: '/w/a.txt', diff },
    always: []
  }) as PermissionRequest

describe('tarjeta de permiso de edición', () => {
  it('describePermission separa la ruta (detail) del diff', () => {
    const d = describePermission(edit(DIFF))
    expect(d.detail).toBe('/w/a.txt')
    expect(d.diff).toBe(DIFF)
  })
  it('muestra el diff con DiffView (filas con +/-) y el botón «Rechazar con indicaciones»', () => {
    const html = renderToStaticMarkup(<PermissionCard request={edit(DIFF)} />)
    expect(html).toContain('<table')
    expect(html).toContain('DOS')
    expect(html).toContain('Rechazar con indicaciones')
    expect(html).not.toContain('Index: /w/a.txt')
  })
  it('un diff sin líneas cambiadas se muestra como texto', () => {
    const html = renderToStaticMarkup(<PermissionCard request={edit('sin formato')} />)
    expect(html).toContain('sin formato')
    expect(html).not.toContain('<table')
  })
})
