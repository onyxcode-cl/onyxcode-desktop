/**
 * BATERÍA A1–A20 contra la política de carpetas y el mapa de rutas de Tareas en Windows (W4, parte de macOS).
 *
 * Es el lado DEFENSIVO que sí se puede probar sin Windows: cada ataque se corre contra funciones puras con la
 * plataforma inyectada (`resolveUiPath`, `toSandboxPath`, `fromSandboxPath`, `checkNoLinks`, el mapa de rutas y
 * `forbiddenFolderReason`). Lo que exige un Windows/WSL real (montajes, Landlock, red, ciclo de vida…) NO se
 * simula: queda en `ATTACKS` como `pc` con su motivo y lo cubre `scripts/win/tasks-attack.ps1` en el PC.
 * `tasks-win-report.guard.test.ts` impide activar Tareas sin ese informe del PC: que esta batería pase en macOS
 * NO equivale a que el aislamiento de Windows funcione.
 */
import { afterAll, describe, expect, it } from 'vitest'
import attack from './__fixtures__/attack-paths.json'
import { ctx, fakeDisk, P } from './__fixtures__/folder-policy-win.fixture'
import { forbiddenFolderReason } from './folder-policy'
import { forbiddenWinFolderReason } from './folder-policy-win'
import { selectBackend, WinBackendUnavailable } from './backends'
import { isApprovedPath, resolveUiPath, type ApprovedData } from './ui-path'
import { resolveTasksWin } from './tasks-win-flag'
import { REQUIRED_ATTACK_IDS } from './tasks-win-report'
import { isInside, samePath } from '../util/paths'
import { capsFor } from '@shared/platform-caps'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { checkNoLinks, fromSandboxPath, toSandboxPath, winFromLinuxAbsolute, type PathMount } from '@shared/wsl-paths'
import { displayPath, IDENTITY_MAP, toHost, toSandbox, toSandboxOrNull, type PathMapWire } from '@shared/tasks-path-map'

type Coverage = 'mac' | 'partial' | 'pc'
interface AttackRow {
  id: (typeof REQUIRED_ATTACK_IDS)[number]
  title: string
  coverage: Coverage
  /** Qué queda sin probar en macOS (obligatorio si no es `mac`). */
  pending?: string
}

/** Qué ataques cubre esta batería en macOS y cuáles exigen el PC. Debe listar TODOS los de `REQUIRED_ATTACK_IDS`. */
export const ATTACKS: AttackRow[] = [
  {
    id: 'A1',
    title: 'lectura fuera de la carpeta (../victima, /win/c/lzx/tareas)',
    coverage: 'partial',
    pending: 'que /win/c/lzx/tareas no exista dentro de la VM (montajes reales)'
  },
  { id: 'A2', title: 'junction hacia la víctima', coverage: 'partial', pending: 'que drvfs no atraviese la junction (WSL real)' },
  { id: 'A3', title: 'symlink / hardlink NTFS', coverage: 'partial', pending: 'symlinks reales (Modo de desarrollador) y hardlink' },
  {
    id: 'A4',
    title: 'ln -s dentro y main sobre la junction',
    coverage: 'partial',
    pending: 'ln dentro de la VM, puntos de restauración sobre una junction real'
  },
  { id: 'A5', title: 'UNC, \\\\?\\, \\\\.\\, \\\\wsl.localhost', coverage: 'partial', pending: 'Get-SmbConnection antes y después' },
  { id: 'A6', title: 'flujos NTFS (ADS)', coverage: 'partial', pending: 'que drvfs no cree el ADS (echo > a.txt:oculto)' },
  {
    id: 'A6b',
    title: 'nombres reservados, 8.3, punto/espacio final',
    coverage: 'partial',
    pending: 'limpieza real con \\\\?\\ de lo que cree drvfs'
  },
  { id: 'A7', title: 'montajes visibles (mount, /mnt/c, /proc/mounts)', coverage: 'pc', pending: 'findmnt dentro de la VM' },
  { id: 'A7b', title: 'solo lo concedido es visible; ro no escribe', coverage: 'partial', pending: 'EROFS y los montajes reales' },
  { id: 'A8', title: 'ejecutar binarios de Windows / interop', coverage: 'pc', pending: 'noexec, interop apagado' },
  { id: 'A9', title: 'canario de credenciales', coverage: 'pc', pending: 'CredentialProxy, /proc/*/environ, búsqueda en el vhdx' },
  { id: 'A10', title: 'red: todo cerrado salvo el puente', coverage: 'pc', pending: 'espacio de nombres de red' },
  {
    id: 'A11',
    title: 'EgressProxy / puente: CONNECT, Host, IP literal…',
    coverage: 'pc',
    pending: 'contra los proxies reales (no incluido en W4)'
  },
  { id: 'A12', title: 'escalada: setuid, unshare, capsh, Landlock', coverage: 'pc', pending: 'núcleo de la distro' },
  { id: 'A13', title: 'borrado y renombrado sin allowDelete', coverage: 'pc', pending: 'Landlock real' },
  { id: 'A14', title: 'robustez del puente (tramas hostiles)', coverage: 'pc', pending: 'puente real' },
  { id: 'A15', title: 'persistencia / escritura en /etc, /opt', coverage: 'pc', pending: 'distro real y --terminate' },
  {
    id: 'A16',
    title: 'mayúsculas/minúsculas (A.txt y a.txt)',
    coverage: 'partial',
    pending: 'case=off en el montaje drvfs y fsutil queryCaseSensitiveInfo'
  },
  { id: 'A17', title: 'ciclo de vida de procesos', coverage: 'pc', pending: 'wsl.exe real' },
  {
    id: 'A18',
    title: 'sin sandbox imposibilitado',
    coverage: 'mac',
    // Cubierto en macOS: selectBackend (aquí), startTasksServer (`sandbox.win.test.ts`) y fullAccess/manager (`manager.winpaths.test.ts`).
    pending: 'solo la comprobación con la distro de prueba borrada en el PC (Get-Process opencode sin resultados)'
  },
  {
    id: 'A19',
    title: 'política de carpetas de Windows',
    coverage: 'partial',
    pending: 'unidades de red mapeadas y subst reales, junctions reales'
  },
  { id: 'A20', title: 'opciones efectivas de los montajes drvfs', coverage: 'pc', pending: 'findmnt y --probe en la distro' }
]

const covered = new Set<string>()
const attackDescribe = (id: AttackRow['id'], title: string, fn: () => void): void => {
  covered.add(id)
  describe(`${id} · ${title}`, fn)
}

/** Dos carpetas aprobadas (a: lectura y escritura, b: solo lectura) y una víctima NO montada. */
const MOUNTS: PathMount[] = [
  { win: 'C:\\lzx\\tareas\\a', linux: '/win/c/lzx/tareas/a' },
  { win: 'D:\\Datos\\b', linux: '/win/d/Datos/b' }
]
const MAP: PathMapWire = { kind: 'wsl', mounts: MOUNTS }
const rejectBy = (reasons: string[]): Array<(typeof attack.reject)[number]> => attack.reject.filter((c) => reasons.includes(c.reason))

/** Todas las puertas por las que una ruta de Windows llega a `main`: ninguna debe aceptar lo hostil. */
function everyDoorRejects(p: string): void {
  expect(resolveUiPath(p, 'win32').ok).toBe(false)
  expect(toSandboxOrNull(MAP, p)).toBeNull()
  expect(forbiddenWinFolderReason(p, ctx())).not.toBeNull()
}

attackDescribe('A1', 'lectura fuera de la carpeta concedida', () => {
  it.each([
    '/win/c/lzx/tareas/victima/x.txt',
    '/win/c/lzx/tareas',
    '/win/c/lzx/tareas/a2/x',
    '/win/c/lzx/tareas/ab',
    '/win/c/Users/Ben/.ssh/id_ed25519',
    '/win/d/Datos',
    '/win/d/Datos/otra',
    '/win/e/x',
    '/etc/passwd',
    '/mnt/c/Users',
    '/proc/self/environ'
  ])('desde el sandbox: %s no se traduce a ninguna ruta de Windows', (p) => {
    expect(fromSandboxPath(p, MOUNTS)).toEqual({ ok: false, reason: 'outside' })
    expect(toHost(MAP, p)).toBeNull()
  })
  it.each(['../victima/x.txt', '..\\victima', 'x.txt', './a'])('rutas relativas (%s): se rechazan', (p) => {
    expect(fromSandboxPath(p, MOUNTS).ok).toBe(false)
    expect(resolveUiPath(p, 'win32').ok).toBe(false)
  })
  it('traversal con .. aunque el resultado caería dentro: se rechaza, no se resuelve', () => {
    for (const p of ['/win/c/lzx/tareas/a/../victima/x.txt', '/win/c/lzx/tareas/a/sub/../../a/x', '/win/c/lzx/tareas/a/..']) {
      expect(fromSandboxPath(p, MOUNTS)).toEqual({ ok: false, reason: 'dotdot' })
      expect(winFromLinuxAbsolute(p)).toEqual({ ok: false, reason: 'dotdot' })
    }
  })
  it('lo que sí está concedido se traduce y vuelve exactamente a su carpeta', () => {
    expect(toHost(MAP, '/win/c/lzx/tareas/a/src/x.ts')).toBe('C:\\lzx\\tareas\\a\\src\\x.ts')
    expect(toHost(MAP, '/win/c/lzx/tareas/a')).toBe('C:\\lzx\\tareas\\a')
  })
})

attackDescribe('A2', 'junction hacia la víctima (lado main)', () => {
  const junction = 'C:\\lzx\\tareas\\a\\j'
  const lstat = (p: string): { isSymbolicLink(): boolean } | null => ({ isSymbolicLink: () => p.toLowerCase() === junction.toLowerCase() })
  it('checkNoLinks (con lstat real inyectado) la detecta antes de escribir a través de ella', () => {
    expect(checkNoLinks('C:\\lzx\\tareas\\a', ['j', 'x.txt'], lstat)).toEqual({ ok: false, reason: 'link', at: junction })
    expect(checkNoLinks('C:\\lzx\\tareas\\a', ['src', 'x.txt'], lstat)).toEqual({ ok: true })
  })
  it('léxicamente la junction es una ruta «dentro»: por eso la defensa es realpath + lstat, no la ruta', () => {
    const data: ApprovedData = { folders: [{ path: 'C:\\lzx\\tareas\\a' }], linked: {}, trusted: [] }
    expect(isApprovedPath(`${junction}\\x.txt`, data, (p, d) => isInside(p, d, 'win32'))).toBe(true)
    // Tras realpath.native la ruta real es la de la víctima, que NO está aprobada:
    expect(isApprovedPath('C:\\lzx\\tareas\\victima\\x.txt', data, (p, d) => isInside(p, d, 'win32'))).toBe(false)
  })
  it('una carpeta que ES o CONTIENE una junction no se puede aprobar (política D3 estricta)', () => {
    const asRoot = ctx({ links: fakeDisk({}, [junction]) })
    expect(forbiddenFolderReason(junction, { home: '/h', userData: '/u', mounts: [], win: asRoot }, 'win32')).not.toBeNull()
    const inside = ctx({ links: fakeDisk({ 'c:\\lzx\\tareas\\a': [{ name: 'j', isSymbolicLink: true, isDirectory: true }] }) })
    expect(forbiddenWinFolderReason('C:\\lzx\\tareas\\a', inside)).not.toBeNull()
  })
  it('una junction a otra carpeta aprobada también es un enlace: se rechaza', () => {
    const inside = ctx({ links: fakeDisk({ 'c:\\lzx\\tareas\\a': [{ name: 'a2', isSymbolicLink: true, isDirectory: true }] }) })
    expect(forbiddenWinFolderReason('C:\\lzx\\tareas\\a', inside)).not.toBeNull()
  })
})

attackDescribe('A3', 'symlink NTFS (lado main)', () => {
  it('un symlink a archivo o a directorio en cualquier nivel se detecta igual que una junction', () => {
    const lstat = (p: string): { isSymbolicLink(): boolean } => ({ isSymbolicLink: () => /\\(s|f\.txt)$/i.test(p) })
    expect(checkNoLinks('C:\\w', ['s', 'x'], lstat)).toMatchObject({ ok: false, at: 'C:\\w\\s' })
    expect(checkNoLinks('C:\\w', ['d', 'f.txt'], lstat)).toMatchObject({ ok: false, at: 'C:\\w\\d\\f.txt' })
  })
  it('si lstat falla (permisos), se rechaza: falla cerrado', () => {
    expect(
      checkNoLinks('C:\\w', ['x'], () => {
        throw new Error('EACCES')
      })
    ).toMatchObject({ ok: false, reason: 'link' })
  })
  it('un componente inexistente corta el recorrido sin error (se va a crear)', () => {
    expect(checkNoLinks('C:\\w', ['nuevo', 'x'], () => null)).toEqual({ ok: true })
  })
})

attackDescribe('A4', 'main no sigue enlaces ni rutas Linux sin traducir', () => {
  it('la forma /win/... NO es una ruta aprobada hasta traducirla (C:\\win\\c\\… sería otra cosa)', () => {
    const data: ApprovedData = { folders: [{ path: 'C:\\lzx\\tareas\\a' }], linked: {}, trusted: [] }
    const inside = (p: string, d: string): boolean => isInside(p, d, 'win32')
    expect(isApprovedPath('/win/c/lzx/tareas/a/x', data, inside)).toBe(false)
    expect(isApprovedPath('C:\\win\\c\\lzx\\tareas\\a\\x', data, inside)).toBe(false)
    const win = resolveUiPath('/win/c/lzx/tareas/a/x', 'win32')
    expect(win).toEqual({ ok: true, path: 'C:\\lzx\\tareas\\a\\x' })
    expect(win.ok && isApprovedPath(win.path, data, inside)).toBe(true)
  })
  it('un symlink creado por el agente (ln -s /win/c/lzx/tareas/victima/x.txt l) apunta a una ruta no concedida', () => {
    expect(fromSandboxPath('/win/c/lzx/tareas/victima/x.txt', MOUNTS).ok).toBe(false)
    expect(fromSandboxPath('/win/c/lzx/tareas/a/../../victima', MOUNTS).ok).toBe(false)
  })
})

attackDescribe('A5', 'UNC, dispositivos y \\\\wsl.localhost', () => {
  const hostile = [
    '\\\\srv\\share\\x',
    '//srv/share/x',
    '\\\\192.168.1.101\\x',
    '\\\\wsl.localhost\\Lazunox-Tareas\\etc\\shadow',
    '\\\\wsl$\\Lazunox-Tareas\\etc\\shadow',
    '\\\\?\\C:\\x',
    '\\\\?\\UNC\\srv\\x',
    '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1\\x',
    '\\\\.\\pipe\\x',
    '\\\\.\\PhysicalDrive0',
    '\\\\.\\C:',
    '//./pipe/x',
    '//?/C:/x'
  ]
  it.each(hostile)('%s: ninguna puerta lo acepta', (p) => {
    everyDoorRejects(p)
    expect(toSandboxPath(p).ok).toBe(false)
    expect(fromSandboxPath(p, MOUNTS).ok).toBe(false)
  })
  it.each(rejectBy(['unc', 'device']))('vector compartido $id', (c) => {
    expect(resolveUiPath(c.ui, 'win32')).toEqual({ ok: false, reason: c.reason })
    everyDoorRejects(c.ui)
  })
  it('el rechazo UNC de la política se distingue (mensaje de red) del de ruta inválida', () => {
    expect(forbiddenWinFolderReason('\\\\srv\\x', ctx())).not.toBe(forbiddenWinFolderReason('C:\\a\\..', ctx()))
  })
})

attackDescribe('A6', 'flujos alternativos de datos (ADS)', () => {
  const ads = [
    'C:\\a\\a.txt:oculto',
    'C:\\a\\x::$DATA',
    'C:\\a:b\\c',
    'C:\\a\\dir::$INDEX_ALLOCATION',
    'C:\\a\\f.txt:Zone.Identifier:$DATA',
    '/win/c/a/f.txt:oculto',
    '/win/c/a/f.txt::$DATA'
  ]
  it.each(ads)('%s', (p) => {
    expect(resolveUiPath(p, 'win32')).toEqual({ ok: false, reason: 'ads' })
    expect(forbiddenWinFolderReason(p, ctx())).not.toBeNull()
  })
  it('el agente no puede nombrar un ADS: fromSandboxPath lo rechaza aunque esté dentro de un montaje', () => {
    expect(fromSandboxPath('/win/c/lzx/tareas/a/f.txt:oculto', MOUNTS)).toEqual({ ok: false, reason: 'ads' })
    expect(fromSandboxPath('/win/c/lzx/tareas/a/f.txt::$DATA', MOUNTS)).toEqual({ ok: false, reason: 'ads' })
  })
  it.each(rejectBy(['ads']))('vector compartido $id', (c) => everyDoorRejects(c.ui))
})

attackDescribe('A6b', 'nombres reservados, 8.3, punto y espacio finales, caracteres inválidos', () => {
  const names = [
    'CON',
    'nul.txt',
    'aux.md',
    'COM1',
    'com9.log',
    'LPT1',
    'conin$',
    'CONOUT$',
    'COM\u00b9',
    'NUL .txt',
    'prn',
    'fin.',
    'fin ',
    'fin. ',
    'a?b',
    'a*b',
    'a<b',
    'a>b',
    'a|b',
    'a"b',
    'PROGRA~1',
    'DOCUME~1',
    'x~2.txt'
  ]
  it.each(names)('segmento %j', (n) => {
    const win = `C:\\lzx\\tareas\\a\\${n}`
    expect(resolveUiPath(win, 'win32').ok).toBe(false)
    expect(forbiddenWinFolderReason(win, ctx())).not.toBeNull()
    expect(fromSandboxPath(`/win/c/lzx/tareas/a/${n}`, MOUNTS).ok).toBe(false)
    expect(toSandboxOrNull(MAP, win)).toBeNull()
  })
  it('como directorio intermedio también', () => {
    expect(resolveUiPath('C:\\LPT9\\x', 'win32').ok).toBe(false)
    expect(resolveUiPath('C:\\a\\CON\\b', 'win32').ok).toBe(false)
  })
  it.each(['console', 'nulo.txt', 'communicate', 'com10', 'lpt', 'x.con', 'a~b', '~tmp'])(
    'nombres parecidos pero legítimos (%s) pasan',
    (n) => {
      expect(resolveUiPath(`C:\\lzx\\tareas\\a\\${n}`, 'win32').ok).toBe(true)
    }
  )
  it('control y NUL embebidos', () => {
    for (const p of ['C:\\a\\b\u0001c', 'C:\\a\u0000.txt', 'C:\\a\\\u007f', 'C:\\a\n\\b'])
      expect(resolveUiPath(p, 'win32')).toEqual({ ok: false, reason: 'control' })
  })
  it('longitud: segmento > 255 y ruta > 4096', () => {
    expect(resolveUiPath(`C:\\${'a'.repeat(256)}`, 'win32')).toEqual({ ok: false, reason: 'too-long' })
    expect(resolveUiPath(`C:\\${'a'.repeat(255)}`, 'win32').ok).toBe(true)
    expect(resolveUiPath(`C:\\${'a\\'.repeat(2100)}`, 'win32')).toEqual({ ok: false, reason: 'too-long' })
  })
})

attackDescribe('A7b', 'solo lo concedido es visible', () => {
  it('cada montaje solo traduce su propio árbol; el otro montaje y los hermanos no', () => {
    expect(toHost(MAP, '/win/d/Datos/b/f')).toBe('D:\\Datos\\b\\f')
    expect(toHost(MAP, '/win/d/Datos/bb/f')).toBeNull()
    expect(toHost(MAP, '/win/c/lzx/tareas/a/../b')).toBeNull()
  })
  it('sin montajes nada se traduce', () => {
    expect(fromSandboxPath('/win/c/lzx/tareas/a/x', [])).toEqual({ ok: false, reason: 'outside' })
  })
  it('displayPath traduce para MOSTRAR la forma /win/<letra>, pero eso no autoriza: toHost sigue en null', () => {
    expect(displayPath(MAP, '/win/c/Users/Ben/.ssh')).toBe('C:\\Users\\Ben\\.ssh')
    expect(toHost(MAP, '/win/c/Users/Ben/.ssh')).toBeNull()
  })
  it('la identidad (macOS) no toca nada', () => {
    expect(toSandbox(IDENTITY_MAP, '/Users/ben/x')).toBe('/Users/ben/x')
    expect(toHost(IDENTITY_MAP, '/win/c/x')).toBe('/win/c/x')
  })
})

attackDescribe('A16', 'mayúsculas y minúsculas', () => {
  it('main no ve dos entradas distintas: A.txt ≡ a.txt, unidad y separadores incluidos', () => {
    expect(samePath('C:\\a\\A.txt', 'c:/a/a.txt', 'win32')).toBe(true)
    expect(isInside('C:\\LZX\\Tareas\\A\\X', 'c:\\lzx\\tareas\\a', 'win32')).toBe(true)
    expect(isInside('C:\\lzx\\tareas\\ab', 'c:\\lzx\\tareas\\a', 'win32')).toBe(false)
  })
  it('el montaje se encuentra sin distinguir mayúsculas y reconstruye la ruta con la forma del montaje', () => {
    expect(fromSandboxPath('/win/c/LZX/Tareas/A/Sub/X.TXT', MOUNTS)).toEqual({ ok: true, path: 'C:\\lzx\\tareas\\a\\Sub\\X.TXT' })
  })
  // HUECO CONOCIDO (por confirmar en Windows real): `isInside`/`samePath` de util/paths.ts plegan con toLowerCase(),
  // que unifica el signo Kelvin (U+212A) con «k»; si NTFS los trata como nombres distintos, `C:\\Wor<K>\\a` se
  // vería «dentro» de la aprobada `C:\\Work\\a`. Requiere que alguien cree ese directorio hermano (el agente no puede,
  // está confinado), así que es de baja gravedad. `it.fails` documenta el hueco y avisará cuando se corrija.
  it.fails('HUECO: isInside(win32) no debería igualar Kelvin con k', () => {
    expect(isInside('C:\\Wor\u212A\\a\\x', 'C:\\Work\\a', 'win32')).toBe(false)
  })
  it('la letra de unidad solo es minúscula en la forma Linux (/win/C/ no existe)', () => {
    expect(winFromLinuxAbsolute('/win/C/x')).toEqual({ ok: false, reason: 'outside' })
    expect(resolveUiPath('C:\\x', 'win32')).toEqual({ ok: true, path: 'C:\\x' })
    expect(resolveUiPath('c:\\x', 'win32')).toEqual({ ok: true, path: 'C:\\x' })
  })
  it('la política veta las zonas sin importar las mayúsculas', () => {
    for (const p of [
      'c:\\WINDOWS',
      'C:\\program files',
      'C:\\users\\BEN\\appdata\\LOCAL',
      'C:\\Users\\Ben\\.SSH',
      'D:\\$RECYCLE.BIN',
      'd:\\SYSTEM VOLUME INFORMATION'
    ]) {
      expect(forbiddenWinFolderReason(p, ctx())).not.toBeNull()
    }
  })
})

attackDescribe('A18', 'sin sandbox imposibilitado (lo comprobable en macOS)', () => {
  it('con la constante real (apagada) nada enciende tasksWin y las capacidades de win32 dejan Tareas apagada', () => {
    expect(TASKS_WIN_BUILD).toBe(false)
    expect(resolveTasksWin({ platform: 'win32', optIn: true, env: { LAZUNOX_TASKS_WIN: '1' }, isPackaged: false, policy: null })).toBe(
      false
    )
    expect(capsFor('win32').tasks).toBe(false)
    expect(capsFor('win32', { tasksWin: false }).tasks).toBe(false)
  })
  it('la política de carpetas de win32 SIN contexto rechaza todo: no hay aprobación sin datos de Windows', () => {
    expect(forbiddenFolderReason('C:\\lzx\\a', { home: '/h', userData: '/u', mounts: [] }, 'win32')).not.toBeNull()
  })
  it('selectBackend(win32) lanza sin bandera, sin proveedor o con la constante apagada: nunca devuelve `none`', async () => {
    const ok = { build: true, gate: async () => ({ ok: true }), create: () => ({ id: 'wsl' }) as never }
    for (const opts of [{}, { tasksWin: false, win: ok }, { tasksWin: true }, { tasksWin: true, win: { ...ok, build: false } }]) {
      await expect(selectBackend('win32', opts), JSON.stringify(Object.keys(opts))).rejects.toBeInstanceOf(WinBackendUnavailable)
    }
  })
})

attackDescribe('A19', 'política de carpetas de Windows (tabla del plan)', () => {
  const rejected: Array<[string, string]> = [
    ['raíz C:\\', 'C:\\'],
    ['raíz D:\\', 'D:\\'],
    ['C:\\Windows', 'C:\\Windows'],
    ['C:\\Program Files', 'C:\\Program Files'],
    ['C:\\Program Files (x86)\\x', 'C:\\Program Files (x86)\\x'],
    ['C:\\ProgramData', 'C:\\ProgramData'],
    ['%USERPROFILE%', P],
    ['%APPDATA%', `${P}\\AppData\\Roaming`],
    ['%LOCALAPPDATA%', `${P}\\AppData\\Local`],
    ['perfil de Chrome', `${P}\\AppData\\Local\\Google\\Chrome\\User Data\\Default`],
    ['$Recycle.Bin', 'C:\\$Recycle.Bin'],
    ['System Volume Information', 'C:\\System Volume Information'],
    ['UNC', '\\\\192.168.1.101\\x'],
    ['unidad de red mapeada', 'Z:\\x'],
    ['PROGRA~1', 'C:\\PROGRA~1'],
    ['otro usuario', 'C:\\Users\\Ana\\Documents'],
    ['claves SSH', `${P}\\.ssh`],
    ['claves GPG', `${P}\\.gnupg`],
    ['datos de Lazunox', `${P}\\AppData\\Roaming\\Lazunox`],
    ['contiene el perfil', 'C:\\Users']
  ]
  it.each(rejected)('rechaza %s', (_n, p) => {
    expect(forbiddenWinFolderReason(p, ctx())).not.toBeNull()
  })
  it('subst X: C:\\lzx se rechaza', () => {
    expect(forbiddenWinFolderReason('X:\\', ctx({ substDrives: ['X'], drives: [{ letter: 'X', kind: 'fixed' }] }))).not.toBeNull()
    expect(forbiddenWinFolderReason('X:\\a', ctx({ substDrives: ['X'], drives: [{ letter: 'X', kind: 'fixed' }] }))).not.toBeNull()
  })
  it('junction dentro, y carpeta que contiene una junction a otra aprobada', () => {
    const c = ctx({ links: fakeDisk({ 'c:\\lzx\\tareas\\a': [{ name: 'j', isSymbolicLink: true, isDirectory: true }] }) })
    expect(forbiddenWinFolderReason('C:\\lzx\\tareas\\a', c)).not.toBeNull()
    expect(forbiddenWinFolderReason('C:\\lzx\\tareas\\a\\j', ctx({ links: fakeDisk({}, ['C:\\lzx\\tareas\\a\\j']) }))).not.toBeNull()
  })
  it.each(['C:\\lzx\\tareas\\a', `${P}\\Desktop\\prueba`, `${P}\\Documents\\x`, `${P}\\Downloads\\y`, 'D:\\Proyectos\\app'])(
    'aprueba %s',
    (p) => {
      expect(forbiddenWinFolderReason(p, ctx())).toBeNull()
    }
  )
  it('falla cerrado si no se pueden leer las unidades o el contexto es inválido', () => {
    expect(forbiddenWinFolderReason('C:\\lzx\\a', ctx({ drives: null }))).not.toBeNull()
    expect(forbiddenWinFolderReason('C:\\lzx\\a', ctx({ userProfile: '' }))).not.toBeNull()
  })
  it('todos los vectores hostiles de attack-paths.json son rechazados también como carpeta', () => {
    for (const c of attack.reject) expect(forbiddenWinFolderReason(c.ui, ctx()), c.id).not.toBeNull()
  })
  it('los vectores válidos de attack-paths.json caen en zonas permitidas solo si no son raíz de unidad', () => {
    for (const c of attack.accept) {
      const r = forbiddenWinFolderReason(c.win, ctx())
      // `C:\Users\Ben\Docs\x` es del usuario de prueba; `D:\` y `Z:\...` son raíz/red; el resto está permitido.
      if (/^[A-Z]:\\?$/.test(c.win) || c.win.startsWith('Z:')) expect(r, c.id).not.toBeNull()
      else if (!c.win.startsWith('C:\\Users\\Ben') && !c.win.startsWith('C:\\Mis')) expect(r, c.id).toBeNull()
    }
  })
})

describe('cobertura de la batería', () => {
  afterAll(() => undefined)
  it('ATTACKS lista exactamente los ataques del informe, sin duplicados', () => {
    expect(ATTACKS.map((a) => a.id)).toEqual([...REQUIRED_ATTACK_IDS])
  })
  it('cada ataque que no es `mac` dice qué queda pendiente para el PC', () => {
    for (const a of ATTACKS) if (a.coverage !== 'mac') expect(a.pending?.trim().length, a.id).toBeGreaterThan(0)
  })
  it('todo ataque marcado mac/partial tiene su bloque de pruebas, y los `pc` no fingen cobertura', () => {
    for (const a of ATTACKS) {
      if (a.coverage === 'pc') expect(covered.has(a.id), `${a.id} es solo de PC`).toBe(false)
      else expect(covered.has(a.id), `${a.id} sin bloque`).toBe(true)
    }
  })
})
