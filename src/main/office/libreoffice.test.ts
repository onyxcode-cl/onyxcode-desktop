import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  OfficeError,
  downloadVerified,
  installLibreOffice,
  loadOfficePin,
  officeStatus,
  parseOfficePin,
  parseTeamId,
  type FetchLike,
  type OfficeDeps,
  type OfficePin,
  type RunFile
} from './libreoffice'

const BYTES = Buffer.from('contenido-simulado-del-instalador'.repeat(50))
const SHA = createHash('sha256').update(BYTES).digest('hex')
const TEAM = 'ABCDE12345'
const PIN: OfficePin = {
  version: '9.9.9',
  assets: {
    'darwin-arm64': {
      url: 'https://download.documentfoundation.org/libreoffice/stable/9.9.9/mac/aarch64/x.dmg',
      size: BYTES.length,
      sha256: SHA,
      signature: { teamId: TEAM, authority: 'Developer ID Application: Test' }
    }
  }
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lo-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const okFetch =
  (bytes: Buffer = BYTES, headers: Record<string, string> = {}): FetchLike =>
  async () =>
    new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.length), ...headers } })

/** `run` simulado: `hdiutil attach` crea LibreOffice.app dentro del punto de montaje y `ditto` la copia de verdad. */
function fakeRun(opts: { team?: string; verifyFails?: boolean; calls?: string[] } = {}): RunFile {
  return async (file, args) => {
    opts.calls?.push(`${file.split('/').pop()} ${args[0]}`)
    if (file.endsWith('hdiutil') && args[0] === 'attach') {
      const mnt = args[args.indexOf('-mountpoint') + 1]
      const exe = join(mnt, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
      mkdirSync(dirname(exe), { recursive: true })
      writeFileSync(exe, '#!/bin/sh\n')
      return { code: 0, stdout: '', stderr: '' }
    }
    if (file.endsWith('ditto')) {
      const exe = join(args[1], 'Contents', 'MacOS', 'soffice')
      mkdirSync(dirname(exe), { recursive: true })
      writeFileSync(exe, readFileSync(join(args[0], 'Contents', 'MacOS', 'soffice')))
      return { code: 0, stdout: '', stderr: '' }
    }
    if (file.endsWith('codesign') && args[0] === '--verify') {
      return opts.verifyFails ? { code: 1, stdout: '', stderr: 'invalid signature' } : { code: 0, stdout: '', stderr: '' }
    }
    if (file.endsWith('codesign') && args[0] === '-dvv') return { code: 0, stdout: '', stderr: `TeamIdentifier=${opts.team ?? TEAM}\n` }
    return { code: 0, stdout: '', stderr: '' }
  }
}

const deps = (extra: Partial<OfficeDeps> = {}): OfficeDeps => ({
  binDir: join(dir, 'bin'),
  pin: PIN,
  platform: 'darwin',
  arch: 'arm64',
  fetch: okFetch(),
  run: fakeRun(),
  systemApp: join(dir, 'NoExiste.app'),
  freeBytes: () => 10e9,
  ...extra
})

describe('pin de LibreOffice', () => {
  it('el pin real del repositorio es válido y cubre arm64 y x64', () => {
    const pin = loadOfficePin(join(process.cwd(), 'resources', 'libreoffice', 'pin.json'))
    expect(pin).not.toBeNull()
    expect(Object.keys(pin!.assets).sort()).toEqual(['darwin-arm64', 'darwin-x64'])
    for (const a of Object.values(pin!.assets)) {
      expect(a.url.startsWith('https://download.documentfoundation.org/')).toBe(true)
      expect(a.signature.teamId).toBe('7P5S3ZLCN7')
    }
  })
  it('rechaza pins sospechosos', () => {
    const bad = (mut: (a: Record<string, unknown>) => void): unknown => {
      const copy = JSON.parse(JSON.stringify(PIN)) as { assets: Record<string, Record<string, unknown>> }
      mut(copy.assets['darwin-arm64'])
      return parseOfficePin(copy)
    }
    expect(bad((a) => (a.url = 'http://download.documentfoundation.org/x.dmg'))).toBeNull()
    expect(bad((a) => (a.url = 'https://evil.example/x.dmg'))).toBeNull()
    expect(bad((a) => (a.sha256 = 'abc'))).toBeNull()
    expect(bad((a) => (a.size = 0))).toBeNull()
    expect(bad((a) => (a.signature = { teamId: 'x' }))).toBeNull()
    expect(parseOfficePin(null)).toBeNull()
  })
})

describe('estado', () => {
  it('missing con el tamaño; installed (app) tras instalar; usa la del sistema si existe', async () => {
    expect(officeStatus(deps())).toEqual({ state: 'missing', version: '9.9.9', sizeBytes: BYTES.length })
    const exe = await installLibreOffice(deps())
    expect(exe.replace(/\\/g, '/').endsWith('Contents/MacOS/soffice')).toBe(true)
    expect(officeStatus(deps())).toMatchObject({ state: 'installed', source: 'app', version: '9.9.9' })
    const sys = join(dir, 'Sys.app')
    mkdirSync(join(sys, 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(join(sys, 'Contents', 'MacOS', 'soffice'), '')
    expect(officeStatus(deps({ binDir: join(dir, 'otra'), systemApp: sys }))).toMatchObject({ state: 'installed', source: 'system' })
  })
  it('Windows: usa el LibreOffice del sistema si existe', () => {
    const soffice = join(dir, 'soffice.exe')
    writeFileSync(soffice, '')
    expect(officeStatus(deps({ platform: 'win32', systemApp: soffice }))).toMatchObject({ state: 'installed', source: 'system', soffice })
  })

  it('fuera de macOS: unsupported', () => {
    expect(officeStatus(deps({ platform: 'win32', systemApp: join(dir, 'no-existe.exe') })).state).toBe('unsupported')
  })
})

describe('descarga verificada', () => {
  it('sigue redirecciones https hasta el espejo', async () => {
    let n = 0
    const f: FetchLike = async (url) => {
      n++
      return n === 1
        ? new Response(null, { status: 302, headers: { location: 'https://espejo.example/pub/x.dmg' } })
        : (expect(url).toBe('https://espejo.example/pub/x.dmg'), okFetch()(url, { redirect: 'manual' }))
    }
    const dest = join(dir, 'a.dmg')
    await downloadVerified(f, PIN.assets['darwin-arm64'].url, dest, { size: BYTES.length, sha256: SHA }, () => undefined)
    expect(readFileSync(dest).equals(BYTES)).toBe(true)
  })
  it('rechaza una redirección a http', async () => {
    const f: FetchLike = async () => new Response(null, { status: 302, headers: { location: 'http://espejo.example/x.dmg' } })
    await expect(
      downloadVerified(f, PIN.assets['darwin-arm64'].url, join(dir, 'a'), { size: 1, sha256: SHA }, () => undefined)
    ).rejects.toMatchObject({ code: 'download' })
  })
  it('rechaza hash distinto, tamaño distinto y descarga más larga que lo declarado, y no deja archivos', async () => {
    const dest = join(dir, 'b.dmg')
    const tampered = Buffer.from(BYTES)
    tampered[3] ^= 0xff
    await expect(
      downloadVerified(okFetch(tampered), 'https://x/y', dest, { size: BYTES.length, sha256: SHA }, () => undefined)
    ).rejects.toMatchObject({ code: 'hash' })
    expect(existsSync(dest)).toBe(false)
    await expect(
      downloadVerified(okFetch(BYTES.subarray(0, 100)), 'https://x/y', dest, { size: BYTES.length, sha256: SHA }, () => undefined)
    ).rejects.toMatchObject({ code: 'size' })
    expect(existsSync(dest)).toBe(false)
    const long = Buffer.concat([BYTES, Buffer.from('extra')])
    await expect(
      downloadVerified(
        okFetch(long, { 'content-length': String(BYTES.length) }),
        'https://x/y',
        dest,
        { size: BYTES.length, sha256: SHA },
        () => undefined
      )
    ).rejects.toMatchObject({ code: 'size' })
  })
})

describe('instalación', () => {
  it('orden exacto: monta, verifica la imagen, copia, verifica la copia y desmonta', async () => {
    const calls: string[] = []
    await installLibreOffice(deps({ run: fakeRun({ calls }) }))
    const shape = calls.map((c) => (c.startsWith('ditto') ? 'ditto' : c))
    expect(shape).toEqual([
      'hdiutil attach',
      'codesign --verify',
      'codesign -dvv',
      'ditto',
      'codesign --verify',
      'codesign -dvv',
      'hdiutil detach'
    ])
  })
  it('firma de otro equipo: no instala, desmonta y no deja residuos', async () => {
    const calls: string[] = []
    const d = deps({ run: fakeRun({ team: 'ZZZZZZZZZZ', calls }) })
    await expect(installLibreOffice(d)).rejects.toMatchObject({ code: 'signature' })
    expect(calls.at(-1)).toBe('hdiutil detach')
    expect(officeStatus(d).state).toBe('missing')
    expect(readdirSync(d.binDir)).toEqual([])
  })
  it('firma inválida: no instala', async () => {
    await expect(installLibreOffice(deps({ run: fakeRun({ verifyFails: true }) }))).rejects.toMatchObject({ code: 'signature' })
  })
  it('hash incorrecto: nunca llega a montar la imagen', async () => {
    const calls: string[] = []
    const tampered = Buffer.from(BYTES)
    tampered[0] ^= 0xff
    await expect(installLibreOffice(deps({ fetch: okFetch(tampered), run: fakeRun({ calls }) }))).rejects.toBeInstanceOf(OfficeError)
    expect(calls).toEqual([])
  })
  it('sin espacio: falla antes de descargar', async () => {
    let fetched = false
    const f: FetchLike = async () => ((fetched = true), okFetch()('', { redirect: 'manual' }))
    await expect(installLibreOffice(deps({ fetch: f, freeBytes: () => 10 }))).rejects.toMatchObject({ code: 'disk' })
    expect(fetched).toBe(false)
  })
  it('cancelar la descarga lo deja todo limpio', async () => {
    const ac = new AbortController()
    ac.abort()
    const f: FetchLike = async (_u, init) => {
      if (init.signal?.aborted) throw new Error('aborted')
      return okFetch()('', init)
    }
    await expect(installLibreOffice(deps({ fetch: f }), () => undefined, ac.signal)).rejects.toMatchObject({ code: 'cancelled' })
  })
})

describe('utilidades', () => {
  it('lee el equipo de codesign -dvv', () => {
    expect(parseTeamId('Authority=X\nTeamIdentifier=7P5S3ZLCN7\n')).toBe('7P5S3ZLCN7')
    expect(parseTeamId('TeamIdentifier=not set')).toBeNull()
  })
})
