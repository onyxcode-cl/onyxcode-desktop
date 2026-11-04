// @vitest-environment jsdom
// P4 / W4 (1.8.9): una carpeta de chat conectada («Chat sin carpeta») no monta TaskList, así que FolderGroups avisa al índice de sus tareas.
import { createElement } from 'react'
import { mount as mountEl, type Mounted } from '../../../../../test/dom-render'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
const sync = vi.hoisted(() => vi.fn())
vi.mock('./chatIndex', async (orig) => ({ ...(await orig<typeof import('./chatIndex')>()), syncChatSession: sync, loadChatIndex: vi.fn() }))

import { useSessions } from '../../../stores/sessions'
import { useTasks } from './store'
import { FolderGroups } from './FolderGroups'

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  sync.mockReset()
})

const CHAT = '/Users/x/Lazunox/Chats/20261104-abc123'
const session = (id: string, parentID?: string): unknown => ({
  id,
  directory: CHAT,
  title: `T-${id}`,
  parentID,
  time: { created: 1, updated: 5 }
})

function setup(folder: string, fullAccess: boolean): void {
  useTasks.setState({
    folder,
    folders: [{ path: folder, approvedAt: 1 }] as never,
    conn: { folder, directory: folder, fullAccess } as never
  })
  useSessions.setState({
    sessions: { a: session('a'), b: session('b', 'a') } as never,
    sessionSource: {},
    directorySource: {}
  })
}

describe('FolderGroups: índice de la carpeta de chat conectada', () => {
  it('avisa al índice de las tareas de primer nivel de una carpeta de chat aislada', () => {
    setup(CHAT, false)
    m = mountEl(createElement(FolderGroups))
    expect(sync).toHaveBeenCalledWith({ folder: CHAT, sessionId: 'a', title: 'T-a', updatedAt: 5 })
    expect(sync).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'b' }))
  })
  it('no indexa con Control total ni una carpeta que no es de chat (esa la alimenta TaskList)', () => {
    setup(CHAT, true)
    m = mountEl(createElement(FolderGroups))
    expect(sync).not.toHaveBeenCalled()
    m.unmount()
    setup('/Users/x/proyectos/web', false)
    m = mountEl(createElement(FolderGroups))
    expect(sync).not.toHaveBeenCalled()
  })
})
