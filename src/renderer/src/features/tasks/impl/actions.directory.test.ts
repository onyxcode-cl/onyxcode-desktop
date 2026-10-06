/**
 * Rutas de Tareas en la interfaz (W8): el SDK y las sesiones usan la ruta del sandbox (`conn.directory`, `/win/c/…`) y la
 * interfaz conserva y muestra la del anfitrión (`C:\…`). En macOS todo es identidad (misma cadena, byte a byte).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { makeSession } from '../../../../../test/fixtures/events'
import { toSandboxPath } from '@shared/wsl-paths'
import type { PathMapWire } from '@shared/tasks-path-map'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const WIN = 'C:\\Users\\ana\\proyecto'
const WIN_SB = '/win/c/Users/ana/proyecto'
const WIN_MAP: PathMapWire = { kind: 'wsl', mounts: [{ win: WIN, linux: WIN_SB }] }
const MAC = '/Users/ana/proyecto'
const SRC = 'http://cw1'

let S: typeof import('../../../stores/sessions')
let C: typeof import('./store')
let A: typeof import('./actions')
let P: typeof import('./conn-paths')
let U: typeof import('./util')
let T: typeof import('./transcript')
let PP: typeof import('./PermissionPrompt')
let SB: typeof import('./SidebarSections')

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  S = await import('../../../stores/sessions')
  C = await import('./store')
  A = await import('./actions')
  P = await import('./conn-paths')
  U = await import('./util')
  T = await import('./transcript')
  PP = await import('./PermissionPrompt')
  SB = await import('./SidebarSections')
})

function connect(kind: 'win' | 'mac'): { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  const rec = (o: Record<string, unknown>): Promise<{ data: unknown }> => {
    calls.push(o)
    return Promise.resolve({ data: {} })
  }
  const client = { session: { abort: rec } }
  const folder = kind === 'win' ? WIN : MAC
  const conn =
    kind === 'win'
      ? { folder, directory: WIN_SB, pathMap: WIN_MAP, baseUrl: SRC, fullAccess: false }
      : { folder, directory: folder, pathMap: { kind: 'identity' }, baseUrl: SRC, fullAccess: false }
  C.useTasks.setState({ client: client as never, folder, conn: conn as never, activeTaskId: null })
  return { calls }
}

describe('sdkDir / hostFolder / showPath', () => {
  it('Windows: directory del sandbox para el SDK, ruta de Windows para mostrar', () => {
    connect('win')
    expect(P.sdkDir(WIN)).toBe(WIN_SB)
    expect(P.hostFolder(WIN_SB)).toBe(WIN)
    expect(P.showPath(WIN_SB)).toBe(WIN)
    expect(P.showPath(`${WIN_SB}/sub`)).toBe(`${WIN}\\sub`)
    // una carpeta que no es la conectada no se traduce a la ligera
    expect(P.sdkDir('C:\\otra')).toBe('C:\\otra')
  })
  it('macOS: identidad exacta', () => {
    connect('mac')
    expect(P.sdkDir(MAC)).toBe(MAC)
    expect(P.hostFolder(MAC)).toBe(MAC)
    expect(P.showPath('/Users/ana/x y/ñ')).toBe('/Users/ana/x y/ñ')
  })
  it('sin conexión: identidad (un store sin conn no cambia nada)', () => {
    C.useTasks.setState({ conn: null })
    expect(P.sdkDir(MAC)).toBe(MAC)
    expect(P.showPath(MAC)).toBe(MAC)
  })
  it('el mapa traduce pero no autoriza: ruta sin forma válida se devuelve igual', () => {
    connect('win')
    expect(P.showPath('relativa/x')).toBe('relativa/x')
    expect(toSandboxPath('\\\\srv\\x').ok).toBe(false)
  })
})

describe('acciones: directory enviado al SDK', () => {
  it('Windows: abortBusyTasks envía la ruta del sandbox, no C:\\…', async () => {
    const { calls } = connect('win')
    S.useSessions.getState().upsertSession(makeSession('t1', WIN_SB), SRC)
    S.useSessions.getState().setStatus('t1', 'busy')
    await A.abortBusyTasks()
    expect(calls).toEqual([{ sessionID: 't1', directory: WIN_SB }])
  })
  it('macOS: abortBusyTasks envía la carpeta tal cual', async () => {
    const { calls } = connect('mac')
    S.useSessions.getState().upsertSession(makeSession('t1', MAC), SRC)
    S.useSessions.getState().setStatus('t1', 'busy')
    await A.abortBusyTasks()
    expect(calls).toEqual([{ sessionID: 't1', directory: MAC }])
  })
})

describe('store: comparaciones por carpeta', () => {
  it('Windows: addNetworkBlocked casa la sesión (directory del sandbox) con la carpeta de Windows', () => {
    connect('win')
    S.useSessions.getState().upsertSession(makeSession('t1', WIN_SB), SRC)
    S.useSessions.getState().setStatus('t1', 'busy')
    C.addNetworkBlocked({ folder: WIN, host: 'example.com' } as never)
    expect(C.useTasks.getState().networkBlocked.t1?.map((b) => b.host)).toEqual(['example.com'])
  })
  it('pinnedEntries: la carpeta de una fijada es la del anfitrión, no la del sandbox', () => {
    connect('win')
    const s = makeSession('t1', WIN_SB)
    const meta = { sessionId: 't1', folder: WIN, pinned: true, fullAccess: false, title: 'x', updatedAt: 1 } as never
    expect(SB.pinnedEntries({ t1: meta }, { t1: s }, P.hostFolder)[0].folder).toBe(WIN)
    // sin traductor (macOS): igual que antes
    expect(SB.pinnedEntries({ t1: meta }, { t1: makeSession('t1', MAC) })[0].folder).toBe(MAC)
  })
})

describe('mostrar rutas del usuario (H5/H6)', () => {
  const perm = (permission: string, metadata: Record<string, unknown>): PermissionRequest =>
    ({ id: 'p', sessionID: 's', permission, patterns: [], metadata, always: [] }) as unknown as PermissionRequest
  it('describePermission: otra carpeta y edición muestran C:\\…', () => {
    connect('win')
    const show = P.showPath
    expect(PP.describePermission(perm('external_directory', { parentDir: '/win/d/datos' }), [], show).detail).toBe('D:\\datos')
    expect(PP.describePermission(perm('edit', { filepath: `${WIN_SB}/a.txt` }), [], show).detail).toBe(`${WIN}\\a.txt`)
    // por omisión (macOS) la ruta sale igual
    expect(PP.describePermission(perm('edit', { filepath: '/Users/ana/a.txt' })).detail).toBe('/Users/ana/a.txt')
  })
  it('folderRequestPaths sigue calculando sobre la ruta Linux (lo que valida main)', () => {
    const r = U.folderRequestPaths(perm('external_directory', { parentDir: '/win/d/datos/a/b' }))
    expect(r.requested).toBe('/win/d/datos/a/b')
    expect(r.candidates[0]).toBe('/win/d/datos/a/b')
  })
  it('friendlyTool: listar muestra la ruta traducida', () => {
    connect('win')
    const part = { type: 'tool', tool: 'list', state: { status: 'completed', input: { path: `${WIN_SB}` } } } as never
    expect(U.friendlyTool(part, P.showPath).detail).toContain('proyecto')
    expect(U.friendlyTool(part, P.showPath).detail).not.toContain('/win/')
  })
  it('transcriptToMarkdown: la carpeta exportada es la de Windows', () => {
    connect('win')
    const s = { title: 't', directory: WIN_SB, time: { created: 1 } }
    expect(T.transcriptToMarkdown(s, [], { showPath: P.showPath })).toContain(WIN)
    expect(T.transcriptToMarkdown(s, [])).toContain(WIN_SB)
  })
})
