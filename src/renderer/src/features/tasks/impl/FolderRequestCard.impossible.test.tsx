// @vitest-environment jsdom
// P4 (revisión): «Seguir en la carpeta de la tarea» solo aparece si main RECHAZA la carpeta; si la comprobación falla por error, no.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { mount as mountEl, type Mounted } from '../../../../../test/dom-render'

const cwMock = vi.hoisted(() => vi.fn())
vi.mock('./bridge', () => ({ cw: cwMock }))
const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
// La tarjeta y sus dependencias (actions.ts) importan muchas acciones del store real; como no se
// importa el store real (suscribe a useSessions al cargar), se sustituye por noops + un `useTasks`
// que evalúa el selector contra `mock.state`.
vi.mock('./store', () => {
  const noop = () => undefined
  return {
    useTasks: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(mock.state) : mock.state), {
      getState: () => mock.state,
      setState: () => undefined,
      subscribe: () => () => undefined
    }),
    rootTaskId: (id: string) => id,
    currentTasksModel: () => null,
    currentTasksVariant: () => null,
    dismissNetworkBlocked: noop,
    resolveNetworkBlocked: noop,
    clearFolder: noop,
    clearUnseen: noop,
    connectFolder: noop,
    disconnect: noop,
    forgetTaskMeta: noop,
    fullAccessFor: () => false,
    loadFullAccessInfo: noop,
    loadGrants: noop,
    loadProjectAndMemory: noop,
    loadTask: noop,
    refreshComputerStatus: noop,
    rememberFolder: noop,
    rememberFullAccess: noop,
    setTaskMeta: noop
  }
})
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { FolderRequestCard } from './FolderRequestCard'

const req = {
  id: 'per_1',
  sessionID: 's',
  permission: 'external_directory',
  patterns: ['/Users/ana/Lazunox/*'],
  metadata: { parentDir: '/Users/ana/Lazunox' },
  always: []
} as PermissionRequest

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20))
const texts = (): string => document.body.textContent ?? ''

describe('FolderRequestCard: carpeta imposible', () => {
  it('main la rechaza: aparece «Seguir en la carpeta de la tarea» y no «Permitir»', async () => {
    mock.state = { conn: { fullAccess: false, folder: '/Users/ana/Lazunox/Chats/x' }, policy: null }
    cwMock.mockResolvedValue({ ok: false, reason: 'Esa carpeta no se puede usar.' })
    m = mountEl(createElement(FolderRequestCard, { request: req }))
    await flush()
    expect(document.querySelector('[data-testid="folder-stay"]')).toBeTruthy()
    expect(texts()).not.toMatch(/Permitir/)
  })
  it('la comprobación falla por error: NO aparece «Seguir…» (falla cerrado, «Permitir» sigue sin concederse solo)', async () => {
    mock.state = { conn: { fullAccess: false, folder: '/Users/ana/Lazunox/Chats/x' }, policy: null }
    cwMock.mockRejectedValue(new Error('ipc caído'))
    m = mountEl(createElement(FolderRequestCard, { request: req }))
    await flush()
    expect(document.querySelector('[data-testid="folder-stay"]')).toBeNull()
  })
})
