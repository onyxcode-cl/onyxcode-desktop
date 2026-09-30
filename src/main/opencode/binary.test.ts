import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { OPENCODE_SDK_VERSION } from '@shared/opencode-links'
import {
  cachedCliVersion,
  clearCliVersionCache,
  getOpencodeInfo,
  isCompatible,
  parseVersion,
  pickOpencode,
  validateOpencodeBin,
  warmCliVersion,
  type PickInput
} from './binary'
import { bundledOpencodePath, findOpencodeBinary, resolveOpencode, resolveOpencodeAsync } from './server'

// Sin las carpetas habituales (`~/.opencode/bin`, Homebrew…): los tests no deben depender del OpenCode instalado.
vi.mock('../process/child-env', async (orig) => ({ ...(await orig<typeof import('../process/child-env')>()), EXTRA_PATH_DIRS: [] }))

const dir = mkdtempSync(join(tmpdir(), 'onyx-bin-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function script(name: string, body: string, mode = 0o755): string {
  const file = join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, mode)
  return file
}

describe('parseVersion / isCompatible', () => {
  it('extrae el número de versión', () => {
    expect(parseVersion('1.18.33\n')).toBe('1.18.33')
    expect(parseVersion('opencode v2.0.1-beta.3 (abc)')).toBe('2.0.1-beta.3')
    expect(parseVersion('sin versión')).toBeNull()
  })
  it('compatible = misma mayor y menor', () => {
    expect(isCompatible('1.18.33', '1.18.32')).toBe(true)
    expect(isCompatible('1.18.0', '1.18.32')).toBe(true)
    expect(isCompatible('1.19.0', '1.18.32')).toBe(false)
    expect(isCompatible('2.18.32', '1.18.32')).toBe(false)
    expect(isCompatible(null, '1.18.32')).toBe(false)
  })
})

describe('validateOpencodeBin (archivos reales)', () => {
  it('acepta un ejecutable cuyo --version imprime algo', async () => {
    const bin = script('ok', 'echo 1.18.32')
    expect(await validateOpencodeBin(bin)).toEqual({ ok: true, path: bin, output: '1.18.32', version: '1.18.32' })
  })
  it('acepta un enlace simbólico a un ejecutable válido', async () => {
    const bin = script('target', 'echo 1.2.3')
    const link = join(dir, 'link')
    symlinkSync(bin, link)
    expect((await validateOpencodeBin(link)).ok).toBe(true)
  })
  it('acepta una versión sin número (imprime algo) con version null', async () => {
    const r = await validateOpencodeBin(script('dev', 'echo dev-build'))
    expect(r).toMatchObject({ ok: true, version: null })
  })
  it('rechaza rutas inexistentes, relativas y vacías', async () => {
    expect((await validateOpencodeBin(join(dir, 'nope'))).ok).toBe(false)
    expect((await validateOpencodeBin('opencode')).ok).toBe(false)
    expect((await validateOpencodeBin('')).ok).toBe(false)
  })
  it('rechaza un directorio', async () => {
    expect(await validateOpencodeBin(dir)).toEqual({ ok: false, error: 'La ruta no es un archivo.' })
  })
  it('rechaza un archivo sin permiso de ejecución', async () => {
    const r = await validateOpencodeBin(script('noexec', 'echo 1.0.0', 0o644))
    expect(r).toEqual({ ok: false, error: 'El archivo no es ejecutable.' })
  })
  it('rechaza si --version no imprime nada', async () => {
    expect((await validateOpencodeBin(script('silent', 'exit 0'))).ok).toBe(false)
  })
  it('rechaza si --version termina con error', async () => {
    expect((await validateOpencodeBin(script('fails', 'echo boom; exit 3'))).ok).toBe(false)
  })
  it('rechaza (timeout) si --version se cuelga', async () => {
    const started = Date.now()
    const r = await validateOpencodeBin(script('hang', 'exec sleep 30'), 300)
    expect(r.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
  it('no usa shell: los metacaracteres de la ruta no se interpretan', async () => {
    const weird = join(dir, 'a;b $(x)')
    writeFileSync(weird, '#!/bin/sh\necho 9.9.9\n')
    chmodSync(weird, 0o755)
    expect((await validateOpencodeBin(weird)).ok).toBe(true)
  })
})

describe('getOpencodeInfo', () => {
  it('sin binario: found=false', async () => {
    expect(await getOpencodeInfo(() => null)).toMatchObject({
      found: false,
      path: null,
      version: null,
      compatible: false,
      sdkVersion: '1.18.32'
    })
  })
  it('con binario: versión y compatibilidad', async () => {
    const bin = script('info', 'echo 1.18.99')
    expect(await getOpencodeInfo(() => bin)).toMatchObject({ found: true, path: bin, version: '1.18.99', compatible: true })
    const old = script('info-old', 'echo 0.9.0')
    expect(await getOpencodeInfo(() => old)).toMatchObject({ found: true, version: '0.9.0', compatible: false })
  })
  it('binario que falla: found=true, version null', async () => {
    const bin = script('info-bad', 'exit 1')
    expect(await getOpencodeInfo(() => bin)).toMatchObject({ found: true, version: null, compatible: false })
  })
})

describe('findOpencodeBinary: OPENCODE_BIN antes que settings.opencodeBin', () => {
  it('usa el binario de ajustes si OPENCODE_BIN falta o es inválido, y OPENCODE_BIN si es válido', () => {
    const configured = script('configured', 'echo 1.0.0')
    const fromEnv = script('fromenv', 'echo 1.0.0')
    const saved = process.env.OPENCODE_BIN
    try {
      process.env.OPENCODE_BIN = join(dir, 'no-existe')
      expect(findOpencodeBinary(configured)).toBe(configured)
      process.env.OPENCODE_BIN = fromEnv
      expect(findOpencodeBinary(configured)).toBe(fromEnv)
    } finally {
      if (saved === undefined) delete process.env.OPENCODE_BIN
      else process.env.OPENCODE_BIN = saved
    }
  })
})

describe('pickOpencode: orden de resolución', () => {
  const base: PickInput = { cli: null, bundled: null, isExecutable: () => true, cliVersion: () => undefined }
  const cliOk = { cli: '/u/opencode', cliVersion: () => '1.18.99' }
  const cliOld = { cli: '/u/opencode', cliVersion: () => '1.10.0' }

  it('OPENCODE_BIN gana a todo; ajustes gana al resto', () => {
    expect(pickOpencode({ ...base, env: '/e', configured: '/c', ...cliOk, bundled: '/b' })).toEqual({ path: '/e', source: 'env' })
    expect(pickOpencode({ ...base, configured: '/c', ...cliOk, bundled: '/b' })).toEqual({ path: '/c', source: 'settings' })
  })
  it('env/ajustes no ejecutables se saltan', () => {
    const isExecutable = (p: string) => p !== '/e' && p !== '/c'
    expect(pickOpencode({ ...base, env: '/e', configured: '/c', bundled: '/b', isExecutable })).toEqual({ path: '/b', source: 'bundled' })
  })
  it('CLI compatible gana al embebido', () => {
    expect(pickOpencode({ ...base, ...cliOk, bundled: '/b' })).toEqual({ path: '/u/opencode', source: 'cli' })
  })
  it('CLI incompatible o de versión desconocida: gana el embebido', () => {
    expect(pickOpencode({ ...base, ...cliOld, bundled: '/b' })).toEqual({ path: '/b', source: 'bundled' })
    expect(pickOpencode({ ...base, cli: '/u/opencode', bundled: '/b' })).toEqual({ path: '/b', source: 'bundled' })
  })
  it('CLI incompatible sin embebido (desarrollo): último recurso, sin medir versión', () => {
    const cliVersion = vi.fn(() => '1.10.0')
    expect(pickOpencode({ ...base, cli: '/u/opencode', cliVersion })).toEqual({ path: '/u/opencode', source: 'cli' })
    expect(cliVersion).not.toHaveBeenCalled()
  })
  it('solo embebido, o nada', () => {
    expect(pickOpencode({ ...base, bundled: '/b' })).toEqual({ path: '/b', source: 'bundled' })
    expect(pickOpencode(base)).toBeNull()
  })
})

describe('bundledOpencodePath: resourcesPath inyectado', () => {
  const res = join(dir, 'Resources')
  mkdirSync(join(res, 'opencode'), { recursive: true })
  const bin = join(res, 'opencode', 'opencode')
  writeFileSync(bin, '#!/bin/sh\necho 1.18.33\n')
  chmodSync(bin, 0o755)
  const noexec = join(dir, 'Res2')
  mkdirSync(join(noexec, 'opencode'), { recursive: true })
  writeFileSync(join(noexec, 'opencode', 'opencode'), 'x')

  it('empaquetado: usa <Resources>/opencode/opencode si existe y es ejecutable', () => {
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: res })).toBe(bin)
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: join(dir, 'nada') })).toBeNull()
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: noexec })).toBeNull()
  })
  it('no empaquetado: ignora resourcesPath (desarrollo idéntico al de siempre)', () => {
    expect(bundledOpencodePath({ isPackaged: false, resourcesPath: res })).toBeNull()
  })
  it('la variable de tests solo se honra si NO está empaquetado', () => {
    const testDir = join(res, 'opencode')
    expect(bundledOpencodePath({ isPackaged: false, testDir })).toBe(bin)
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: join(dir, 'nada'), testDir })).toBeNull()
  })
})

describe('resolución completa con CLI y embebido reales (scripts falsos)', () => {
  const saved = { bin: process.env.OPENCODE_BIN, path: process.env.PATH, test: process.env.ONYXCODE_TEST_BUNDLED_DIR }
  afterEach(() => {
    for (const [k, v] of [
      ['OPENCODE_BIN', saved.bin],
      ['PATH', saved.path],
      ['ONYXCODE_TEST_BUNDLED_DIR', saved.test]
    ] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    clearCliVersionCache()
  })
  const fake = (name: string, version: string) => {
    const d = join(dir, name)
    mkdirSync(d, { recursive: true })
    const f = join(d, 'opencode')
    writeFileSync(f, `#!/bin/sh\necho ${version}\n`)
    chmodSync(f, 0o755)
    return { d, f }
  }

  it('embebido presente: CLI compatible → cli; incompatible → embebido; sin CLI → embebido', async () => {
    delete process.env.OPENCODE_BIN
    const bundled = fake('bundled-a', '1.18.33')
    process.env.ONYXCODE_TEST_BUNDLED_DIR = bundled.d
    const good = fake('cli-good', '1.18.40')
    process.env.PATH = good.d
    expect(await resolveOpencodeAsync('')).toEqual(expect.objectContaining({ source: 'cli' }))
    expect((await resolveOpencodeAsync(''))?.path).toBe(good.f)
    const old = fake('cli-old', '0.5.0')
    process.env.PATH = old.d
    expect(await resolveOpencodeAsync('')).toEqual({ path: bundled.f, source: 'bundled' })
    process.env.PATH = join(dir, 'vacio')
    expect(await resolveOpencodeAsync('')).toEqual({ path: bundled.f, source: 'bundled' })
  })

  it('embebido ausente (desarrollo): el CLI se usa aunque sea incompatible', async () => {
    delete process.env.OPENCODE_BIN
    delete process.env.ONYXCODE_TEST_BUNDLED_DIR
    const old = fake('cli-old2', '0.5.0')
    process.env.PATH = old.d
    expect(await resolveOpencodeAsync('')).toEqual({ path: old.f, source: 'cli' })
    expect(resolveOpencode('')?.path).toBe(old.f)
    process.env.PATH = join(dir, 'vacio')
    expect(await resolveOpencodeAsync('')).toBeNull()
  })

  it('getOpencodeInfo informa el origen', async () => {
    const b = fake('info-b', '1.18.33')
    expect(await getOpencodeInfo(() => ({ path: b.f, source: 'bundled' }))).toMatchObject({
      source: 'bundled',
      version: '1.18.33',
      compatible: true
    })
    expect(await getOpencodeInfo(() => b.f)).toMatchObject({ source: 'cli' })
    expect(await getOpencodeInfo(() => null)).toMatchObject({ found: false, source: null })
  })
})

describe('caché de la versión del CLI por (ruta, mtime)', () => {
  afterEach(() => clearCliVersionCache())
  it('no vuelve a ejecutar mientras la ruta y el mtime no cambian, y remide si cambia el mtime', async () => {
    const f = script('cached', 'echo 1.18.1')
    const run = vi.fn(async () => '1.18.1')
    expect(cachedCliVersion(f)).toBeUndefined()
    expect(await warmCliVersion(f, run)).toBe('1.18.1')
    expect(await warmCliVersion(f, run)).toBe('1.18.1')
    expect(run).toHaveBeenCalledTimes(1)
    expect(cachedCliVersion(f)).toBe('1.18.1')
    utimesSync(f, new Date(), new Date(Date.now() + 5_000))
    expect(cachedCliVersion(f)).toBeUndefined()
    expect(await warmCliVersion(f, async () => '1.19.0')).toBe('1.19.0')
  })
  it('un fallo de --version se cachea como null (no reintenta en cada llamada)', async () => {
    const f = script('cached-bad', 'exit 1')
    const run = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await warmCliVersion(f, run)).toBeNull()
    expect(await warmCliVersion(f, run)).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('pin.json', () => {
  const pin = JSON.parse(readFileSync(join(__dirname, '../../../resources/opencode-bin/pin.json'), 'utf8')) as Record<string, unknown>
  it('la versión fijada es compatible con el SDK (misma mayor.menor)', () => {
    expect(isCompatible(pin.version as string, OPENCODE_SDK_VERSION)).toBe(true)
  })
  it('sha256 son 64 hex, url es https de la release oficial y size es un entero positivo', () => {
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(pin.url).toMatch(/^https:\/\/github\.com\/anomalyco\/opencode\/releases\/download\/v[^/]+\/[^/]+\.zip$/)
    expect(pin.url).toContain(`/v${pin.version as string}/`)
    expect(Number.isInteger(pin.size) && (pin.size as number) > 0).toBe(true)
  })
})
