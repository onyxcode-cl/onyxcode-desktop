import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CRAFT_DISK_FACTOR,
  clearCraftCheckCache,
  craftInspect,
  craftStatus,
  craftWebDir,
  installCraft,
  loadCraftPin,
  parseCraftPin,
  removeCraft,
  type CraftDeps,
  type CraftPin,
  type CraftPinAsset,
  type CraftProgress,
  type CraftWebAsset
} from './craft-install'
import type { RunFile } from '../download'

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
/** Versión web: un zip para todas las plataformas; su carpeta raíz se llama `web-<programa>`. */
const webAsset = (name: string): CraftWebAsset => ({
  url: `https://github.com/storytold/${name}/releases/download/v0.5.0/${name}-web.zip`,
  size: BYTES.length,
  sha256: sha,
  dir: `web-${name}`
})
const PIN: CraftPin = {
  version: '0.5.0',
  tools: {
    deckcraft: tool('deckcraft', 'pkgd', 'deckcraft-cli'),
    wordcraft: tool('wordcraft', 'pkgw', 'wordcraft-cli'),
    gridcraft: tool('gridcraft', 'pkgg', 'gridcraft-cli')
  },
  web: { deckcraft: webAsset('deckcraft'), wordcraft: webAsset('wordcraft'), gridcraft: webAsset('gridcraft') }
}
const TOOLS = Object.keys(PIN.tools).sort()
const WEBS = Object.keys(PIN.web!).sort()
/** Seis descargas: tres CLI y tres web. */
const TOTAL = BYTES.length * (TOOLS.length + WEBS.length)
const okFetch = (): CraftDeps['fetch'] => async () =>
  new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.length) } })

type Call = { file: string; args: string[] }

/** Contenido de las carpetas web que trae cada zip (por defecto, sitio válido con `index.html`). */
const defaultWebLayout = (dest: string): void => {
  for (const w of Object.values(PIN.web!)) {
    mkdirSync(join(dest, w.dir), { recursive: true })
    writeFileSync(join(dest, w.dir, 'index.html'), 'index')
  }
}
/** Se cambia en algunas pruebas para simular zips web defectuosos; se restaura en `beforeEach`. */
let webLayout: (dest: string) => void = defaultWebLayout

/**
 * `ditto`/`tar.exe` falsos: crean los binarios (con y sin .exe) y las carpetas web donde el zip dice; `codesign` falso con el equipo que
 * se le pida. `log` recibe cada llamada para comprobar qué herramientas se usaron.
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
        webLayout(dest)
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
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'craft-test-'))
  webLayout = defaultWebLayout
  clearCraftCheckCache()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Copia del pin con un campo de un asset cambiado (o quitado, con `undefined`). */
const withAsset = (name: string, key: string, patch: object): CraftPin => ({
  ...PIN,
  tools: { ...PIN.tools, [name]: { ...PIN.tools[name], [key]: { ...PIN.tools[name][key], ...patch } } }
})
/** Copia del pin con un campo de una versión web cambiado. */
const withWeb = (name: string, patch: object): CraftPin => ({
  ...PIN,
  web: { ...PIN.web, [name]: { ...PIN.web![name], ...patch } }
})
/** Forma del JSON de `pin.json` (cada programa va dentro de `assets`), para probar el parser. */
const raw = (p: CraftPin): Record<string, unknown> => ({
  version: p.version,
  tools: Object.fromEntries(Object.entries(p.tools).map(([n, assets]) => [n, { assets }])),
  ...(p.web ? { web: p.web } : {})
})
/** El pin válido con una versión web cambiada (para probar el parser de `web`). */
const rawWeb = (name: string, patch: object): Record<string, unknown> => raw(withWeb(name, patch))
const winPin = (name: string, patch: object): CraftPin => withAsset(name, 'win32-x64', patch)
const webDirOf = (prog: string): string => join(dir, 'craft-0.5.0', 'web', prog)

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
  it('el pin real del repo trae las cuatro versiones web (Excel, PowerPoint, Word y PDF) con su tamaño, SHA-256 y carpeta', () => {
    const pin = loadCraftPin(join(__dirname, '../../../../resources/craft/pin.json'))
    expect(Object.keys(pin?.web ?? {}).sort()).toEqual(['deckcraft', 'gridcraft', 'pdfcraft', 'wordcraft'])
    expect(pin!.web!.gridcraft).toEqual({
      url: 'https://github.com/storytold/gridcraft/releases/download/v0.6.1/gridcraft-web-0.6.1.zip',
      size: 6961445,
      sha256: '86048ba175689ff852c141d6115e5491f0856f891300c3e1f91274b9c2709a42',
      dir: 'gridcraft-web-0.6.1'
    })
    expect(pin!.web!.deckcraft.dir).toBe('deckcraft-web-0.5.0')
    expect(pin!.web!.wordcraft.dir).toBe('wordcraft-web-0.6.1')
    expect(pin!.web!.pdfcraft).toMatchObject({ size: 14047380, dir: 'pdfcraft-web-0.7.1' })
    for (const [name, w] of Object.entries(pin!.web!))
      expect(w.url.startsWith(`https://github.com/storytold/${name}/releases/download/`)).toBe(true)
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
    [raw(withAsset('deckcraft', 'darwin-arm64', { signature: undefined }))],
    // Versiones web
    [rawWeb('gridcraft', { url: 'https://evil.example/x.zip' })],
    [rawWeb('gridcraft', { url: 'https://github.com/storytold/deckcraft/releases/download/v0.5.0/x.zip' })],
    [rawWeb('gridcraft', { size: 0 })],
    [rawWeb('gridcraft', { sha256: 'abc' })],
    [rawWeb('gridcraft', { dir: '../x' })],
    [rawWeb('gridcraft', { dir: 'a/b' })],
    [rawWeb('gridcraft', { dir: 'a\\b' })],
    [rawWeb('gridcraft', { dir: 'C:x' })],
    [rawWeb('gridcraft', { dir: '.' })],
    [rawWeb('gridcraft', { dir: '' })],
    [{ ...raw(PIN), web: [] }],
    [{ ...raw(PIN), web: {} }],
    [{ ...raw(PIN), web: 'gridcraft' }]
  ])('rechaza pines inválidos (%#)', (input) => {
    expect(parseCraftPin(input)).toBeNull()
  })
  it('el mismo pin con las firmas de macOS puestas es válido; en Windows la firma es opcional; sin «web» sigue valiendo', () => {
    expect(parseCraftPin(raw(PIN))).not.toBeNull()
    expect(parseCraftPin(raw(withAsset('deckcraft', 'win32-arm64', { signature: undefined })))).not.toBeNull()
    const sinWeb = parseCraftPin({ version: PIN.version, tools: raw(PIN).tools })
    expect(sinWeb?.web).toBeUndefined()
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
  it('tras instalar con éxito limpia versiones viejas; si la instalación falla no borra nada', async () => {
    mkdirSync(join(dir, 'craft-0.4.0'), { recursive: true })
    mkdirSync(join(dir, 'craft-0.3.0'), { recursive: true })
    writeFileSync(join(dir, 'craft-intento.json'), '{}')
    const bad = deps({ pin: withAsset('deckcraft', 'darwin-arm64', { sha256: '0'.repeat(64) }) as CraftPin })
    await expect(installCraft(bad)).rejects.toMatchObject({ code: 'hash' })
    expect(existsSync(join(dir, 'craft-0.4.0'))).toBe(true)
    await installCraft(deps())
    expect(existsSync(join(dir, 'craft-0.4.0'))).toBe(false)
    expect(existsSync(join(dir, 'craft-0.3.0'))).toBe(false)
    expect(existsSync(join(dir, 'craft-0.5.0'))).toBe(true)
    expect(existsSync(join(dir, 'craft-intento.json'))).toBe(true)
  })
  it('instala también las tres versiones web junto a los CLI, cada una en web/<programa> con su index.html', async () => {
    await installCraft(deps())
    for (const p of WEBS) {
      expect(craftWebDir(deps(), p)).toBe(webDirOf(p))
      expect(readFileSync(join(webDirOf(p), 'index.html'), 'utf8')).toBe('index')
      expect(existsSync(join(dir, 'craft-0.5.0', `installed-web-${p}.json`))).toBe(true)
    }
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
  it('quitar borra la copia (también la web)', async () => {
    await installCraft(deps())
    removeCraft(deps())
    expect(craftStatus(deps()).state).toBe('missing')
    expect(craftWebDir(deps(), 'gridcraft')).toBeNull()
  })
})

describe('versiones web de Craft', () => {
  it('SHA-256 de una web distinto → se rechaza, no queda la web y los CLI siguen en su sitio', async () => {
    const bad = deps({ pin: withWeb('gridcraft', { sha256: '0'.repeat(64) }) })
    await expect(installCraft(bad)).rejects.toMatchObject({ code: 'hash' })
    expect(craftWebDir(bad, 'gridcraft')).toBeNull()
    expect(craftStatus(bad).state).toBe('missing')
  })
  it('tamaño de una web distinto en el pin → se rechaza', async () => {
    const bad = deps({ pin: withWeb('wordcraft', { size: BYTES.length + 1 }) })
    await expect(installCraft(bad)).rejects.toMatchObject({ code: 'size' })
    expect(craftWebDir(bad, 'wordcraft')).toBeNull()
  })
  it('solo baja la web que falta', async () => {
    await installCraft(deps())
    rmSync(join(dir, 'craft-0.5.0', 'installed-web-gridcraft.json'))
    expect(craftStatus(deps())).toMatchObject({ state: 'missing', sizeBytes: BYTES.length })
    const urls: string[] = []
    await installCraft(
      deps({
        fetch: async (u) => (urls.push(u), new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.length) } }))
      })
    )
    expect(urls).toEqual([PIN.web!.gridcraft.url])
    expect(craftWebDir(deps(), 'gridcraft')).toBe(webDirOf('gridcraft'))
  })
  it('un zip web con enlace simbólico → se rechaza, no deja restos ni web instalada', async () => {
    webLayout = (dest) => {
      defaultWebLayout(dest)
      for (const w of Object.values(PIN.web!)) symlinkSync('/nonexistent-craft-test', join(dest, w.dir, 'enlace'))
    }
    await expect(installCraft(deps())).rejects.toMatchObject({ code: 'copy' })
    expect(existsSync(join(dir, 'craft-0.5.0', 'web'))).toBe(false)
    expect(readdirSync(dir).filter((n) => n.startsWith('.craft-tmp-'))).toEqual([])
    expect(craftWebDir(deps(), 'gridcraft')).toBeNull()
  })
  it('un zip web sin index.html → se rechaza y no deja restos', async () => {
    webLayout = (dest) => {
      for (const w of Object.values(PIN.web!)) mkdirSync(join(dest, w.dir), { recursive: true })
    }
    await expect(installCraft(deps())).rejects.toMatchObject({ code: 'copy' })
    expect(existsSync(join(dir, 'craft-0.5.0', 'web'))).toBe(false)
    expect(readdirSync(dir).filter((n) => n.startsWith('.craft-tmp-'))).toEqual([])
    expect(craftStatus(deps()).state).toBe('missing')
  })
  it('craftWebDir devuelve null sin la marca de instalación', async () => {
    await installCraft(deps())
    expect(craftWebDir(deps(), 'gridcraft')).toBe(webDirOf('gridcraft'))
    rmSync(join(dir, 'craft-0.5.0', 'installed-web-gridcraft.json'))
    expect(craftWebDir(deps(), 'gridcraft')).toBeNull()
    expect(craftWebDir(deps(), 'nadie')).toBeNull()
  })
  it('craftWebDir devuelve null si no hay pin de web para el programa', async () => {
    await installCraft(deps())
    expect(craftWebDir({ ...deps(), pin: { ...PIN, web: undefined } }, 'gridcraft')).toBeNull()
  })
})

describe('instalación de Craft en Windows', () => {
  it('descomprime con tar.exe, no ejecuta codesign y deja los tres programas y sus webs', async () => {
    const log: Call[] = []
    const bins = await installCraft(deps({ ...WIN, run: fakeRun(undefined, undefined, true, log) }))
    expect(Object.keys(bins).sort()).toEqual(TOOLS)
    for (const b of Object.values(bins)) expect(readFileSync(b, 'utf8')).toBe('bin')
    expect(log.filter((c) => c.file.endsWith('tar.exe'))).toHaveLength(TOOLS.length + WEBS.length)
    for (const c of log.filter((c) => c.file.endsWith('tar.exe'))) expect(c.args.slice(0, 3)).toEqual(['-xf', expect.any(String), '-C'])
    expect(log.some((c) => c.file.endsWith('codesign') || c.file.endsWith('ditto'))).toBe(false)
    expect(craftStatus(deps(WIN)).state).toBe('installed')
    for (const p of WEBS) expect(craftWebDir(deps(WIN), p)).toBe(webDirOf(p))
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
    expect(urls).toHaveLength(TOOLS.length + WEBS.length)
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
    // Faltan WordCraft y GridCraft (CLI); las webs siguen instaladas.
    expect(craftStatus(deps())).toMatchObject({ state: 'missing', sizeBytes: BYTES.length * 2 })
  })
  it('el progreso suma los seis archivos (tres CLI y tres web) y termina en «done»', async () => {
    const events: CraftProgress[] = []
    await installCraft(deps(), (p) => events.push(p))
    expect(events.every((p) => p.total === TOTAL)).toBe(true)
    expect(events.at(-1)).toEqual({ phase: 'done', done: TOTAL, total: TOTAL })
  })
})

describe('integridad de lo instalado (no basta la marca)', () => {
  const binPath = (top: string, exe: string): string => join(dir, 'craft-0.5.0', top, exe)

  it('instalación completa: ninguna pieza con problema y la marca guarda el tamaño del binario', async () => {
    await installCraft(deps())
    expect(craftInspect(deps()).every((p) => p.problem === null)).toBe(true)
    const mark = JSON.parse(readFileSync(join(dir, 'craft-0.5.0', 'installed-deckcraft.json'), 'utf8')) as { binSize: number }
    expect(mark.binSize).toBe(3)
  })
  it('un binario borrado con su marca presente cuenta como faltante (y se repara solo ese)', async () => {
    await installCraft(deps())
    rmSync(binPath('pkgw', 'wordcraft-cli'))
    expect(craftInspect(deps()).find((p) => p.name === 'wordcraft')?.problem).toBe('no-file')
    expect(craftStatus(deps())).toMatchObject({ state: 'missing', sizeBytes: BYTES.length })
  })
  it('un binario truncado (tamaño distinto al anotado) o vacío cuenta como dañado', async () => {
    await installCraft(deps())
    truncateSync(binPath('pkgd', 'deckcraft-cli'), 1)
    writeFileSync(binPath('pkgg', 'gridcraft-cli'), '')
    const parts = craftInspect(deps())
    expect(parts.find((p) => p.name === 'deckcraft')?.problem).toBe('truncated')
    expect(parts.find((p) => p.name === 'gridcraft')?.problem).toBe('truncated')
    expect(craftStatus(deps())).toMatchObject({ state: 'missing', sizeBytes: BYTES.length * 2 })
  })
  it('una marca de otro SHA-256 (el pin cambió) es obsoleta', async () => {
    await installCraft(deps())
    const mark = join(dir, 'craft-0.5.0', 'installed-deckcraft.json')
    writeFileSync(mark, JSON.stringify({ sha256: 'f'.repeat(64) }))
    expect(craftInspect(deps()).find((p) => p.name === 'deckcraft')?.problem).toBe('stale')
  })
  it('una versión web sin index.html, con index vacío o con archivos de menos queda dañada', async () => {
    await installCraft(deps())
    rmSync(join(webDirOf('gridcraft'), 'index.html'))
    writeFileSync(join(webDirOf('wordcraft'), 'index.html'), '')
    writeFileSync(join(webDirOf('deckcraft'), 'extra.js'), 'x')
    rmSync(join(webDirOf('deckcraft'), 'extra.js'))
    const byName = Object.fromEntries(craftInspect(deps()).map((p) => [p.name, p.problem]))
    expect(byName['web-gridcraft']).toBe('no-file')
    expect(byName['web-wordcraft']).toBe('truncated')
    expect(craftWebDir(deps(), 'gridcraft')).toBeNull()
  })
  it('un archivo de la web que desaparece (cuarentena de un antivirus) se detecta por el recuento', async () => {
    webLayout = (dest) => {
      for (const w of Object.values(PIN.web!)) {
        mkdirSync(join(dest, w.dir), { recursive: true })
        writeFileSync(join(dest, w.dir, 'index.html'), 'index')
        writeFileSync(join(dest, w.dir, 'motor.wasm'), 'wasm')
      }
    }
    await installCraft(deps())
    expect(craftWebDir(deps(), 'deckcraft')).not.toBeNull()
    rmSync(join(webDirOf('wordcraft'), 'motor.wasm'))
    clearCraftCheckCache()
    expect(craftInspect(deps()).find((p) => p.name === 'web-wordcraft')?.problem).toBe('truncated')
  })
  it('reinstalar tras un daño repone el binario y el espacio exigido es CRAFT_DISK_FACTOR veces lo que se baja', async () => {
    await installCraft(deps())
    truncateSync(binPath('pkgd', 'deckcraft-cli'), 1)
    await installCraft(deps())
    expect(craftStatus(deps()).state).toBe('installed')
    rmSync(join(dir, 'craft-0.5.0'), { recursive: true })
    await expect(installCraft(deps({ freeBytes: () => TOTAL * CRAFT_DISK_FACTOR - 1 }))).rejects.toMatchObject({ code: 'disk' })
  })
})
