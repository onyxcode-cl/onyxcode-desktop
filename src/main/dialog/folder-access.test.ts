// checkFolderAccess (F8-B210): errores simulados del sistema de archivos y lectura real de carpetas temporales.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkFolderAccess,
  defaultProbe,
  resetFolderPermission,
  tccServicesFor,
  type FolderAccessDeps,
  type ResetDeps
} from './folder-access'
import { posixOnly } from '../../test/platform'

const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
const deps = (probe: FolderAccessDeps['probe'], platform: NodeJS.Platform = 'darwin'): FolderAccessDeps => ({
  probe,
  timeoutMs: 50,
  platform
})

describe('checkFolderAccess con errores simulados', () => {
  it('ok cuando se puede leer', async () => {
    expect(
      await checkFolderAccess(
        '/x',
        deps(async () => undefined)
      )
    ).toBe('ok')
  })
  it.each(['EPERM', 'EACCES'])('%s en macOS es denied', async (code) => {
    expect(
      await checkFolderAccess(
        '/x',
        deps(() => Promise.reject(err(code)))
      )
    ).toBe('denied')
  })
  it.each(['ENOENT', 'ENOTDIR'])('%s es missing', async (code) => {
    expect(
      await checkFolderAccess(
        '/x',
        deps(() => Promise.reject(err(code)))
      )
    ).toBe('missing')
  })
  it('otro error (EMFILE) no bloquea', async () => {
    expect(
      await checkFolderAccess(
        '/x',
        deps(() => Promise.reject(err('EMFILE')))
      )
    ).toBe('ok')
  })
  it('fuera de macOS EACCES no muestra la tarjeta de macOS, pero ENOENT sí se distingue', async () => {
    expect(
      await checkFolderAccess(
        '/x',
        deps(() => Promise.reject(err('EACCES')), 'win32')
      )
    ).toBe('ok')
    expect(
      await checkFolderAccess(
        '/x',
        deps(() => Promise.reject(err('ENOENT')), 'linux')
      )
    ).toBe('missing')
  })
  describe('tiempo límite', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    it('timeout si la lectura no responde (aviso de macOS sin contestar)', async () => {
      const p = checkFolderAccess(
        '/x',
        deps(() => new Promise<void>(() => undefined))
      )
      await vi.advanceTimersByTimeAsync(60)
      expect(await p).toBe('timeout')
    })
    it('un rechazo tardío tras el timeout no queda sin atender', async () => {
      let reject!: (e: unknown) => void
      const p = checkFolderAccess(
        '/x',
        deps(() => new Promise<void>((_r, rej) => (reject = rej)))
      )
      await vi.advanceTimersByTimeAsync(60)
      expect(await p).toBe('timeout')
      reject(err('EPERM'))
      await vi.advanceTimersByTimeAsync(1)
    })
    it('responde antes del límite: no es timeout', async () => {
      const p = checkFolderAccess(
        '/x',
        deps(() => new Promise<void>((r) => setTimeout(r, 10)))
      )
      await vi.advanceTimersByTimeAsync(20)
      expect(await p).toBe('ok')
    })
  })
})

describe('checkFolderAccess con carpetas reales', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-fa-')))
  const real = (): FolderAccessDeps => ({ probe: defaultProbe, timeoutMs: 2000, platform: 'darwin' })
  afterEach(() => undefined)
  it('carpeta normal: ok (vacía y con archivos)', async () => {
    const vacia = join(root, 'vacia')
    const llena = join(root, 'llena')
    mkdirSync(vacia)
    mkdirSync(llena)
    writeFileSync(join(llena, 'a.txt'), 'x')
    expect(await checkFolderAccess(vacia, real())).toBe('ok')
    expect(await checkFolderAccess(llena, real())).toBe('ok')
  })
  it('carpeta inexistente: missing', async () => {
    expect(await checkFolderAccess(join(root, 'no-existe'), real())).toBe('missing')
  })
  it('un archivo en vez de carpeta: missing', async () => {
    const f = join(root, 'f.txt')
    writeFileSync(f, 'x')
    expect(await checkFolderAccess(f, real())).toBe('missing')
  })
  // chmod 000 como root no niega nada y en Windows no existe: solo POSIX sin root.
  it.skipIf(!posixOnly || process.getuid?.() === 0)(
    'sin permiso POSIX (chmod 000): denied, y al devolver el permiso vuelve a ok (sin caché)',
    async () => {
      const d = join(root, 'cerrada')
      mkdirSync(d)
      chmodSync(d, 0)
      try {
        expect(await checkFolderAccess(d, real())).toBe('denied')
      } finally {
        chmodSync(d, 0o755)
      }
      expect(await checkFolderAccess(d, real())).toBe('ok')
    }
  )
  it('limpieza', () => rmSync(root, { recursive: true, force: true }))
})

describe('tccServicesFor: lista fija por ruta', () => {
  const home = '/Users/yo'
  it.each([
    ['/Users/yo/Documents', ['SystemPolicyDocumentsFolder']],
    ['/Users/yo/Documents/a/b', ['SystemPolicyDocumentsFolder']],
    ['/Users/yo/Desktop/x', ['SystemPolicyDesktopFolder']],
    ['/Users/yo/Downloads', ['SystemPolicyDownloadsFolder']],
    ['/Users/yo/Library/Mobile Documents/com~apple~CloudDocs/p', ['Ubiquity']],
    ['/Volumes/Disco', ['SystemPolicyRemovableVolumes', 'SystemPolicyNetworkVolumes']],
    ['/Users/yo/proyectos/app', []],
    ['/Users/yo/Documentsx', []],
    ['/Volumes', []],
    ['/etc', []]
  ])('%s', (p, esperado) => {
    expect(tccServicesFor(p, home)).toEqual(esperado)
  })
})

describe('resetFolderPermission (execFile simulado; NUNCA se ejecuta tccutil de verdad)', () => {
  const mk = (o: Partial<ResetDeps> = {}): ResetDeps & { run: ReturnType<typeof vi.fn> } =>
    ({
      platform: 'darwin',
      home: '/Users/yo',
      appId: 'cl.test.app',
      timeoutMs: 5000,
      run: vi.fn(async () => undefined),
      ...o
    }) as never
  it('Documentos: /usr/bin/tccutil reset <servicio> <appId>, sin shell y con plazo', async () => {
    const d = mk()
    expect(await resetFolderPermission('/Users/yo/Documents/p', d)).toBe('reset')
    expect(d.run).toHaveBeenCalledExactlyOnceWith('/usr/bin/tccutil', ['reset', 'SystemPolicyDocumentsFolder', 'cl.test.app'], 5000)
  })
  it('volúmenes: restablece los dos servicios fijos', async () => {
    const d = mk()
    expect(await resetFolderPermission('/Volumes/X/p', d)).toBe('reset')
    expect(d.run.mock.calls.map((c) => c[1][1])).toEqual(['SystemPolicyRemovableVolumes', 'SystemPolicyNetworkVolumes'])
  })
  it('ruta fuera de zonas protegidas o plataforma no macOS: unsupported y no ejecuta nada', async () => {
    const d = mk()
    expect(await resetFolderPermission('/Users/yo/proyectos', d)).toBe('unsupported')
    const w = mk({ platform: 'win32' })
    expect(await resetFolderPermission('/Users/yo/Documents', w)).toBe('unsupported')
    expect(d.run).not.toHaveBeenCalled()
    expect(w.run).not.toHaveBeenCalled()
  })
  it('si tccutil falla o vence: failed', async () => {
    const d = mk({ run: vi.fn(() => Promise.reject(new Error('exit 1'))) })
    expect(await resetFolderPermission('/Users/yo/Desktop', d)).toBe('failed')
  })
  it('el appId por defecto es la constante de la app', async () => {
    const { defaultResetDeps } = await import('./folder-access')
    const { APP_ID } = await import('@shared/brand')
    expect(defaultResetDeps().appId).toBe(APP_ID)
  })
})
