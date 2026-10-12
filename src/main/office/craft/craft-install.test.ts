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
  assets: {
    'darwin-arm64': {
      url: 'https://github.com/storytold/deckcraft/releases/download/v0.5.0/x.zip',
      size: BYTES.length,
      sha256: sha,
      bin: 'pkg/deckcraft-cli',
      signature: { teamId: 'DJ6XS33FX8', authority: 'Developer ID Application: Learning Machines LLC (DJ6XS33FX8)' }
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
        mkdirSync(join(dest, 'pkg'), { recursive: true })
        writeFileSync(join(dest, 'pkg', 'deckcraft-cli'), 'bin')
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

describe('pin de Craft', () => {
  it('el pin real del repo es válido y firma el equipo esperado', () => {
    const pin = loadCraftPin(join(__dirname, '../../../../resources/craft/pin.json'))
    expect(pin?.assets['darwin-arm64'].signature.teamId).toBe('DJ6XS33FX8')
    expect(pin?.assets['darwin-arm64'].url.startsWith('https://github.com/storytold/deckcraft/releases/download/')).toBe(true)
  })
  it.each([
    [null],
    [{ version: '1', assets: {} }],
    [{ ...PIN, assets: { a: { ...PIN.assets['darwin-arm64'], url: 'https://evil.example/x.zip' } } }],
    [{ ...PIN, assets: { a: { ...PIN.assets['darwin-arm64'], sha256: 'abc' } } }],
    [{ ...PIN, assets: { a: { ...PIN.assets['darwin-arm64'], bin: '../../bin/sh' } } }],
    [{ ...PIN, assets: { a: { ...PIN.assets['darwin-arm64'], bin: '/bin/sh' } } }],
    [{ ...PIN, assets: { a: { ...PIN.assets['darwin-arm64'], signature: { teamId: 'x', authority: '' } } } }]
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
    const bin = await installCraft(deps())
    expect(existsSync(bin)).toBe(true)
    expect(readFileSync(bin, 'utf8')).toBe('bin')
    expect(craftStatus(deps()).state).toBe('installed')
    let calls = 0
    await installCraft(deps({ fetch: async () => (calls++, new Response('x')) }))
    expect(calls).toBe(0)
  })
  it('SHA-256 distinto → se descarta y no se instala', async () => {
    const bad = deps({ pin: { ...PIN, assets: { 'darwin-arm64': { ...PIN.assets['darwin-arm64'], sha256: '0'.repeat(64) } } } })
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
