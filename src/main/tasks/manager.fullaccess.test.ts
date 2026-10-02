/**
 * Control total sin carpeta (F8-B44): reglas del gestor. Sin consentimiento del equipo no arranca; con él arranca SIN
 * carpeta autorizada y con la carpeta personal como cwd por defecto; Sandbox sigue exigiendo carpeta autorizada (y
 * rechaza la carpeta personal); las concesiones antiguas por carpeta siguen valiendo; la política lo bloquea.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '', policy: null as null | { disableFullAccess?: boolean; allowedFolderRoots?: string[] } }))
const started = vi.hoisted(() => [] as Array<{ folder: string; noSandbox: boolean | undefined }>)

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null }
}))
vi.mock('./policy', () => ({ loadManagedPolicy: () => state.policy }))
vi.mock('./sandbox', () => ({
  sandboxKey: (f: string) => f,
  startTasksServer: async (folder: string, opts: { noSandbox?: boolean }) => {
    started.push({ folder, noSandbox: opts.noSandbox })
    return {
      folder,
      baseUrl: 'http://127.0.0.1:1',
      authorization: 'x',
      sandboxed: false,
      version: '0',
      pid: undefined,
      stop: async () => undefined
    }
  }
}))

import { FULL_ACCESS_NOT_GRANTED } from '@shared/ipc-tasks'
import { TasksManager } from './manager'

let root: string
let home: string
let prevHome: string | undefined

beforeEach(() => {
  // Dentro del home real: /private (tmp) es «carpeta del sistema» para Sandbox.
  root = realpathSync(mkdtempSync(join(homedir(), '.onyx-ctl-test-')))
  home = join(root, 'home')
  mkdirSync(join(home, 'Documents'), { recursive: true })
  mkdirSync(join(home, '.ssh'), { recursive: true })
  state.userData = join(root, 'userData')
  mkdirSync(state.userData, { recursive: true })
  state.policy = null
  started.length = 0
  prevHome = process.env.HOME
  process.env.HOME = home
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  rmSync(root, { recursive: true, force: true })
})

describe('Control total sin carpeta', () => {
  it('sin consentimiento del equipo no arranca', async () => {
    const m = new TasksManager()
    await expect(m.start(home, true)).rejects.toThrow(FULL_ACCESS_NOT_GRANTED)
    expect(started).toHaveLength(0)
    expect(m.fullAccessState().consentAt).toBeNull()
  })

  it('con consentimiento arranca sin carpeta autorizada, sin sandbox y con cwd en la carpeta personal', async () => {
    const m = new TasksManager()
    const at = m.grantFullAccessConsent()
    expect(at).toBeGreaterThan(0)
    expect(m.fullAccessState()).toMatchObject({ consentAt: at, workspace: realpathSync(home), home: realpathSync(home), disabled: false })
    expect(m.isApproved(home)).toBe(false)
    const conn = await m.start(m.fullAccessState().workspace, true)
    expect(conn.fullAccess).toBe(true)
    expect(started).toEqual([{ folder: realpathSync(home), noSandbox: true }])
    expect(m.listFolders()).toHaveLength(0) // no se autoriza nada para Sandbox
  })

  it('el consentimiento es único por equipo: conserva la fecha, persiste y sirve para cualquier carpeta', async () => {
    const m = new TasksManager()
    const at = m.grantFullAccessConsent()
    expect(m.grantFullAccessConsent()).toBe(at)
    const other = join(home, 'Documents')
    await m.start(other, true)
    expect(new TasksManager().fullAccessState().consentAt).toBe(at)
    expect(m.fullAccessState().workspace).toBe(realpathSync(other)) // «última usada»
    rmSync(other, { recursive: true })
    expect(m.fullAccessState().workspace).toBe(realpathSync(home)) // ya no existe: vuelve al home
  })

  it('una carpeta inexistente no arranca aunque haya consentimiento', async () => {
    const m = new TasksManager()
    m.grantFullAccessConsent()
    await expect(m.start(join(home, 'nada'), true)).rejects.toThrow()
    expect(started).toHaveLength(0)
  })

  it('Sandbox sigue pidiendo carpeta autorizada y rechaza la carpeta personal', async () => {
    const m = new TasksManager()
    m.grantFullAccessConsent()
    await expect(m.start(join(home, 'Documents'), false)).rejects.toThrow()
    expect(() => m.approveFolder(home)).toThrow()
    expect(started).toHaveLength(0)
    const ok = m.approveFolder(join(home, 'Documents'))
    const conn = await m.start(ok.path, false)
    expect(conn.fullAccess).toBe(false)
    expect(started[0].noSandbox).toBeFalsy()
  })

  it('retirar el consentimiento lo borra todo (también las concesiones por carpeta) y detiene los servidores', async () => {
    const m = new TasksManager()
    const docs = m.approveFolder(join(home, 'Documents')).path
    m.grantFullAccess(docs)
    m.grantFullAccessConsent()
    await m.start(docs, true)
    await m.revokeFullAccessConsent()
    expect(m.fullAccessState().consentAt).toBeNull()
    expect(m.hasFullAccessGrant(docs)).toBe(false)
    expect(m.liveServers()).toHaveLength(0)
    await expect(m.start(docs, true)).rejects.toThrow(FULL_ACCESS_NOT_GRANTED)
  })

  it('compatibilidad: una carpeta con la concesión antigua sigue funcionando sin consentimiento nuevo', async () => {
    const docs = join(home, 'Documents')
    writeFileSync(
      join(state.userData, 'tasks-folders.json'),
      JSON.stringify({
        folders: [{ path: realpathSync(docs), name: 'Documents', approvedAt: 1 }],
        fullAccess: [{ path: realpathSync(docs), grantedAt: 1 }]
      })
    )
    const m = new TasksManager()
    expect(m.fullAccessState().consentAt).toBeNull()
    const conn = await m.start(docs, true)
    expect(conn.fullAccess).toBe(true)
    // …pero eso no abre otras carpetas.
    await expect(m.start(home, true)).rejects.toThrow(FULL_ACCESS_NOT_GRANTED)
  })

  it('la política `disableFullAccess` lo impide aunque exista consentimiento', async () => {
    const m = new TasksManager()
    m.grantFullAccessConsent()
    state.policy = { disableFullAccess: true }
    expect(m.fullAccessState()).toMatchObject({ consentAt: null, disabled: true })
    expect(() => m.grantFullAccessConsent()).toThrow()
    await expect(m.start(home, true)).rejects.toThrow(FULL_ACCESS_NOT_GRANTED)
    expect(m.canStartFullAccess(home)).toBe(false)
  })

  it('con `allowedFolderRoots` (política) Control total sigue exigiendo carpeta autorizada', async () => {
    const m = new TasksManager()
    m.grantFullAccessConsent()
    state.policy = { allowedFolderRoots: [join(home, 'Documents')] }
    await expect(m.start(home, true)).rejects.toThrow(FULL_ACCESS_NOT_GRANTED)
  })

  it('las funciones de la interfaz ven el espacio de Control total pero nunca los secretos; sin consentimiento, nada', () => {
    const m = new TasksManager()
    const file = join(home, 'Documents', 'a.txt')
    expect(() => m.assertInsideApproved(file)).toThrow()
    m.grantFullAccessConsent()
    expect(m.assertInsideApproved(file)).toBe(file)
    expect(() => m.assertInsideApproved(join(home, '.ssh', 'id_rsa'))).toThrow()
    expect(() => m.assertInsideApproved(join(root, 'fuera.txt'))).toThrow()
    expect(m.coversHome(home)).toBe(true)
    expect(m.coversHome(join(home, 'Documents'))).toBe(false)
  })

  it('los entregables de la carpeta personal no se recorren', () => {
    const m = new TasksManager()
    expect(() => m.deliverables(home, 0)).toThrow()
    m.grantFullAccessConsent()
    expect(m.deliverables(home, 0)).toEqual([])
  })
})
