/**
 * Política de carpetas de Tareas en Windows (W3): tabla de zonas INTOCABLES con plataforma inyectada.
 * Corre en macOS; lo que depende de Windows real (unidades de red, `subst`, junctions) se prueba con dobles y
 * se repite en el PC (A19). `t` se sustituye para comparar la CLAVE del rechazo, no el texto.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@shared/i18n', () => ({ t: (k: string): string => k }))

import { forbiddenFolderReason } from './folder-policy'
import {
  forbiddenWinFolderReason,
  LINK_SCAN_MAX_DEPTH,
  LINK_SCAN_MAX_ENTRIES,
  type WinDirEntry,
  type WinFolderPolicyContext,
  type WinLinkProbe
} from './folder-policy-win'
import { ctx, fakeDisk, P } from './__fixtures__/folder-policy-win.fixture'

const why = (folder: string, over: Partial<WinFolderPolicyContext> = {}): string | null => forbiddenWinFolderReason(folder, ctx(over))

describe('carpetas válidas', () => {
  it.each([
    'C:\\lzx\\tareas\\a',
    `${P}\\Documents\\proyecto`,
    `${P}\\Desktop\\x`,
    `${P}\\Downloads\\y`,
    'D:\\Datos\\2026',
    'c:/lzx/tareas/b',
    '/win/c/lzx/tareas/a',
    `${P}\\OneDrive\\Trabajo`,
    'C:\\Mis Documentos\\año 2026\\Ñandú',
    'D:\\Programas propios\\x'
  ])('aprueba %s', (f) => expect(why(f)).toBeNull())
})

describe('rutas inválidas o ambiguas: antes de la lista', () => {
  it.each([
    ['\\\\srv\\share\\x', 'merr.folder.winNetwork'],
    ['//srv/share/x', 'merr.folder.winNetwork'],
    ['\\\\192.168.1.101\\x', 'merr.folder.winNetwork'],
    ['\\\\wsl.localhost\\Debian\\etc', 'merr.folder.winNetwork'],
    ['\\\\?\\C:\\lzx\\a', 'merr.folder.winNetwork'],
    ['\\\\?\\UNC\\srv\\x', 'merr.folder.winNetwork'],
    ['\\\\.\\PhysicalDrive0', 'merr.folder.winNetwork'],
    ['C:\\PROGRA~1', 'merr.folder.winBadPath'],
    ['C:\\lzx\\a\\..\\..\\Windows', 'merr.folder.winBadPath'],
    ['C:\\lzx\\a:oculto', 'merr.folder.winBadPath'],
    ['C:\\lzx\\NUL', 'merr.folder.winBadPath'],
    ['C:\\lzx\\a.', 'merr.folder.winBadPath'],
    ['lzx\\a', 'merr.folder.winBadPath'],
    ['C:lzx', 'merr.folder.winBadPath'],
    ['', 'merr.folder.winBadPath']
  ])('%s', (f, key) => expect(why(f)).toBe(key))
  it('un valor que no es cadena falla cerrado', () => {
    expect(forbiddenWinFolderReason(undefined as unknown as string, ctx())).not.toBeNull()
    expect(forbiddenWinFolderReason(42 as unknown as string, ctx())).not.toBeNull()
  })
})

describe('raíces de unidad y carpetas del sistema', () => {
  it.each(['C:\\', 'C:/', 'D:\\', 'd:', 'C:\\\\'])('raíz %s', (f) => expect(why(f)).not.toBeNull())
  it('raíz con motivo propio', () => expect(why('D:\\')).toBe('merr.folder.winDriveRoot'))
  it.each([
    'C:\\Windows',
    'C:\\Windows\\System32',
    'c:\\WINDOWS\\system32\\drivers',
    'C:\\Program Files',
    'C:\\Program Files\\Lazunox',
    'C:\\Program Files (x86)\\x',
    'C:\\ProgramData',
    'C:\\ProgramData\\Lazunox',
    'C:\\System Volume Information',
    'D:\\System Volume Information\\x',
    'D:\\Windows',
    'D:\\Program Files\\x',
    'D:\\ProgramData\\x',
    'C:\\Recovery',
    'C:\\Boot',
    'C:\\Documents and Settings',
    'C:\\Windows.old\\x'
  ])('sistema %s', (f) => expect(why(f)).toBe('merr.folder.system'))
  it.each(['C:\\$Recycle.Bin', 'C:\\$Recycle.Bin\\S-1-5-21-1\\x', 'D:\\$RECYCLE.BIN'])('papelera %s', (f) =>
    expect(why(f)).toBe('merr.folder.trash')
  )
  it('una instalación movida (ProgramFiles / SystemRoot fuera de C:) también se veta', () => {
    const c = { systemRoot: 'D:\\WinNT', programFiles: ['D:\\Apps'], programData: 'D:\\PD' }
    expect(why('D:\\WinNT\\x', c)).toBe('merr.folder.system')
    expect(why('D:\\Apps\\x', c)).toBe('merr.folder.system')
    expect(why('D:\\PD\\x', c)).toBe('merr.folder.system')
  })
})

describe('perfil de usuario', () => {
  it('la carpeta personal completa y lo que la contiene', () => {
    expect(why(P)).toBe('merr.folder.rootOrHome')
    expect(why(`${P}\\`)).toBe('merr.folder.rootOrHome')
    expect(why('c:/users/ben')).toBe('merr.folder.rootOrHome')
    expect(why('C:\\Users')).toBe('merr.folder.containsHome')
    expect(why('C:\\')).not.toBeNull()
  })
  it('otros usuarios, Public, Default y All Users', () => {
    for (const f of [
      'C:\\Users\\Ana',
      'C:\\Users\\Ana\\Documents',
      'C:\\Users\\Public',
      'C:\\Users\\Public\\Documents',
      'C:\\Users\\Default',
      'C:\\Users\\All Users',
      'D:\\Users\\x'
    ]) {
      expect(why(f)).toBe('merr.folder.winOtherUsers')
    }
  })
  it('perfil fuera de C:\\Users (D:\\Perfiles): igual', () => {
    const c = { userProfile: 'D:\\Perfiles\\Ben', userData: 'D:\\Perfiles\\Ben\\AppData\\Roaming\\Lazunox' }
    expect(why('D:\\Perfiles\\Ana\\x', c)).toBe('merr.folder.winOtherUsers')
    expect(why('D:\\Perfiles\\Ben\\Documents\\x', c)).toBeNull()
    expect(why('D:\\Perfiles', c)).toBe('merr.folder.containsHome')
  })
  it.each([
    `${P}\\AppData`,
    `${P}\\AppData\\Roaming`,
    `${P}\\AppData\\Local`,
    `${P}\\AppData\\Local\\Google\\Chrome\\User Data`,
    `${P}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default`,
    `${P}\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\x.default`,
    `${P}\\AppData\\Roaming\\gnupg`,
    `${P}\\AppData\\Local\\Temp`,
    `${P}\\AppData\\LocalLow\\x`,
    `${P}\\appdata\\local`
  ])('AppData %s', (f) => expect(why(f)).toBe('merr.folder.winAppData'))
  it('%APPDATA% y %LOCALAPPDATA% reubicados', () => {
    const c = { appData: 'D:\\Roam', localAppData: 'D:\\Loc' }
    expect(why('D:\\Roam\\x', c)).toBe('merr.folder.winAppData')
    expect(why('D:\\Loc\\Google\\Chrome', c)).toBe('merr.folder.winAppData')
  })
  it.each([
    '.ssh',
    '.ssh\\keys',
    '.gnupg',
    '.gpg',
    '.aws',
    '.azure',
    '.kube',
    '.docker',
    '.config\\gcloud',
    '.config\\gh',
    '.local\\share\\opencode',
    '.claude',
    '.git-credentials',
    '.npmrc'
  ])('secretos ~\\%s', (rel) => expect(why(`${P}\\${rel}`)).toBe('merr.folder.secrets'))
  it('una carpeta que CONTIENE un secreto también (`~\\.config`, `~\\.local`, `~\\.local\\share`)', () => {
    for (const rel of ['.config', '.local', '.local\\share', '.cargo']) {
      // Ancestro de una zona vetada: o es la zona o la contiene.
      const r = why(`${P}\\${rel}`)
      if (rel === '.cargo') expect(r).toBe('merr.folder.secrets')
      else expect(r).toBe('merr.folder.secrets')
    }
  })
  it('carpetas heredadas de Windows (junctions de compatibilidad)', () => {
    for (const n of ['Application Data', 'Local Settings', 'Cookies', 'NetHood', 'Start Menu', 'SendTo', 'Recent', 'Templates']) {
      expect(why(`${P}\\${n}`)).toBe('merr.folder.secrets')
    }
  })
  it('una carpeta cuyo nombre se parece a un secreto NO se veta', () => {
    expect(why(`${P}\\Documents\\.ssh-notes`)).toBeNull()
    expect(why(`${P}\\.sshx`)).toBeNull()
    expect(why(`${P}\\appdata2`)).toBeNull()
  })
})

describe('datos de Lazunox y rutas extra', () => {
  it('userData, su padre y sus hijos', () => {
    expect(why(`${P}\\AppData\\Roaming\\Lazunox`)).not.toBeNull()
    expect(why(`${P}\\AppData\\Roaming\\Lazunox\\sandbox\\x`)).not.toBeNull()
  })
  it('userData fuera de AppData (portable) y la distro WSL de Tareas', () => {
    const c = { userData: 'D:\\Lazunox\\datos', extraDenied: ['D:\\Lazunox\\wsl', 'C:\\Program Files\\Lazunox'] }
    expect(why('D:\\Lazunox\\datos', c)).toBe('merr.folder.appState')
    expect(why('D:\\Lazunox\\datos\\x', c)).toBe('merr.folder.appState')
    expect(why('D:\\Lazunox\\wsl\\ext4', c)).toBe('merr.folder.appState')
    // la carpeta que CONTIENE la distro tampoco
    expect(why('D:\\Lazunox', c)).toBe('merr.folder.appState')
    expect(why('D:\\Otro', c)).toBeNull()
  })
  it('una ruta extra ilegible rompe el contexto: se rechaza todo', () => {
    expect(why('C:\\lzx\\a', { extraDenied: ['relativa'] })).toBe('merr.folder.winContext')
  })
  it.each([[{ userProfile: '' }], [{ systemRoot: 'Windows' }], [{ programData: '' }], [{ userData: '\\\\srv\\x' }]])(
    'contexto esencial roto %j: se rechaza todo',
    (over) => {
      expect(why('C:\\lzx\\a', over as Partial<WinFolderPolicyContext>)).toBe('merr.folder.winContext')
    }
  )
})

describe('unidades', () => {
  it('unidad de red mapeada, extraíble, óptica, RAM y desconocida', () => {
    expect(why('Z:\\x')).toBe('merr.folder.winNetwork')
    expect(why('E:\\x')).toBe('merr.folder.winDriveType')
    expect(why('X:\\x')).toBe('merr.folder.winDriveType')
    const c = {
      drives: [
        { letter: 'C', kind: 'fixed' as const },
        { letter: 'F', kind: 'optical' as const },
        { letter: 'G', kind: 'ram' as const },
        { letter: 'H', kind: 'unknown' as const }
      ]
    }
    for (const l of 'FGH') expect(why(`${l}:\\x`, c)).toBe('merr.folder.winDriveType')
  })
  it('alias subst: se rechaza aunque figure como fijo', () => {
    expect(why('X:\\lzx', { substDrives: ['x'], drives: [{ letter: 'X', kind: 'fixed' }] })).toBe('merr.folder.winSubst')
    expect(why('C:\\lzx', { substDrives: ['X'] })).toBeNull()
  })
  it('si no se pudo leer la lista de unidades: NADA se aprueba, ni siquiera una carpeta normal', () => {
    expect(why('C:\\lzx\\a', { drives: null })).toBe('merr.folder.winDrivesUnknown')
    expect(why('D:\\x', { drives: null })).toBe('merr.folder.winDrivesUnknown')
    expect(why('C:\\lzx\\a', { drives: undefined as unknown as null })).toBe('merr.folder.winDrivesUnknown')
  })
  it('la letra de unidad no distingue mayúsculas', () => {
    expect(why('d:\\Windows')).toBe('merr.folder.system')
    expect(why('z:\\x')).toBe('merr.folder.winNetwork')
  })
})

describe('enlaces simbólicos y junctions (D3 estricta)', () => {
  it('un ancestro que es junction se rechaza', () => {
    const links = fakeDisk({}, ['C:\\lzx\\tareas'])
    expect(why('C:\\lzx\\tareas\\a', { links })).toBe('merr.folder.winLink')
  })
  it('la propia carpeta es junction', () => {
    expect(why('C:\\lzx\\tareas\\a\\j', { links: fakeDisk({}, ['C:\\lzx\\tareas\\a\\j']) })).toBe('merr.folder.winLink')
  })
  it('una carpeta que CONTIENE una junction (a otra aprobada o a cualquier sitio) se rechaza', () => {
    const links = fakeDisk(
      {
        'c:\\lzx\\tareas\\a': [
          { name: 'j', isSymbolicLink: true, isDirectory: true },
          { name: 'ok', isSymbolicLink: false, isDirectory: true }
        ]
      },
      []
    )
    expect(why('C:\\lzx\\tareas\\a', { links })).toBe('merr.folder.winLink')
  })
  it('un enlace en un subdirectorio profundo también', () => {
    const links = fakeDisk({
      'c:\\w': [{ name: 'a', isSymbolicLink: false, isDirectory: true }],
      'c:\\w\\a': [{ name: 'b', isSymbolicLink: false, isDirectory: true }],
      'c:\\w\\a\\b': [{ name: 'evil', isSymbolicLink: true, isDirectory: false }]
    })
    expect(why('C:\\w', { links })).toBe('merr.folder.winLink')
  })
  it('sin sondeo de disco no se puede verificar: se rechaza', () => {
    expect(why('C:\\lzx\\a', { links: undefined })).toBe('merr.folder.winLinkUnverified')
  })
  it('error de lectura: se rechaza', () => {
    const links: WinLinkProbe = {
      lstat: () => null,
      readdir: () => {
        throw new Error('EPERM')
      }
    }
    expect(why('C:\\lzx\\a', { links })).toBe('merr.folder.winLinkUnverified')
  })
  it('error de lstat en un ancestro: se rechaza (checkNoLinks falla cerrado)', () => {
    const links: WinLinkProbe = {
      lstat: () => {
        throw new Error('EACCES')
      },
      readdir: () => []
    }
    expect(why('C:\\lzx\\a', { links })).toBe('merr.folder.winLink')
  })
  it('demasiadas entradas o demasiada profundidad: no verificable, se rechaza', () => {
    const many: WinDirEntry[] = Array.from({ length: LINK_SCAN_MAX_ENTRIES + 1 }, (_, i) => ({
      name: `f${i}`,
      isSymbolicLink: false,
      isDirectory: false
    }))
    expect(why('C:\\big', { links: fakeDisk({ 'c:\\big': many }) })).toBe('merr.folder.winLinkUnverified')
    const dirs: Record<string, WinDirEntry[]> = {}
    let cur = 'c:\\deep'
    for (let i = 0; i <= LINK_SCAN_MAX_DEPTH + 1; i++) {
      dirs[cur] = [{ name: 'd', isSymbolicLink: false, isDirectory: true }]
      cur += '\\d'
    }
    expect(why('C:\\deep', { links: fakeDisk(dirs) })).toBe('merr.folder.winLinkUnverified')
  })
  it('una carpeta con subcarpetas normales pasa', () => {
    const links = fakeDisk({
      'c:\\w': [
        { name: 'src', isSymbolicLink: false, isDirectory: true },
        { name: 'a.txt', isSymbolicLink: false, isDirectory: false }
      ]
    })
    expect(why('C:\\w', { links })).toBeNull()
  })
})

describe('política de la organización (allowedFolderRoots)', () => {
  it('restringe a las raíces permitidas', () => {
    expect(why('D:\\Datos\\a', { allowedRoots: ['D:\\Datos'] })).toBeNull()
    expect(why('d:/datos/a', { allowedRoots: ['D:\\Datos\\'] })).toBeNull()
    expect(why('C:\\lzx\\a', { allowedRoots: ['D:\\Datos'] })).toBe('merr.folder.orgRoots')
    expect(why('D:\\Datos2\\a', { allowedRoots: ['D:\\Datos'] })).toBe('merr.folder.orgRoots')
  })
  it('lista vacía: nada', () => {
    expect(why('C:\\lzx\\a', { allowedRoots: [] })).toBe('merr.folder.orgNone')
  })
  it('NUNCA abre una zona vetada: una raíz permitida que es C:\\Windows o el perfil no ayuda', () => {
    expect(why('C:\\Windows\\x', { allowedRoots: ['C:\\Windows'] })).toBe('merr.folder.system')
    expect(why(`${P}\\.ssh`, { allowedRoots: [P] })).toBe('merr.folder.secrets')
    expect(why(`${P}\\AppData\\Local`, { allowedRoots: ['C:\\'] })).toBe('merr.folder.winAppData')
    expect(why('D:\\', { allowedRoots: ['D:\\'] })).toBe('merr.folder.winDriveRoot')
  })
  it('raíces ilegibles o UNC no abren nada (quedan como lista vacía)', () => {
    expect(why('C:\\lzx\\a', { allowedRoots: ['\\\\srv\\x', 'relativa'] })).toBe('merr.folder.orgNone')
  })
})

describe('mayúsculas y separadores', () => {
  it.each([
    'c:\\WINDOWS',
    'C:/Windows/System32',
    'C:\\\\Windows',
    'C:\\Windows\\',
    'C:\\WiNdOwS\\.\\System32',
    'c:\\program files',
    'C:\\PROGRAM FILES (X86)\\x',
    'C:\\programdata',
    `C:\\USERS\\BEN\\APPDATA\\LOCAL`,
    'c:/users/ben/.SSH',
    '/win/c/Windows',
    '/win/c/Users/Ben/.ssh',
    '/win/c/Users/Ben/AppData/Local'
  ])('no hay forma de colarlo: %s', (f) => expect(why(f)).not.toBeNull())
  it('equivalencias de plegado de mayúsculas de NTFS (ı, ſ, K): rechaza de más, nunca de menos', () => {
    // `Program Fıles` (i sin punto) podría ser el mismo directorio que `Program Files` según la tabla de NTFS.
    expect(why('C:\\Program F\u0131les')).toBe('merr.folder.system')
    expect(why('C:\\Windows\\Syst\u0065m32')).toBe('merr.folder.system')
    expect(why(`${P}\\AppData\\Local\\Googl\u0065`)).toBe('merr.folder.winAppData')
    expect(why(`${P}\\.s\u017Fh`)).toBe('merr.folder.secrets')
  })
})

describe('despacho por plataforma de folder-policy.ts', () => {
  const base = { home: '/Users/ben', userData: '/Users/ben/Library/Application Support/Lazunox', mounts: [] }
  it('win32 sin contexto de Windows: se rechaza todo (falla cerrado)', () => {
    expect(forbiddenFolderReason('C:\\lzx\\a', base, 'win32')).toBe('merr.folder.winContext')
    expect(forbiddenFolderReason('/Users/ben/Docs', base, 'win32')).toBe('merr.folder.winContext')
  })
  it('win32 con contexto: usa la política de Windows y hereda allowedRoots del contexto general', () => {
    expect(forbiddenFolderReason('C:\\lzx\\a', { ...base, win: ctx() }, 'win32')).toBeNull()
    expect(forbiddenFolderReason('C:\\Windows', { ...base, win: ctx() }, 'win32')).toBe('merr.folder.system')
    expect(forbiddenFolderReason('C:\\lzx\\a', { ...base, win: ctx(), allowedRoots: ['D:\\x'] }, 'win32')).toBe('merr.folder.orgRoots')
  })
  it('darwin y linux conservan la política de macOS sin cambios', () => {
    for (const p of ['darwin', 'linux'] as const) {
      expect(forbiddenFolderReason('/', base, p)).toBe('merr.folder.rootOrHome')
      expect(forbiddenFolderReason('/System/x', base, p)).toBe('merr.folder.system')
      expect(forbiddenFolderReason('/Users/ben/Docs/x', base, p)).toBeNull()
      // una ruta de Windows no es especial para la política de macOS
      expect(forbiddenFolderReason('C:\\Windows', { ...base, win: ctx() }, p)).toBeNull()
    }
  })
})
