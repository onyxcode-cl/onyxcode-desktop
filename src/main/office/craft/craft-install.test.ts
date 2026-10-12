import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  craftStatus,
  installCraft,
  loadCraftPin,
  parseCraftPin,
  removeCraft,
  type CraftDeps,
  type CraftPin,
  type CraftPinAsset
} from './craft-install'
import type { RunFile } from '../libreoffice'

const BYTES = Buffer.from('zip-falso-para-prueba')
const sha = createHash('sha256').update(BYTES).digest('hex')
const SIG = { teamId: 'DJ6XS33FX8', authority: 'Developer ID Application: Learning Machines LLC (DJ6XS33FX8)' }

const asset = (name: string, bin: string, signed: boolean): CraftPinAsset => ({
  url: `https://github.com/storytold/${name}/releases/download/v0.5.0/x.zip`,
  size: BYTES.length,
  sha256: sha,
  bin,
  ...(signed ? { signature: SIG } : {})
})
/** Un programa con sus cuatro plataformas: macOS firmado (sin .exe), Windows sin firma (.exe). */
const tool = (name: string, top: string, exe: string): Record<string, CraftPinAsset> => ({
  'darwin-arm64': asset(name, `${top}/${exe}`, true),
  'darwin-x64': asset(name, `${top}/${exe}`, true),
  'win32-x64': asset(name, `${top}/${exe}.exe`, false),
  'win32-arm64': asset(name, `${top}/${exe}.exe`, false)
})
const PIN: CraftPin = {
  version: '0.5.0',
  tools: {
    deckcraft: tool('deckcraft', 'pkgd', 'deckcraft-cli'),
    wordcraft: tool('wordcraft', 'pkgw', 'wordcraft-cli'),
    gridcraft: tool('gridcraft', 'pkgg', 'gridcraft-cli')
  }
}
const TOOLS = Object.keys(PIN.tools).sort()
const okFetch = (): CraftDeps['fetch'] => async () =>
  new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.length) } })

type Call = { file: string; args: string[] }

/**
 * `ditto`/`tar.exe` falsos: crean los binarios (con y sin .exe) donde el zip dice; `codesign` falso con el equipo que se le pida.
 * `log` recibe cada llamada para comprobar qué herramientas se usaron.
 */
const fakeRun =
  (team = 'DJ6XS33FX8', verifyCode = 0, extract = true, log: Call[] = []): RunFile =>
  async (file, args) => {
    log.push({ file, args })
    if (file.endsWith('ditto') || file.endsWith('tar.exe')) {
      if (extract) {
        const dest = args[args.length - 1]
        for (const [top, exe] of [
          ['pkgd', 'deckcraft-cli'],
          ['pkgw', 'wordcraft-cli'],
          ['pkgg', 'gridcraft-cli']
        ]) {
          mkdirSync(join(dest, top), { recursive: true })
          writeFileSync(join(dest, top, exe), 'bin')
          writeFileSync(join(dest, top, `${exe}.exe`), 'bin')
        }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args[0] === '--verify') return { code: verifyCode, stdout: '', stderr: verifyCode ? 'invalid' : '' }
    return { code: 0, stdout: '', stderr: `TeamIdentifier=${team}\n` }
  }

const WIN = { platform: 'win32', arch: 'x64' }

let dir: string
const deps = (o: Partial<CraftDeps> = {}): CraftDeps => ({
  binDir: dir,
  pin: PIN,
  platform: 'darwin',
  arch: 'arm64',
  fetch: okFetch(),
  run: fakeRun(),
  freeBytes: () => 1e12,
  ...o
})
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'craft-test-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Copia del pin con un campo de un asset cambiado (o quitado, con `undefined`). */
const withAsset = (name: string, key: string, patch: object): CraftPin => ({
  ...PIN,
  tools: { ...PIN.tools, [name]: { ...PIN.tools[name], [key]: { ...PIN.tools[name][key], ...patch } } }
})
/** Forma del JSON de `pin.json` (cada programa va dentro de `assets`), para probar el parser. */
const raw = (p: CraftPin): unknown => ({
  version: p.version,
  tools: Object.fromEntries(Object.entries(p.tools).map(([n, assets]) => [n, { assets }]))
})
const winPin = (name: string, patch: object): CraftPin => withAsset(name, 'win32-x64', patch)

describe('pin de Craft', () => {
  it('el pin real del repo es válido: tres programas, cuatro plataformas, firma de Apple solo en macOS y descargas de sus repositorios', () => {
    const pin = loadCraftPin(join(__dirname, '../../../../resources/craft/pin.json'))
    expect(Object.keys(pin?.tools ?? {}).sort()).toEqual(TOOLS)
    for (const [name, assets] of Object.entries(pin!.tools)) {
      expect(Object.keys(assets).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'])
      for (const [key, a] of Object.entries(assets)) {
        expect(a.url.startsWith(`https://github.com/storytold/${name}/releases/download/`)).toBe(true)
        if (key.startsWith('darwin-')) expect(a.signature?.teamId).toBe('DJ6XS33FX8')
        else expect(a.signature).toBeUndefined()
      }
    }
  })
  it.each([
    [null],
    [{ version: '1', tools: {} }],
    [{ version: '0.5.0', tools: {} }],
    [raw(withAsset('deckcraft', 'darwin-arm64', { url: 'https://evil.example/x.zip' }))],
    [raw(withAsset('deckcraft', 'darwin-arm64', { url: 'https://github.com/otro/repo/releases/download/v1/x.zip' }))],
    [raw(withAsset('gridcraft', 'win32-x64', { url: 'https://github.com/storytold/deckcraft/releases/download/v0.5.0/x.zip' }))],
    [raw(withAsset('deckcraft', 'darwin-arm64', { sha256: 'abc' }))],
    [raw(withAsset('deckcraft', 'darwin-arm64', { bin: '../../bin/sh' }))],
    [raw(withAsset('deckcraft', 'darwin-arm64', { bin: '/bin/sh' }))],
    [raw(withAsset('deckcraft', 'win32-x64', { bin: 'C:\\Windows\\System32\\cmd.exe' }))],
    [raw(withAsset('deckcraft', 'win32-x64', { bin: '\\\\servidor\\x.exe' }))],
    [raw(withAsset('deckcraft', 'darwin-arm64', { signature: { teamId: 'x', authority: '' } }))],
    [raw(withAsset('deckcraft', 'win32-x64', { signature: { teamId: 'x', authority: '' } }))],
    [raw(withAsset('deckcraft', 'darwin-arm64', { signature: undefined }))]
  ])('rechaza pines inválidos (%#)', (input) => {
    expect(parseCraftPin(input)).toBeNull()
  })
  it('el mismo pin con las firmas de macOS puestas es válido; en Windows la firma es opcional', () => {
    expect(parseCraftPin(raw(PIN))).not.toBeNull()
    expect(parseCraftPin(raw(withAsset('deckcraft', 'win32-arm64', { signature: undefined })))).not.toBeNull()
  })
})

describe('instalación de Craft', () => {
  it('en Linux no está soportado', () => {
    expect(craftStatus(deps({ platform: 'linux' })).state).toBe('unsupported')
  })
  it('descarga, verifica e instala; luego queda «installed» sin volver a descargar', async () => {
    expect(craftStatus(deps()).state).toBe('missing')
    const bins = await installCraft(deps())
    expect(Object.keys(bins).sort()).toEqual(TOOLS)
    for (const b of Object.values(bins)) {
      expect(existsSync(b)).toBe(true)
      expect(readFileSync(b, 'utf8')).toBe('bin')
    }
    expect(craftStatus(deps()).state).toBe('installed')
    let calls = 0
    await installCraft(deps({ fetch: async () => (calls++, new Response('x')) }))
    expect(calls).toBe(0)
  })
  it('SHA-256 distinto → se descarta y no se instala', async () => {
    const bad = deps({ pin: withAsset('deckcraft', 'darwin-arm64', { sha256: '0'.repeat(64) }) as CraftPin })
    await expect(installCraft(bad)).rejects.toMatchObject({ code: 'hash' })
    expect(craftStatus(bad).state).toBe('missing')
  })
  it('tamaño distinto en la cabecera → se rechaza', async () => {
    const f: CraftDeps['fetch'] = async () => new Response(BYTES, { status: 200, headers: { 'content-length': '999' } })
    await expect(installCraft(deps({ fetch: f }))).rejects.toMatchObject({ code: 'size' })
  })
  it('firmado por otro equipo → no se instala', async () => {
    await expect(installCraft(deps({ run: fakeRun('AAAAAAAAAA') }))).rejects.toMatchObject({ code: 'signature' })
    expect(craftStatus(deps()).state).toBe('missing')
  })
  it('firma inválida → no se instala', async () => {
    await expect(installCraft(deps({ run: fakeRun('DJ6XS33FX8', 1) }))).rejects.toMatchObject({ code: 'signature' })
  })
  it('asset de macOS sin firma → se rechaza antes de ejecutar nada', async () => {
    const log: Call[] = []
    const noSig = deps({
      pin: withAsset('deckcraft', 'darwin-arm64', { signature: undefined }) as CraftPin,
      run: fakeRun(undefined, undefined, true, log)
    })
    await expect(installCraft(noSig)).rejects.toMatchObject({ code: 'signature' })
    expect(log.some((c) => c.file.endsWith('codesign'))).toBe(false)
  })
  it('el zip sin el programa esperado → error y sin restos', async () => {
    await expect(installCraft(deps({ run: fakeRun('DJ6XS33FX8', 0, false) }))).rejects.toMatchObject({ code: 'copy' })
    expect(craftStatus(deps()).state).toBe('missing')
  })
  it('poco espacio libre → error de disco antes de descargar', async () => {
    await expect(installCraft(deps({ freeBytes: () => 1 }))).rejects.toMatchObject({ code: 'disk' })
  })
  it('quitar borra la copia', async () => {
    await installCraft(deps())
    removeCraft(deps())
    expect(craftStatus(deps()).state).toBe('missing')
  })
})

describe('instalación de Craft en Windows', () => {
  it('descomprime con tar.exe, no ejecuta codesign y deja los tres programas', async () => {
    const log: Call[] = []
    const bins = await installCraft(deps({ ...WIN, run: fakeRun(undefined, undefined, true, log) }))
    expect(Object.keys(bins).sort()).toEqual(TOOLS)
    for (const b of Object.values(bins)) expect(readFileSync(b, 'utf8')).toBe('bin')
    expect(log.filter((c) => c.file.endsWith('tar.exe'))).toHaveLength(3)
    for (const c of log.filter((c) => c.file.endsWith('tar.exe'))) expect(c.args.slice(0, 3)).toEqual(['-xf', expect.any(String), '-C'])
    expect(log.some((c) => c.file.endsWith('codesign') || c.file.endsWith('ditto'))).toBe(false)
    expect(craftStatus(deps(WIN)).state).toBe('installed')
  })
  it('SHA-256 distinto → se descarta y no se instala', async () => {
    const bad = deps({ ...WIN, pin: winPin('deckcraft', { sha256: '0'.repeat(64) }) })
    await expect(installCraft(bad)).rejects.toMatchObject({ code: 'hash' })
    expect(craftStatus(bad).state).toBe('missing')
  })
  it('tamaño distinto en la cabecera → se rechaza', async () => {
    const f: CraftDeps['fetch'] = async () => new Response(BYTES, { status: 200, headers: { 'content-length': '999' } })
    await expect(installCraft(deps({ ...WIN, fetch: f }))).rejects.toMatchObject({ code: 'size' })
  })
  it('tamaño distinto en el pin (descarga incompleta o de más) → se rechaza', async () => {
    const bad = deps({ ...WIN, pin: winPin('wordcraft', { size: BYTES.length + 1 }) })
    await expect(installCraft(bad)).rejects.toMatchObject({ code: 'size' })
  })
  it('en Windows arm64 también instala (asset win32-arm64)', async () => {
    const bins = await installCraft(deps({ platform: 'win32', arch: 'arm64' }))
    expect(Object.keys(bins).sort()).toEqual(TOOLS)
  })
})

describe('varios programas', () => {
  it('si ya está uno, solo baja el que falta y el tamaño que se muestra es el del faltante', async () => {
    const urls: string[] = []
    const f: CraftDeps['fetch'] = async (u) => (
      urls.push(u),
      new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.length) } })
    )
    await installCraft(deps({ fetch: f }))
    expect(urls).toHaveLength(3)
    rmSync(join(dir, 'craft-0.5.0', 'installed-wordcraft.json'))
    const st = craftStatus(deps())
    expect(st).toMatchObject({ state: 'missing', sizeBytes: BYTES.length })
    urls.length = 0
    await installCraft(deps({ fetch: f }))
    expect(urls).toEqual([PIN.tools.wordcraft['darwin-arm64'].url])
    expect(craftStatus(deps()).state).toBe('installed')
  })
  it('la instalación de la primera versión de la prueba (installed.json) cuenta como DeckCraft instalado', async () => {
    await installCraft(deps())
    const base = join(dir, 'craft-0.5.0')
    rmSync(join(base, 'installed-deckcraft.json'))
    rmSync(join(base, 'installed-wordcraft.json'))
    rmSync(join(base, 'installed-gridcraft.json'))
    writeFileSync(join(base, 'installed.json'), '{}')
    expect(craftStatus(deps())).toMatchObject({ state: 'missing', sizeBytes: BYTES.length * 2 })
  })
  it('el progreso suma los tres archivos', async () => {
    const seen: number[] = []
    await installCraft(deps(), (p) => p.total && seen.push(p.total))
    expect(new Set(seen)).toEqual(new Set([BYTES.length * 3]))
  })
})
