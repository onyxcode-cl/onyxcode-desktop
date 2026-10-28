/** Modo unificado: carpeta propia de un chat sin carpeta elegida (`~/Lazunox/Chats/<id>`). */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
const pol = vi.hoisted(() => ({ value: null as { allowedFolderRoots?: string[] } | null, computerOff: false }))
// Ganchos para simular carreras y dueños ajenos en el punto exacto.
const hook = vi.hoisted(() => ({
  onRealpath: null as ((p: string) => void) | null,
  fakeUid: new Map<string, number>(),
  chmodCalls: 0
}))

vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    realpathSync: Object.assign(
      (p: string, o?: never) => {
        hook.onRealpath?.(String(p))
        return real.realpathSync(p, o)
      },
      { native: real.realpathSync.native }
    ),
    lstatSync: (p: string, o?: never) => {
      const st = real.lstatSync(p, o) as import('node:fs').Stats
      const uid = hook.fakeUid.get(String(p))
      return uid === undefined
        ? st
        : Object.assign(Object.create(st), { uid, isDirectory: () => st.isDirectory(), isSymbolicLink: () => st.isSymbolicLink() })
    },
    chmodSync: (...a: Parameters<typeof real.chmodSync>) => {
      hook.chmodCalls++
      return real.chmodSync(...a)
    }
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null, revokeToken: () => undefined }
}))
vi.mock('./policy', () => ({
  loadManagedPolicy: () => pol.value,
  isComputerUseDisabled: () => pol.computerOff
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
  pol.computerOff = false
  hook.onRealpath = null
  hook.fakeUid.clear()
  hook.chmodCalls = 0
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

  it('una carpeta de chat que ya no existe en disco no se lista (no se restaura como «última carpeta»)', async () => {
    const m = new TasksManager()
    const f = await m.createChatFolder()
    expect(m.listFolders().map((x) => x.path)).toContain(f.path)
    rmSync(f.path, { recursive: true })
    expect(m.listFolders().map((x) => x.path)).not.toContain(f.path)
    // una carpeta del usuario aprobada y luego borrada NO se oculta (solo las de chat registradas)
    const mine = join(root, 'mia')
    mkdirSync(mine)
    m.approveFolder(mine)
    rmSync(mine, { recursive: true })
    expect(m.listFolders().some((x) => x.path.endsWith('mia'))).toBe(true)
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

  it('carrera: Chats pasa a ser un enlace después de la comprobación: se rechaza y no queda nada', async () => {
    const target = join(root, 'elsewhere')
    mkdirSync(target)
    const chats = join(home, 'Lazunox', 'Chats')
    let swapped = false
    hook.onRealpath = (p) => {
      // Solo cuando Chats ya existe (después del lstat): la consulta previa de la política ocurre con la carpeta aún sin crear.
      if (swapped || p !== chats || !existsSync(chats)) return
      swapped = true
      rmSync(chats, { recursive: true })
      symlinkSync(target, chats)
    }
    await expect(new TasksManager().createChatFolder()).rejects.toThrow(/enlace/)
    expect(swapped).toBe(true)
    expect(readdirSync(target)).toEqual([])
  })

  it('carrera: la carpeta nueva acaba fuera de la ruta esperada: se rechaza y se borra la recién creada', async () => {
    const m = new TasksManager()
    const chats = join(realpathSync(home), 'Lazunox', 'Chats')
    let created = ''
    hook.onRealpath = (p) => {
      if (p.startsWith(chats + '/')) {
        created = p
        throw new Error('simulado')
      }
    }
    await expect(m.createChatFolder()).rejects.toThrow('simulado')
    expect(created).not.toBe('')
    expect(existsSync(created)).toBe(false)
    expect(readdirSync(chats)).toEqual([])
    expect(m.listFolders()).toEqual([])
  })

  it('~/Lazunox existente con permisos abiertos (0777): rechaza y no crea Chats', async () => {
    mkdirSync(join(home, 'Lazunox'))
    chmodSync(join(home, 'Lazunox'), 0o777)
    await expect(new TasksManager().createChatFolder()).rejects.toThrow(/enlace/)
    expect(existsSync(join(home, 'Lazunox', 'Chats'))).toBe(false)
  })

  it('~/Lazunox/Chats existente con escritura para el grupo (0770): rechaza', async () => {
    mkdirSync(join(home, 'Lazunox', 'Chats'), { recursive: true })
    chmodSync(join(home, 'Lazunox', 'Chats'), 0o770)
    await expect(new TasksManager().createChatFolder()).rejects.toThrow(/enlace/)
    expect(readdirSync(join(home, 'Lazunox', 'Chats'))).toEqual([])
  })

  it('~/Lazunox de otro dueño: rechaza', async () => {
    mkdirSync(join(home, 'Lazunox'), { mode: 0o700 })
    hook.fakeUid.set(join(home, 'Lazunox'), (process.getuid?.() ?? 0) + 1)
    await expect(new TasksManager().createChatFolder()).rejects.toThrow(/enlace/)
    expect(existsSync(join(home, 'Lazunox', 'Chats'))).toBe(false)
  })

  it('~/Lazunox/Chats de otro dueño: rechaza', async () => {
    mkdirSync(join(home, 'Lazunox', 'Chats'), { recursive: true, mode: 0o700 })
    hook.fakeUid.set(join(home, 'Lazunox', 'Chats'), (process.getuid?.() ?? 0) + 1)
    await expect(new TasksManager().createChatFolder()).rejects.toThrow(/enlace/)
    expect(readdirSync(join(home, 'Lazunox', 'Chats'))).toEqual([])
  })

  it('la política que apaga el control del PC: rechaza y no crea nada', async () => {
    pol.computerOff = true
    const m = new TasksManager()
    await expect(m.createChatFolder()).rejects.toThrow(/organizaci/)
    expect(existsSync(join(home, 'Lazunox'))).toBe(false)
    expect(m.listFolders()).toEqual([])
  })

  it('no usa chmod (sigue enlaces) y el modo 0700 sale solo de mkdir, con cualquier umask', async () => {
    const prev = process.umask(0o000)
    try {
      const f = await new TasksManager().createChatFolder()
      expect(statSync(f.path).mode & 0o777).toBe(0o700)
      expect(statSync(join(home, 'Lazunox')).mode & 0o777).toBe(0o700)
    } finally {
      process.umask(prev)
    }
    expect(hook.chmodCalls).toBe(0)
  })

  it('rechaza como carpeta de trabajo o extra Chats y sus ancestros (~/Lazunox); una carpeta de chat o ajena sí', async () => {
    const m = new TasksManager()
    const chat = (await m.createChatFolder()).path
    const chats = join(home, 'Lazunox', 'Chats')
    for (const bad of [chats, join(chat, '..'), join(home, 'Lazunox')]) {
      expect(m.checkFolder(bad).ok).toBe(false)
      expect(m.checkFolder(bad).reason).toContain('Chats')
      expect(() => m.approveFolder(bad)).toThrow(/Chats/)
    }
    expect(m.checkFolder(chat).ok).toBe(true)
    // Sin bandera la regla no existe (comportamiento de siempre).
    process.env[UNIFIED_APPS_ENV] = '0'
    expect(m.checkFolder(chats).reason ?? '').not.toContain('Lazunox/Chats')
  })

  it('listFolders marca chat:true solo en carpetas creadas por createChatFolder dentro de Chats', async () => {
    const m = new TasksManager()
    const chat = (await m.createChatFolder()).path
    const chats = join(realpathSync(home), 'Lazunox', 'Chats')
    // Parecidas por nombre o por forma, pero NO creadas por createChatFolder: aprobadas a mano.
    const lookalike = join(chats, '20240101-aaaaaa')
    mkdirSync(lookalike, { mode: 0o700 })
    const similar = join(realpathSync(home), 'Lazunox', 'Chats-x')
    mkdirSync(similar, { recursive: true })
    const outside = join(realpathSync(home), 'Proyecto')
    mkdirSync(outside)
    const link = join(chats, 'enlace')
    symlinkSync(outside, link)
    for (const p of [lookalike, similar, outside]) m.approveFolder(p)
    const byPath = new Map(m.listFolders().map((f) => [f.path, f]))
    expect(byPath.get(chat)?.chat).toBe(true)
    for (const p of [lookalike, similar, outside]) expect(byPath.get(p)?.chat).not.toBe(true)
    // Sobrevive al reinicio (registro en disco) y un enlace que apunte a Chats no cuenta.
    const again = new TasksManager()
    expect(again.listFolders().find((f) => f.path === chat)?.chat).toBe(true)
    expect(again.listFolders().find((f) => f.path === link)).toBeUndefined()
  })

  it('listFolders: el registro no basta si la carpeta pasó a ser un enlace fuera de Chats; sin bandera nunca hay chat', async () => {
    const m = new TasksManager()
    const chat = (await m.createChatFolder()).path
    process.env[UNIFIED_APPS_ENV] = '0'
    expect(m.listFolders().find((f) => f.path === chat)?.chat).toBeUndefined()
    process.env[UNIFIED_APPS_ENV] = '1'
    expect(m.listFolders().find((f) => f.path === chat)?.chat).toBe(true)
    const outside = join(root, 'fuera')
    mkdirSync(outside)
    rmSync(chat, { recursive: true })
    symlinkSync(outside, chat)
    expect(m.listFolders().find((f) => f.path === chat)?.chat).not.toBe(true)
  })

  it('sin bandera: rechaza y no crea nada', async () => {
    process.env[UNIFIED_APPS_ENV] = '0'
    await expect(new TasksManager().createChatFolder()).rejects.toThrow('apagado')
    expect(existsSync(join(home, 'Lazunox'))).toBe(false)
  })
})

describe('createChatFolder en Windows', () => {
  it('sin bandera rechaza y no toca el disco; con bandera la versión Windows está en manager.chatfolder.win.test.ts', async () => {
    process.env[UNIFIED_APPS_ENV] = '0'
    const win = { refresh: async () => undefined } as never
    const m = new TasksManager({ platform: 'win32', win })
    await expect(m.createChatFolder()).rejects.toThrow('apagado')
  })
})
