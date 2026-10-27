import { describe, expect, it, vi } from 'vitest'
import { isSafeIconDataUrl } from '@shared/app-icon'
import { createAppIconResolver, createMacAppFinder, FAILURE_TTL_MS, macAppFindArgs, pickMacAppPath } from './app-icons'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

describe('isSafeIconDataUrl', () => {
  it('solo acepta el prefijo exacto de PNG en base64 y respeta el tope', () => {
    expect(isSafeIconDataUrl(PNG)).toBe(true)
    expect(isSafeIconDataUrl('data:image/png;base64,')).toBe(false)
    expect(isSafeIconDataUrl('data:image/jpeg;base64,AAAA')).toBe(false)
    expect(isSafeIconDataUrl('data:image/png;base64,AA"AA')).toBe(false)
    expect(isSafeIconDataUrl(`data:image/png;base64,${'A'.repeat(24 * 1024)}`)).toBe(false)
    expect(isSafeIconDataUrl(42)).toBe(false)
  })
})

describe('createAppIconResolver', () => {
  const mac = (over: Partial<Parameters<typeof createAppIconResolver>[0]> = {}) => {
    const findMacAppPath = vi.fn(async () => '/Applications/Spotify.app')
    const fileIconDataUrl = vi.fn(async () => PNG)
    const resolve = createAppIconResolver({ platform: 'darwin', findMacAppPath, fileIconDataUrl, ...over })
    return { resolve, findMacAppPath, fileIconDataUrl }
  }

  it('macOS: bundleId válido → ruta de la .app → icono', async () => {
    const { resolve, findMacAppPath, fileIconDataUrl } = mac()
    expect(await resolve('com.spotify.client')).toBe(PNG)
    expect(findMacAppPath).toHaveBeenCalledWith('com.spotify.client')
    expect(fileIconDataUrl).toHaveBeenCalledWith('/Applications/Spotify.app')
  })

  it('bundleId inválido (comillas, espacios, rutas, vacío) ⇒ sin icono y sin ejecutar nada', async () => {
    const { resolve, findMacAppPath } = mac()
    for (const bad of ['', 'a" || kMDItemKind == "x', 'com.x y', '../../etc', '-rf', 'a'.repeat(200)]) {
      expect(await resolve(bad)).toBeUndefined()
    }
    expect(findMacAppPath).not.toHaveBeenCalled()
  })

  it('icono que no cumple el tope o el formato, o cualquier fallo ⇒ sin icono', async () => {
    expect(await mac({ fileIconDataUrl: async () => `data:image/png;base64,${'A'.repeat(30_000)}` }).resolve('com.a.b')).toBeUndefined()
    expect(await mac({ fileIconDataUrl: async () => 'javascript:alert(1)' }).resolve('com.a.b')).toBeUndefined()
    expect(await mac({ findMacAppPath: async () => null }).resolve('com.a.b')).toBeUndefined()
    expect(
      await mac({
        findMacAppPath: async () => {
          throw new Error('boom')
        }
      }).resolve('com.a.b')
    ).toBeUndefined()
  })

  it('cache por bundleId (también de los fallos) y con tope de entradas', async () => {
    const { resolve, findMacAppPath } = mac()
    await resolve('com.a.b')
    await resolve('com.a.b')
    expect(findMacAppPath).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 100; i++) await resolve(`com.app.n${i}`)
    await resolve('com.a.b') // ya se expulsó del cache
    expect(findMacAppPath).toHaveBeenCalledTimes(102)
  })

  it('Windows: usa la ruta del exe de la clave de la app; UWP (aumid) y claves raras ⇒ sin icono', async () => {
    const { resolve, fileIconDataUrl, findMacAppPath } = mac({ platform: 'win32' })
    expect(await resolve('exe:c:\\program files\\spotify\\spotify.exe|pub:Spotify AB')).toBe(PNG)
    expect(fileIconDataUrl).toHaveBeenCalledWith('c:\\program files\\spotify\\spotify.exe')
    expect(await resolve('aumid:microsoft.windowsnotepad_8wekyb3d8bbwe!app')).toBeUndefined()
    expect(await resolve('exe:\\\\server\\share\\x.exe|pub:(sin firma)')).toBeUndefined()
    expect(findMacAppPath).not.toHaveBeenCalled()
  })

  it('Windows: sin firma o fuera de la unidad local (unidad de red mapeada) ⇒ sin icono', async () => {
    const { resolve, fileIconDataUrl } = mac({ platform: 'win32' })
    expect(await resolve('exe:c:\\users\\x\\evil.exe|pub:(sin firma)')).toBeUndefined()
    expect(await resolve('exe:z:\\apps\\x.exe|pub:Spotify AB')).toBeUndefined()
    expect(fileIconDataUrl).not.toHaveBeenCalled()
    expect(await resolve('exe:c:\\apps\\x.exe|pub:Spotify AB')).toBe(PNG)
  })

  it('los fallos caducan (~10 min) y los aciertos no', async () => {
    let t = 1_000
    let found: string | null = null
    const findMacAppPath = vi.fn(async () => found)
    const resolve = createAppIconResolver({ platform: 'darwin', findMacAppPath, fileIconDataUrl: async () => PNG, now: () => t })
    expect(await resolve('com.a.b')).toBeUndefined()
    t += FAILURE_TTL_MS - 1
    expect(await resolve('com.a.b')).toBeUndefined()
    expect(findMacAppPath).toHaveBeenCalledTimes(1)
    found = '/Applications/A.app'
    t += 2
    expect(await resolve('com.a.b')).toBe(PNG)
    expect(findMacAppPath).toHaveBeenCalledTimes(2)
    t += 10 * FAILURE_TTL_MS
    expect(await resolve('com.a.b')).toBe(PNG)
    expect(findMacAppPath).toHaveBeenCalledTimes(2)
  })

  it('búsquedas concurrentes del mismo bundleId se unen en una sola', async () => {
    const { resolve, findMacAppPath, fileIconDataUrl } = mac()
    const r = await Promise.all([resolve('com.a.b'), resolve('com.a.b'), resolve('com.a.b')])
    expect(r).toEqual([PNG, PNG, PNG])
    expect(findMacAppPath).toHaveBeenCalledTimes(1)
    expect(fileIconDataUrl).toHaveBeenCalledTimes(1)
  })

  it('dos apps distintas con EXACTAMENTE el mismo icono ⇒ es el genérico: sin icono (también el ya guardado)', async () => {
    const paths: Record<string, string> = {
      'com.a.a': '/Applications/A.app',
      'com.b.b': '/Applications/B.app',
      'com.c.c': '/Applications/C.app'
    }
    const resolve = createAppIconResolver({
      platform: 'darwin',
      findMacAppPath: async (b) => paths[b] ?? null,
      fileIconDataUrl: async () => PNG
    })
    expect(await resolve('com.a.a')).toBe(PNG)
    expect(await resolve('com.b.b')).toBeUndefined()
    expect(await resolve('com.a.a')).toBeUndefined()
    expect(await resolve('com.c.c')).toBeUndefined()
    const OTHER = 'data:image/png;base64,AAAAAAAAAAA='
    const r2 = createAppIconResolver({
      platform: 'darwin',
      findMacAppPath: async (b) => paths[b] ?? null,
      fileIconDataUrl: async (p) => (p.endsWith('A.app') ? PNG : OTHER)
    })
    expect(await r2('com.a.a')).toBe(PNG)
    expect(await r2('com.c.c')).toBe(OTHER)
  })
})

describe('búsqueda de la .app en macOS', () => {
  const home = '/Users/ben'

  it('mdfind recibe un -onlyin por carpeta de apps y el predicado exacto al final', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const find = createMacAppFinder({
      home,
      execFile: (file, args, _opts, cb) => {
        calls.push({ file, args })
        cb(null, '/Applications/Spotify.app\n')
      }
    })
    expect(await find('com.spotify.client')).toBe('/Applications/Spotify.app')
    expect(calls).toHaveLength(1)
    expect(calls[0].file).toBe('/usr/bin/mdfind')
    expect(calls[0].args).toEqual([
      '-onlyin',
      '/System/Applications',
      '-onlyin',
      '/System/Library/CoreServices',
      '-onlyin',
      '/Applications',
      '-onlyin',
      '/Users/ben/Applications',
      'kMDItemCFBundleIdentifier == "com.spotify.client"'
    ])
  })

  it('rutas fuera de las carpetas de apps (/tmp, /private, /Volumes, ~/carpeta, ..) se rechazan', () => {
    const out = [
      '/Users/ben/carpeta/Falsa.app',
      '/tmp/Falsa.app',
      '/private/tmp/Falsa.app',
      '/private/var/x/Falsa.app',
      '/Volumes/USB/Falsa.app',
      '/Applications/../tmp/Falsa.app',
      '/Applicationsx/Falsa.app',
      'Applications/Falsa.app',
      '/Applications/Falsa.txt'
    ].join('\n')
    expect(pickMacAppPath(out, home)).toBeNull()
    expect(pickMacAppPath(`${out}\n/Users/ben/Applications/Real.app`, home)).toBe('/Users/ben/Applications/Real.app')
  })

  it('prefiere la de sistema y excluye la carpeta de trabajo', () => {
    expect(pickMacAppPath('/Users/ben/Applications/X.app\n/Applications/X.app\n/System/Applications/X.app', home)).toBe(
      '/System/Applications/X.app'
    )
    expect(pickMacAppPath('/Users/ben/Applications/X.app\n/Applications/X.app', home)).toBe('/Applications/X.app')
    expect(
      pickMacAppPath('/Users/ben/Applications/work/X.app\n/Users/ben/Applications/Y.app', home, ['/Users/ben/Applications/work'])
    ).toBe('/Users/ben/Applications/Y.app')
  })

  it('bundleIds hostiles ⇒ no se ejecuta nada', async () => {
    let n = 0
    const find = createMacAppFinder({ home, execFile: (_f, _a, _o, cb) => (n++, cb(null, '/Applications/A.app')) })
    for (const bad of ['-onlyin', '-onlyin /tmp', 'a\nb', 'com.a\u202eb', 'com.ünï.app', 'a'.repeat(129), '', 'a"b', 'a b']) {
      expect(macAppFindArgs(bad, home), JSON.stringify(bad)).toBeNull()
      expect(await find(bad)).toBeNull()
    }
    expect(macAppFindArgs('a'.repeat(128), home)).not.toBeNull()
    expect(n).toBe(0)
  })

  it('un fallo o una excepción de mdfind ⇒ null', async () => {
    expect(await createMacAppFinder({ home, execFile: (_f, _a, _o, cb) => cb(new Error('x'), '') })('com.a.b')).toBeNull()
    expect(
      await createMacAppFinder({
        home,
        execFile: () => {
          throw new Error('x')
        }
      })('com.a.b')
    ).toBeNull()
  })
})
