/** Modo unificado: carpeta propia de un chat sin carpeta elegida (`~/Lazunox/Chats/<id>`). */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
const pol = vi.hoisted(() => ({ value: null as { allowedFolderRoots?: string[] } | null }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null, revokeToken: () => undefined }
}))
vi.mock('./policy', () => ({
  loadManagedPolicy: () => pol.value,
  isComputerUseDisabled: () => false
}))

import { UNIFIED_APPS_ENV } from '@shared/unified-bridge'
import { TasksManager } from './manager'

let root: string
let home: string
let prevHome: string | undefined
let prevFlag: string | undefined

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(homedir(), '.lazunox-chatfolder-test-')))
  home = join(root, 'home')
  mkdirSync(home, { recursive: true })
  state.userData = join(root, 'userData')
  mkdirSync(state.userData, { recursive: true })
  pol.value = null
  prevHome = process.env.HOME
  prevFlag = process.env[UNIFIED_APPS_ENV]
  process.env.HOME = home
  process.env[UNIFIED_APPS_ENV] = '1'
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  if (prevFlag === undefined) delete process.env[UNIFIED_APPS_ENV]
  else process.env[UNIFIED_APPS_ENV] = prevFlag
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!macOnly)('createChatFolder', () => {
  it('crea ~/Lazunox/Chats/<fecha>-<6>, con permisos 0700, y la aprueba', async () => {
    const m = new TasksManager()
    const f = await m.createChatFolder()
    expect(f.path.startsWith(join(realpathSync(home), 'Lazunox', 'Chats') + '/')).toBe(true)
    expect(f.path).toMatch(/\/\d{8}-[0-9a-f]{6}$/)
    expect(statSync(f.path).mode & 0o777).toBe(0o700)
    expect(statSync(join(home, 'Lazunox', 'Chats')).mode & 0o777).toBe(0o700)
    expect(m.isApproved(f.path)).toBe(true)
    expect(m.listFolders().map((x) => x.path)).toContain(f.path)
  })

  it('cada llamada crea una carpeta distinta', async () => {
    const m = new TasksManager()
    const ids = new Set<string>()
    for (let i = 0; i < 10; i++) ids.add((await m.createChatFolder()).path)
    expect(ids.size).toBe(10)
  })

  it('rechaza si ~/Lazunox es un enlace simbólico y no crea nada en el destino', async () => {
    const target = join(root, 'elsewhere')
    mkdirSync(target)
    symlinkSync(target, join(home, 'Lazunox'))
    await expect(new TasksManager().createChatFolder()).rejects.toThrow(/enlace/)
    expect(existsSync(join(target, 'Chats'))).toBe(false)
  })

  it('rechaza si ~/Lazunox/Chats es un enlace simbólico', async () => {
    const target = join(root, 'elsewhere')
    mkdirSync(target)
    mkdirSync(join(home, 'Lazunox'))
    symlinkSync(target, join(home, 'Lazunox', 'Chats'))
    await expect(new TasksManager().createChatFolder()).rejects.toThrow(/enlace/)
    expect(existsSync(join(target))).toBe(true)
  })

  it('la política gestionada que no permite ~/Lazunox/Chats: error claro y no se crea nada', async () => {
    pol.value = { allowedFolderRoots: [join(home, 'Trabajo')] }
    const m = new TasksManager()
    await expect(m.createChatFolder()).rejects.toThrow(/organización/)
    expect(existsSync(join(home, 'Lazunox'))).toBe(false)
    expect(m.listFolders()).toEqual([])
  })

  it('la política que sí incluye ~/Lazunox/Chats la admite', async () => {
    pol.value = { allowedFolderRoots: [join(home, 'Lazunox', 'Chats')] }
    const f = await new TasksManager().createChatFolder()
    expect(existsSync(f.path)).toBe(true)
  })

  it('sin bandera: rechaza y no crea nada', async () => {
    delete process.env[UNIFIED_APPS_ENV]
    await expect(new TasksManager().createChatFolder()).rejects.toThrow('apagado')
    expect(existsSync(join(home, 'Lazunox'))).toBe(false)
  })
})

describe('createChatFolder en Windows', () => {
  it('rechaza con el aviso de que no está disponible', async () => {
    const win = { refresh: async () => undefined } as never
    const m = new TasksManager({ platform: 'win32', win })
    await expect(m.createChatFolder()).rejects.toThrow('Windows')
  })
})
