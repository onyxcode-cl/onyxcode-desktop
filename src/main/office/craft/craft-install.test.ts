import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { craftStatus, installCraft, loadCraftPin, parseCraftPin, removeCraft, type CraftDeps, type CraftPin } from './craft-install'
import type { RunFile } from '../libreoffice'

const BYTES = Buffer.from('zip-falso-para-prueba')
const sha = createHash('sha256').update(BYTES).digest('hex')
const PIN: CraftPin = {
  version: '0.5.0',
  tools: {
    deckcraft: {
      'darwin-arm64': {
        url: 'https://github.com/storytold/deckcraft/releases/download/v0.5.0/x.zip',
        size: BYTES.length,
        sha256: sha,
        bin: 'pkgd/deckcraft-cli',
        signature: { teamId: 'DJ6XS33FX8', authority: 'Developer ID Application: Learning Machines LLC (DJ6XS33FX8)' }
      }
    },
    wordcraft: {
      'darwin-arm64': {
        url: 'https://github.com/storytold/wordcraft/releases/download/v0.5.0/x.zip',
        size: BYTES.length,
        sha256: sha,
        bin: 'pkgw/wordcraft-cli',
        signature: { teamId: 'DJ6XS33FX8', authority: 'Developer ID Application: Learning Machines LLC (DJ6XS33FX8)' }
      }
    }
  }
}
const okFetch = (): CraftDeps['fetch'] => async () =>
  new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.length) } })

/** `ditto` falso que crea el binario donde el zip dice; `codesign` falso con el equipo que se le pida. */
const fakeRun =
  (team = 'DJ6XS33FX8', verifyCode = 0, extract = true): RunFile =>
  async (file, args) => {
    if (file.endsWith('ditto')) {
      if (extract) {
        const dest = args[args.length - 1]
        for (const [top, exe] of [
          ['pkgd', 'deckcraft-cli'],
          ['pkgw', 'wordcraft-cli']
        ]) {
          mkdirSync(join(dest, top), { recursive: true })
          writeFileSync(join(dest, top, exe), 'bin')
        }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args[0] === '--verify') return { code: verifyCode, stdout: '', stderr: verifyCode ? 'invalid' : '' }
    return { code: 0, stdout: '', stderr: `TeamIdentifier=${team}\n` }
  }

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

const D0 = PIN.tools.deckcraft['darwin-arm64']
const withDeck = (patch: object): unknown => ({ ...PIN, tools: { ...PIN.tools, deckcraft: { 'darwin-arm64': { ...D0, ...patch } } } })

describe('pin de Craft', () => {
  it('el pin real del repo es válido: dos programas firmados por el equipo esperado y descargas solo de sus repositorios', () => {
    const pin = loadCraftPin(join(__dirname, '../../../../resources/craft/pin.json'))
    expect(Object.keys(pin?.tools ?? {})).toEqual(['deckcraft', 'wordcraft'])
    for (const [name, assets] of Object.entries(pin!.tools)) {
      for (const a of Object.values(assets)) {
        expect(a.signature.teamId).toBe('DJ6XS33FX8')
        expect(a.url.startsWith(`https://github.com/storytold/${name}/releases/download/`)).toBe(true)
      }
    }
  })
  it.each([
    [null],
    [{ version: '1', tools: {} }],
    [{ version: '0.5.0', tools: {} }],
    [withDeck({ url: 'https://evil.example/x.zip' })],
    [withDeck({ url: 'https://github.com/otro/repo/releases/download/v1/x.zip' })],
    [withDeck({ sha256: 'abc' })],
    [withDeck({ bin: '../../bin/sh' })],
    [withDeck({ bin: '/bin/sh' })],
    [withDeck({ signature: { teamId: 'x', authority: '' } })]
  ])('rechaza pines inválidos (%#)', (raw) => {
    expect(parseCraftPin(raw)).toBeNull()
  })
})

describe('instalación de Craft', () => {
  it('en otra plataforma no está soportado', () => {
    expect(craftStatus(deps({ platform: 'win32' })).state).toBe('unsupported')
  })
  it('descarga, verifica e instala; luego queda «installed» sin volver a descargar', async () => {
    expect(craftStatus(deps()).state).toBe('missing')
    const bins = await installCraft(deps())
    expect(Object.keys(bins).sort()).toEqual(['deckcraft', 'wordcraft'])
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
    const bad = deps({ pin: withDeck({ sha256: '0'.repeat(64) }) as CraftPin })
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

describe('varios programas', () => {
  it('si ya está uno, solo baja el que falta y el tamaño que se muestra es el del faltante', async () => {
    const urls: string[] = []
    const f: CraftDeps['fetch'] = async (u) => (
      urls.push(u),
      new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.length) } })
    )
    await installCraft(deps({ fetch: f }))
    expect(urls).toHaveLength(2)
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
    writeFileSync(join(base, 'installed.json'), '{}')
    expect(craftStatus(deps())).toMatchObject({ state: 'missing', sizeBytes: BYTES.length })
  })
  it('el progreso suma los dos archivos', async () => {
    const seen: number[] = []
    await installCraft(deps(), (p) => p.total && seen.push(p.total))
    expect(new Set(seen)).toEqual(new Set([BYTES.length * 2]))
  })
})
