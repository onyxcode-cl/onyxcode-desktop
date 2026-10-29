import { describe, expect, it } from 'vitest'
import type { ChatIndexEntry, TasksFolder } from '@shared/ipc-tasks'
import { buildFolderGroups, COMPUTER_GROUP } from './FolderGroups'

const F = (path: string, lastUsedAt?: number, approvedAt = 1): TasksFolder => ({
  path,
  name: path.split('/').pop() ?? path,
  approvedAt,
  lastUsedAt
})
const E = (folder: string, id: string, updatedAt: number, title = id): ChatIndexEntry => ({ folder, sessionId: id, title, updatedAt })
const isChat = (p: string): boolean => /\/Lazunox\/Chats\//.test(p)

const build = (over: Partial<Parameters<typeof buildFolderGroups>[0]>) =>
  buildFolderGroups({ folders: [], connected: null, entries: [], isChatFolder: isChat, computerName: 'Este equipo', ...over })

describe('buildFolderGroups', () => {
  it('una carpeta por grupo, la conectada primero y el resto por último uso', () => {
    const g = build({
      folders: [F('/a/uno', 10), F('/a/dos', 30), F('/a/tres', 20)],
      connected: '/a/tres'
    })
    expect(g.map((x) => x.name)).toEqual(['tres', 'dos', 'uno'])
    expect(g[0]!.connected).toBe(true)
    expect(g[1]!.connected).toBe(false)
  })

  it('reparte los chats del índice por carpeta, el más reciente primero, sin mezclar carpetas', () => {
    const g = build({
      folders: [F('/a/uno', 1), F('/a/dos', 2)],
      entries: [E('/a/uno', 's1', 5), E('/a/uno', 's2', 9), E('/a/dos', 's3', 7)]
    })
    const dos = g.find((x) => x.name === 'dos')!
    const uno = g.find((x) => x.name === 'uno')!
    expect(uno.entries.map((e) => e.sessionId)).toEqual(['s2', 's1'])
    expect(dos.entries.map((e) => e.sessionId)).toEqual(['s3'])
  })

  it('una carpeta sin chats igual aparece', () => {
    const g = build({ folders: [F('/a/vacia', 1)] })
    expect(g).toHaveLength(1)
    expect(g[0]!.entries).toEqual([])
  })

  it('las carpetas de chat se juntan en «Este equipo», al final, solo si tienen chats', () => {
    const chat = '/Users/x/Lazunox/Chats/20261029-aaaaaa'
    const sinChats = build({ folders: [F('/a/uno', 1), F(chat, 5)] })
    expect(sinChats.map((x) => x.key)).toEqual(['/a/uno'])
    const con = build({ folders: [F('/a/uno', 1), F(chat, 5)], entries: [E(chat, 'c1', 3), E('/a/uno', 's1', 2)] })
    expect(con.map((x) => x.key)).toEqual(['/a/uno', COMPUTER_GROUP])
    expect(con.at(-1)!.name).toBe('Este equipo')
    expect(con.at(-1)!.entries.map((e) => e.sessionId)).toEqual(['c1'])
  })

  it('compara rutas sin distinguir barras ni la barra final (Windows)', () => {
    const g = build({
      folders: [F('C:\\Users\\Ben\\prueba', 1)],
      connected: 'C:/Users/Ben/prueba/',
      entries: [E('C:/Users/Ben/prueba', 's1', 4)]
    })
    expect(g[0]!.connected).toBe(true)
    expect(g[0]!.entries).toHaveLength(1)
  })

  it('usa la fecha de aprobación si nunca se usó', () => {
    const g = build({ folders: [F('/a/vieja', undefined, 5), F('/a/nueva', undefined, 50)] })
    expect(g.map((x) => x.name)).toEqual(['nueva', 'vieja'])
  })
})
