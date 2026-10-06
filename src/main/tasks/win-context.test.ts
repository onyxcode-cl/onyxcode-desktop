/**
 * Contexto de Windows de la política de carpetas (`win-context.ts`): falla cerrado sin unidades, con unidades caducadas o con
 * variables esenciales ausentes; arma `extraDenied` con la instalación de Lazunox y la distro; el probe de enlaces falla cerrado.
 */
import { describe, expect, it } from 'vitest'
import { forbiddenWinFolderReason, type WinDrive } from './folder-policy-win'
import { createWinHost, WIN_CONTEXT_MAX_AGE_MS, type WinHostDeps } from './win-context'

const ENV = {
  USERPROFILE: 'C:\\Users\\Ben',
  SystemRoot: 'C:\\Windows',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  APPDATA: 'C:\\Users\\Ben\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Ben\\AppData\\Local'
}
const DRIVES: WinDrive[] = [
  { letter: 'C', kind: 'fixed' },
  { letter: 'D', kind: 'fixed' }
]
let clock = 1_000_000
function host(over: Partial<WinHostDeps> = {}) {
  return createWinHost({
    env: ENV,
    userData: 'C:\\Users\\Ben\\AppData\\Roaming\\Lazunox',
    execPath: 'D:\\Apps\\Lazunox\\Lazunox.exe',
    readDrives: async () => DRIVES,
    now: () => clock,
    fs: {
      lstat: (p) => {
        if (p.toLowerCase() === 'd:\\proy\\j') return { isSymbolicLink: () => true }
        if (p.toLowerCase() === 'd:\\proy') return { isSymbolicLink: () => false }
        const e = new Error('no existe') as NodeJS.ErrnoException
        e.code = 'ENOENT'
        throw e
      },
      readdir: (p) => (p.toLowerCase() === 'd:\\proy\\con-enlace' ? [{ name: 'j', isSymbolicLink: true, isDirectory: true }] : []),
      realpath: (p) => p,
      isDirectory: () => true
    },
    ...over
  })
}

describe('createWinHost', () => {
  it('sin refresh() no hay contexto (cierra): la política rechaza todo', () => {
    expect(host().context()).toBeUndefined()
  })
  it('con unidades leídas arma el contexto con instalación y distro vetadas', async () => {
    const h = host()
    await h.refresh()
    const c = h.context(['D:\\Proy'])!
    expect(c.userProfile).toBe('C:\\Users\\Ben')
    expect(c.programFiles).toEqual(['C:\\Program Files', 'C:\\Program Files (x86)'])
    expect(c.drives).toEqual(DRIVES)
    expect(c.allowedRoots).toEqual(['D:\\Proy'])
    expect(c.extraDenied).toEqual(['D:\\Apps\\Lazunox', 'C:\\Users\\Ben\\AppData\\Local\\Lazunox\\wsl'])
    expect(forbiddenWinFolderReason('D:\\Apps\\Lazunox\\resources', c)).not.toBeNull()
    expect(forbiddenWinFolderReason('D:\\Proy\\a', c)).toBeNull()
  })
  it('las unidades caducan: pasados 120 s sin releer, cierra', async () => {
    const h = host()
    await h.refresh()
    expect(h.context()).toBeDefined()
    clock += WIN_CONTEXT_MAX_AGE_MS + 1
    expect(h.context()).toBeUndefined()
    await h.refresh()
    expect(h.context()).toBeDefined()
  })
  it('si leer las unidades falla o devuelve null, cierra (y no resucita una lectura vieja)', async () => {
    let n = 0
    const h = host({
      readDrives: async () => {
        if (n++ === 0) return DRIVES
        throw new Error('powershell')
      }
    })
    await h.refresh()
    expect(h.context()).toBeDefined()
    await h.refresh()
    expect(h.context()).toBeUndefined()
    const h2 = host({ readDrives: async () => null })
    await h2.refresh()
    expect(h2.context()).toBeUndefined()
  })
  it.each(['USERPROFILE', 'SystemRoot', 'ProgramData', 'LOCALAPPDATA'])('sin %s cierra', async (k) => {
    const env: Record<string, string | undefined> = { ...ENV }
    delete env[k]
    const h = host({ env })
    await h.refresh()
    expect(h.context()).toBeUndefined()
  })
  it('una %LOCALAPPDATA% rara (UNC, con comillas) cierra', async () => {
    for (const bad of ['\\\\srv\\x', 'C:\\a"b', 'rel']) {
      const h = host({ env: { ...ENV, LOCALAPPDATA: bad } })
      await h.refresh()
      expect(h.context(), bad).toBeUndefined()
    }
  })
  it('las variables se leen sin distinguir mayúsculas (env copiado en minúsculas)', async () => {
    const env = Object.fromEntries(Object.entries(ENV).map(([k, v]) => [k.toLowerCase(), v]))
    const h = host({ env })
    await h.refresh()
    expect(h.context()?.userProfile).toBe('C:\\Users\\Ben')
  })
  it('realpath no toca unidades de red ni se usa antes de leer las unidades (evita abrir SMB para juzgar la ruta)', async () => {
    const seen: string[] = []
    const h = host({
      readDrives: async () => [
        { letter: 'C', kind: 'fixed' },
        { letter: 'Z', kind: 'network' },
        { letter: 'E', kind: 'removable' }
      ],
      fs: {
        lstat: () => ({ isSymbolicLink: () => false }),
        readdir: () => [],
        realpath: (p) => (seen.push(p), p),
        isDirectory: () => true
      }
    })
    expect(() => h.realpath('C:\\x')).toThrow() // aún sin unidades
    await h.refresh()
    expect(h.realpath('c:\\x')).toBe('c:\\x')
    for (const bad of ['Z:\\x', 'E:\\x', 'Q:\\x', '\\\\srv\\x']) expect(() => h.realpath(bad), bad).toThrow()
    expect(seen).toEqual(['c:\\x'])
  })
  it('enlaces reales: lstat ENOENT es «no existe»; un enlace dentro de la carpeta la rechaza; otros errores lanzan (cierra)', async () => {
    const h = host()
    await h.refresh()
    const c = h.context()!
    expect(c.links!.lstat('D:\\Proy\\nada')).toBeNull()
    expect(c.links!.lstat('D:\\Proy\\j')!.isSymbolicLink()).toBe(true)
    expect(forbiddenWinFolderReason('D:\\Proy\\con-enlace', c)).not.toBeNull()
    expect(forbiddenWinFolderReason('D:\\Proy\\j', c)).not.toBeNull()
    const boom = host({
      fs: {
        lstat: () => {
          const e = new Error('denegado') as NodeJS.ErrnoException
          e.code = 'EACCES'
          throw e
        },
        readdir: () => [],
        realpath: (p) => p,
        isDirectory: () => true
      }
    })
    await boom.refresh()
    expect(forbiddenWinFolderReason('D:\\Proy\\x', boom.context()!)).not.toBeNull()
  })
})
