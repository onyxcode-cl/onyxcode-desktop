/**
 * Modo unificado en Windows (carpetas de chat), con la plataforma inyectada en win32 y un disco doble (macOS, sin Windows real).
 * Lo que exige el PC real (junctions NTFS de verdad, birthtime, ACL del perfil) está en el informe de la etapa, no aquí.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null, revokeToken: () => undefined }
}))
vi.mock('./policy', () => ({ loadManagedPolicy: () => null, isComputerUseDisabled: () => false }))

import { t } from '@shared/i18n'
import { UNIFIED_APPS_ENV, UNIFIED_APPS_WIN_ENV } from '@shared/unified-bridge'
import { TasksManager } from './manager'
import { createWinHost } from './win-context'
import type { WinChatFs } from './chat-folders-win'

const HOME = 'C:\\Users\\Ben'
const ENV = {
  USERPROFILE: HOME,
  SystemRoot: 'C:\\Windows',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: `${HOME}\\AppData\\Local`
}
const DAY = 24 * 3600 * 1000

/** Disco doble único: carpetas (con fechas), enlaces/junctions y equivalencias de realpath. */
function fakeDisk() {
  const key = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const dirs = new Map<string, { name: string; birth: number; mtime: number }>()
  const links = new Set<string>()
  const real = new Map<string, string>()
  const err = (code: string): never => {
    throw Object.assign(new Error(code), { code })
  }
  const add = (p: string, birth = Date.now()): void => void dirs.set(key(p), { name: p, birth, mtime: birth })
  const kids = (p: string): string[] =>
    [...dirs.keys()].filter((k) => k.startsWith(key(p) + '\\') && !k.slice(key(p).length + 1).includes('\\'))
  const host = createWinHost({
    env: ENV,
    userData: `${HOME}\\AppData\\Roaming\\Lazunox`,
    execPath: `${HOME}\\AppData\\Local\\Programs\\Lazunox\\Lazunox.exe`,
    readDrives: async () => [{ letter: 'C', kind: 'fixed' }],
    fs: {
      lstat: (p) => {
        if (!dirs.has(key(p)) && !links.has(key(p))) err('ENOENT')
        return { isSymbolicLink: () => links.has(key(p)) }
      },
      readdir: () => [],
      realpath: (p) => real.get(key(p)) ?? dirs.get(key(p))?.name ?? p,
      isDirectory: (p) => dirs.has(key(p))
    }
  })
  const fs: WinChatFs = {
    lstat: (p) => {
      const d = dirs.get(key(p))
      if (!d && !links.has(key(p))) return null
      return { isSymbolicLink: () => links.has(key(p)), isDirectory: () => !!d, birthtimeMs: d?.birth ?? 0, mtimeMs: d?.mtime ?? 0 }
    },
    realpath: (p) => {
      if (!dirs.has(key(p)) && !links.has(key(p))) err('ENOENT')
      return real.get(key(p)) ?? dirs.get(key(p))?.name ?? p
    },
    mkdir: (p) => {
      if (dirs.has(key(p))) err('EEXIST')
      const parent = p.slice(0, p.lastIndexOf('\\'))
      if (!dirs.has(key(parent))) err('ENOENT')
      add(p)
    },
    rmdir: (p) => {
      if (kids(p).length) err('ENOTEMPTY')
      dirs.delete(key(p))
    },
    readdir: (p) => kids(p)
  }
  return { host, fs, dirs, links, real, add, key }
}

let root: string
let disk: ReturnType<typeof fakeDisk>
let prevFlag: string | undefined
const mk = (): TasksManager => new TasksManager({ platform: 'win32', win: disk.host, winChatFs: disk.fs })
const chats = `${HOME}\\Lazunox\\Chats`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-chatwin-'))
  state.userData = join(root, 'userData')
  prevFlag = process.env[UNIFIED_APPS_ENV]
  process.env[UNIFIED_APPS_ENV] = '1'
  process.env[UNIFIED_APPS_WIN_ENV] = '1'
  disk = fakeDisk()
  for (const d of ['C:\\', 'C:\\Users', HOME, 'C:\\Windows', 'C:\\lzx']) disk.add(d)
})
afterEach(() => {
  if (prevFlag === undefined) delete process.env[UNIFIED_APPS_ENV]
  else process.env[UNIFIED_APPS_ENV] = prevFlag
  delete process.env[UNIFIED_APPS_WIN_ENV]
  rmSync(root, { recursive: true, force: true })
})

describe('createChatFolder en win32', () => {
  it('crea Lazunox\\Chats\\<id>, la aprueba y la reconoce como carpeta de chat', async () => {
    const m = mk()
    const f = await m.createChatFolder()
    expect(f.path).toMatch(/^C:\\Users\\Ben\\Lazunox\\Chats\\\d{8}-[0-9a-f]{6}$/)
    expect(m.isApproved(f.path)).toBe(true)
    expect(m.listFolders().find((x) => x.path === f.path)?.chat).toBe(true)
    expect(m.isApproved(f.path.toUpperCase())).toBe(true) // sin distinguir mayúsculas
  })

  it('rechaza si un ancestro (Lazunox) es junction o symlink, y no crea nada', async () => {
    disk.add(`${HOME}\\Lazunox`)
    disk.links.add(disk.key(`${HOME}\\Lazunox`))
    disk.dirs.delete(disk.key(`${HOME}\\Lazunox`))
    await expect(mk().createChatFolder()).rejects.toThrow(t('merr.chat.folderUnsafe'))
    expect(disk.dirs.has(disk.key(chats))).toBe(false)
  })

  it('rechaza si Chats es enlace y si el perfil mismo es enlace', async () => {
    disk.add(`${HOME}\\Lazunox`)
    disk.links.add(disk.key(chats))
    await expect(mk().createChatFolder()).rejects.toThrow(t('merr.chat.folderUnsafe'))
    disk.links.delete(disk.key(chats))
    disk.dirs.delete(disk.key(HOME))
    disk.links.add(disk.key(HOME))
    await expect(mk().createChatFolder()).rejects.toThrow(t('merr.chat.folderUnsafe'))
  })

  it('rechaza si el realpath de Chats sale de Chats (carrera o redirección)', async () => {
    disk.add(`${HOME}\\Lazunox`)
    disk.add(chats)
    disk.real.set(disk.key(chats), 'C:\\lzx\\otro')
    await expect(mk().createChatFolder()).rejects.toThrow(t('merr.chat.folderUnsafe'))
  })

  it('el mensaje de error no incluye rutas completas', async () => {
    disk.add(`${HOME}\\Lazunox`)
    disk.links.add(disk.key(chats))
    await expect(mk().createChatFolder()).rejects.not.toThrow(/Users/)
  })

  it('con la bandera apagada nada cambia: lanza «apagado» y no toca el disco', async () => {
    delete process.env[UNIFIED_APPS_ENV]
    const m = mk()
    await expect(m.createChatFolder()).rejects.toThrow(t('merr.chat.unifiedOff'))
    expect(disk.dirs.has(disk.key(`${HOME}\\Lazunox`))).toBe(false)
    expect(m.pruneEmptyChatFolders(Date.now() + 9 * DAY)).toEqual([])
    expect(m.listChatIndex()).toEqual([])
    await m.refreshPolicy()
    expect(m.checkFolder('C:\\lzx').ok).toBe(true)
  })
})

describe('Windows sin la segunda variable', () => {
  it('solo LAZUNOX_UNIFIED_APPS=1 en win32: modo unificado apagado', async () => {
    delete process.env[UNIFIED_APPS_WIN_ENV]
    await expect(mk().createChatFolder()).rejects.toThrow(t('merr.chat.unifiedOff'))
  })
})

describe('chatsContainerReason en win32', () => {
  it('rechaza Lazunox y Chats (con otras mayúsculas y / ) y acepta una carpeta normal', async () => {
    const m = mk()
    await m.refreshPolicy()
    await m.createChatFolder() // deja Lazunox y Chats existentes
    const bad = t('merr.chat.containsChats')
    expect(m.checkFolder(`${HOME}\\Lazunox`)).toMatchObject({ ok: false, reason: bad })
    expect(m.checkFolder(chats)).toMatchObject({ ok: false, reason: bad })
    expect(m.checkFolder('c:/users/ben/lazunox/chats')).toMatchObject({ ok: false, reason: bad })
    expect(() => m.approveFolder(`${HOME}\\LAZUNOX`)).toThrow(bad)
    expect(m.checkFolder('C:\\lzx').ok).toBe(true)
  })

  it('rechaza Lazunox aunque Chats aún no exista (ruta léxica)', async () => {
    disk.add(`${HOME}\\Lazunox`)
    const m = mk()
    await m.refreshPolicy()
    expect(m.checkFolder(`${HOME}\\Lazunox`)).toMatchObject({ ok: false, reason: t('merr.chat.containsChats') })
  })
})

describe('pruneEmptyChatFolders en win32', () => {
  it('borra la vacía y antigua (rmdir) y deja la que tiene contenido', async () => {
    const m = mk()
    const a = await m.createChatFolder()
    const b = await m.createChatFolder()
    disk.add(`${b.path}\\nota.txt`)
    const removed = m.pruneEmptyChatFolders(Date.now() + 9 * DAY)
    expect(removed).toHaveLength(1)
    expect(disk.dirs.has(disk.key(a.path))).toBe(false)
    expect(disk.dirs.has(disk.key(b.path))).toBe(true)
    expect(m.isApproved(a.path)).toBe(false)
  })

  it('deja la reciente y la que tiene entrada en el índice', async () => {
    const m = mk()
    const a = await m.createChatFolder()
    expect(m.pruneEmptyChatFolders()).toEqual([])
    m.upsertChatIndex({ folder: a.path, sessionId: 's1', title: 'x', updatedAt: Date.now() })
    expect(m.pruneEmptyChatFolders(Date.now() + 9 * DAY)).toEqual([])
    expect(disk.dirs.has(disk.key(a.path))).toBe(true)
  })

  it('no borra si la carpeta pasó a ser un enlace', async () => {
    const m = mk()
    const a = await m.createChatFolder()
    disk.dirs.delete(disk.key(a.path))
    disk.links.add(disk.key(a.path))
    expect(m.pruneEmptyChatFolders(Date.now() + 9 * DAY)).toEqual([])
  })
})

describe('índice de chats en win32', () => {
  it('upsert y list con rutas Windows; rechaza carpetas no reconocidas', async () => {
    const m = mk()
    const a = await m.createChatFolder()
    m.upsertChatIndex({ folder: a.path, sessionId: 's1', title: 'Hola', updatedAt: 5 })
    expect(m.listChatIndex().map((e) => [e.folder, e.sessionId])).toEqual([[a.path, 's1']])
    expect(() => m.upsertChatIndex({ folder: 'C:\\lzx', sessionId: 's2', title: 'x', updatedAt: 1 })).toThrow(t('merr.chat.indexFolder'))
    disk.dirs.delete(disk.key(a.path)) // la carpeta ya no existe: sale del listado
    expect(m.listChatIndex()).toEqual([])
  })
})
