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
  probeEnv,
  validateOpencodeBin,
  warmCliVersion,
  type PickInput
} from './binary'
import { bundledOpencodePath, findOpencodeBinary, resolveOpencode, resolveOpencodeAsync } from './server'
import { isWin, posixOnly } from '../../test/platform'

// Sin las carpetas habituales (`~/.opencode/bin`, Homebrew…): los tests no deben depender del OpenCode instalado.
vi.mock('../process/child-env', async (orig) => ({ ...(await orig<typeof import('../process/child-env')>()), EXTRA_PATH_DIRS: [] }))

const dir = mkdtempSync(join(tmpdir(), 'onyx-bin-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/**
 * Programa falso. POSIX: script `#!/bin/sh` con `sh` como cuerpo. Windows: un `.mjs` con `js` (la app lo lanza con
 * `node <mjs>` solo sin empaquetar, igual que el OpenCode falso de los E2E: `opencode/test-launcher.ts`).
 */
function script(name: string, sh: string, mode = 0o755, js?: string): string {
  if (isWin) {
    const file = join(dir, `${name}.mjs`)
    writeFileSync(file, js ?? jsFor(sh))
    return file
  }
  const file = join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${sh}\n`)
  chmodSync(file, mode)
  return file
}

/** Traduce los cuerpos `sh` triviales de estos tests (`echo X`, `exit N`, `echo X; exit N`, `exec sleep N`) a JS de node. */
function jsFor(sh: string): string {
  const out: string[] = []
  for (const part of sh.split(';').map((x) => x.trim())) {
    const echo = /^echo (.*)$/.exec(part)
    const exit = /^exit (\d+)$/.exec(part)
    const sleep = /^exec sleep (\d+)$/.exec(part)
    if (echo) out.push(`console.log(${JSON.stringify(echo[1])})`)
    else if (exit) out.push(`process.exit(${exit[1]})`)
    else if (sleep) out.push(`setTimeout(() => {}, ${Number(sleep[1]) * 1000})`)
    else throw new Error(`jsFor: cuerpo no soportado: ${part}`)
  }
  return out.join('\n') + '\n'
}

describe('probeEnv', () => {
  it('manda los XDG_* a un temporal y no a los datos del usuario', () => {
    const env = probeEnv()
    for (const k of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']) {
      expect(env[k]).toContain(join(tmpdir(), 'onyxcode-version-probe'))
    }
  })
})

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
  // Windows: crear enlaces simbólicos exige privilegios; el caso no aporta a la v1 (la ruta se resuelve con realpath en ambos).
  it.skipIf(isWin)('acepta un enlace simbólico a un ejecutable válido', async () => {
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
  // Windows: no existe el bit de ejecución (accessSync X_OK siempre pasa); allí el ejecutable lo decide la extensión.
  it.skipIf(isWin)('rechaza un archivo sin permiso de ejecución', async () => {
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
    const weird = join(dir, isWin ? 'a;b $(x).mjs' : 'a;b $(x)')
    writeFileSync(weird, isWin ? 'console.log("9.9.9")\n' : '#!/bin/sh\necho 9.9.9\n')
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
  const exeName = isWin ? 'opencode.exe' : 'opencode'
  const bin = join(res, 'opencode', exeName)
  writeFileSync(bin, isWin ? 'MZ' : '#!/bin/sh\necho 1.18.33\n')
  chmodSync(bin, 0o755)
  const noexec = join(dir, 'Res2')
  mkdirSync(join(noexec, 'opencode'), { recursive: true })
  writeFileSync(join(noexec, 'opencode', exeName), 'x')

  it('empaquetado: usa <Resources>/opencode/opencode(.exe) si existe y es ejecutable', () => {
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: res })).toBe(bin)
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: join(dir, 'nada') })).toBeNull()
    // Windows: no hay bit de ejecución, así que «existe pero no es ejecutable» no se puede construir.
    if (posixOnly) expect(bundledOpencodePath({ isPackaged: true, resourcesPath: noexec })).toBeNull()
  })
  it('no empaquetado: ignora resourcesPath (desarrollo idéntico al de siempre)', () => {
    expect(bundledOpencodePath({ isPackaged: false, resourcesPath: res })).toBeNull()
  })
  it('Windows: el binario embebido es opencode.exe', () => {
    const winRes = join(dir, 'ResWin')
    mkdirSync(join(winRes, 'opencode'), { recursive: true })
    const exe = join(winRes, 'opencode', 'opencode.exe')
    writeFileSync(exe, 'MZ')
    chmodSync(exe, 0o755)
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: winRes, platform: 'win32' })).toBe(exe)
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: winRes, platform: 'darwin' })).toBeNull()
  })
  it('Windows (solo pruebas): sin opencode.exe en el directorio de pruebas se acepta opencode.mjs', () => {
    const d = join(dir, 'TestWin')
    mkdirSync(d, { recursive: true })
    const mjs = join(d, 'opencode.mjs')
    writeFileSync(mjs, 'console.log("1.18.33")\n')
    chmodSync(mjs, 0o755)
    expect(bundledOpencodePath({ isPackaged: false, testDir: d, platform: 'win32' })).toBe(mjs)
    expect(bundledOpencodePath({ isPackaged: false, testDir: d, platform: 'darwin' })).toBeNull()
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: join(dir, 'nada'), testDir: d, platform: 'win32' })).toBeNull()
  })
  it('la variable de tests solo se honra si NO está empaquetado', () => {
    const testDir = join(res, 'opencode')
    expect(bundledOpencodePath({ isPackaged: false, testDir })).toBe(bin)
    expect(bundledOpencodePath({ isPackaged: true, resourcesPath: join(dir, 'nada'), testDir })).toBeNull()
  })
})

// Windows: la resolución busca `opencode.exe` (un .exe real) y un `.mjs` no se encuentra por nombre; no hay forma de fabricar
// un .exe con versión controlada sin compilar. La lógica de decisión se cubre en `pickOpencode` (valores inyectados) y
// `bundledOpencodePath` (arriba, con rutas reales en win32).
describe.skipIf(isWin)('resolución completa con CLI y embebido reales (scripts falsos)', () => {
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
  it.each(['darwin-arm64', 'win32-x64'])('asset %s: sha256 de 64 hex, url https de la release oficial y size entero positivo', (key) => {
    const asset = (pin.assets as Record<string, { url: string; sha256: string; size: number }>)[key]
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(asset.url).toMatch(/^https:\/\/github\.com\/anomalyco\/opencode\/releases\/download\/v[^/]+\/[^/]+\.zip$/)
    expect(asset.url).toContain(`/v${pin.version as string}/`)
    expect(Number.isInteger(asset.size) && asset.size > 0).toBe(true)
  })
})
