/**
 * Instalación y verificación de `cloudflared` SIN red real: `fetch` es un doble, el `.tgz` se arma en el momento con `tar`/`python3` y
 * `codesign` es un doble (el binario de prueba son bytes cualquiera). Nada de Cloudflare ni de GitHub.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { macOnly } from '../../../test/platform'
import type { AuditInput } from '../audit'
import {
  BinaryError,
  CloudflaredBinary,
  codesignRequirement,
  parseCodesignDetails,
  parsePin,
  pinAgeMonths,
  pinFor,
  realRun,
  readPinFile,
  type CloudflaredPin,
  type FetchLike,
  type PinAsset,
  type RunFile
} from './binary'
import { CLOUDFLARED_PIN } from './pin'

const mit = it.skipIf(!macOnly)
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

let dir = ''
let binDir = ''
const audits: AuditInput[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'onyx-bin-'))
  binDir = join(dir, 'bin')
  audits.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const SIG = { identifier: 'cloudflared', teamId: 'ABCDE12345', authority: 'Developer ID Application: Fake Inc. (ABCDE12345)' }
const BIN = Buffer.from('#!/bin/sh\necho fake-cloudflared\n'.repeat(40))

/** Arma un `.tgz` con python (para poder meter enlaces simbólicos, rutas con `..`, dos archivos…). */
function makeTgz(kind: 'ok' | 'symlink' | 'dotdot' | 'two' | 'subdir' | 'absolute', content: Buffer = BIN): Buffer {
  const out = join(dir, `${kind}.tgz`)
  writeFileSync(join(dir, 'payload'), content)
  const py = `
import tarfile, sys, io
kind, payload, out = sys.argv[1], sys.argv[2], sys.argv[3]
data = open(payload, 'rb').read()
def add(t, name, data=data, link=None):
    i = tarfile.TarInfo(name)
    if link:
        i.type = tarfile.SYMTYPE; i.linkname = link
        t.addfile(i); return
    i.size = len(data); i.mode = 0o755
    t.addfile(i, io.BytesIO(data))
with tarfile.open(out, 'w:gz') as t:
    if kind == 'ok': add(t, 'cloudflared')
    elif kind == 'symlink': add(t, 'cloudflared', link='/etc/passwd')
    elif kind == 'dotdot': add(t, '../cloudflared')
    elif kind == 'two': add(t, 'cloudflared'); add(t, 'extra')
    elif kind == 'subdir': add(t, 'x/cloudflared')
    elif kind == 'absolute': add(t, '/tmp/cloudflared')
`
  execFileSync('python3', ['-c', py, kind, join(dir, 'payload'), out])
  return readFileSync(out)
}

function pinFor1(tgz: Buffer, bin: Buffer = BIN, over: Partial<PinAsset> = {}): CloudflaredPin {
  return {
    version: '2026.9.3',
    releasedAt: '2026-09-24',
    assets: {
      'darwin-arm64': {
        url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-darwin-arm64.tgz',
        size: tgz.length,
        sha256: sha(tgz),
        binSize: bin.length,
        binSha256: sha(bin),
        binMaxSize: 80_000_000,
        signature: SIG,
        ...over
      }
    }
  }
}

const URL0 = 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-darwin-arm64.tgz'
function respond(body: Buffer, init: ResponseInit = {}): Response {
  return new Response(new Uint8Array(body), { status: 200, ...init })
}
function fetchOf(routes: Record<string, () => Response>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetch: async (url) => {
      calls.push(url)
      const r = routes[url]
      if (!r) throw new Error(`sin ruta: ${url}`)
      return r()
    }
  }
}

/** `tar` real y `codesign` de mentira (acepta o rechaza según `signed`). */
function run(signed: boolean | 'wrong-team' = true): { run: RunFile; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    run: async (file, args, opts) => {
      calls.push([file, ...args])
      if (file === '/usr/bin/codesign') {
        if (signed === false) throw new Error('not signed')
        if (args[0] === '-d')
          return {
            stdout: '',
            stderr: `Identifier=cloudflared\nAuthority=${SIG.authority}\nAuthority=Developer ID Certification Authority\nTeamIdentifier=${signed === 'wrong-team' ? 'ZZZZZZZZZZ' : SIG.teamId}\n`
          }
        return { stdout: '', stderr: '' }
      }
      return realRun(file, args, opts)
    }
  }
}

function make(
  tgz: Buffer,
  r: ReturnType<typeof run>,
  f: ReturnType<typeof fetchOf>,
  over: { pin?: CloudflaredPin; allow?: boolean } = {}
): CloudflaredBinary {
  return new CloudflaredBinary({
    pin: over.pin ?? pinFor1(tgz),
    binDir,
    platform: 'darwin',
    arch: 'arm64',
    fetch: f.fetch,
    run: r.run,
    allowDownload: () => over.allow !== false,
    audit: (e) => audits.push(e)
  })
}

describe('pin real (resources/cloudflared/pin.json)', () => {
  it('es válido y guarda los dos hashes y la firma que midió T0', () => {
    expect(CLOUDFLARED_PIN).not.toBeNull()
    const a = pinFor(CLOUDFLARED_PIN, 'darwin', 'arm64') as PinAsset
    expect(CLOUDFLARED_PIN?.version).toBe('2026.9.3')
    expect(a.url).toBe('https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-darwin-arm64.tgz')
    expect(a.size).toBe(19_784_166)
    expect(a.sha256).toBe('587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095')
    expect(a.binSize).toBe(39_380_544)
    expect(a.binSha256).toBe('5472c1a01c84bc31b3021056a73b4e5774ddddefc572124ea8fdf6c340639f32')
    expect(a.signature).toEqual({
      identifier: 'cloudflared',
      teamId: '68WVV388M8',
      authority: 'Developer ID Application: Cloudflare Inc. (68WVV388M8)'
    })
  })
  it('no hay asset para plataformas sin verificar (Windows, x64)', () => {
    expect(pinFor(CLOUDFLARED_PIN, 'win32', 'x64')).toBeNull()
    expect(pinFor(CLOUDFLARED_PIN, 'darwin', 'x64')).toBeNull()
  })
  it('el archivo coincide con lo que carga la app', () => {
    expect(readPinFile(join(__dirname, '../../../../resources/cloudflared/pin.json'))).toEqual(CLOUDFLARED_PIN)
  })
  it('un pin manipulado o incompleto se rechaza entero', () => {
    const good = JSON.parse(JSON.stringify(CLOUDFLARED_PIN)) as { version: string; assets: Record<string, Record<string, unknown>> }
    const mutate = (f: (p: typeof good) => void): unknown => {
      const c = JSON.parse(JSON.stringify(good)) as typeof good
      f(c)
      return parsePin(c)
    }
    expect(mutate(() => undefined)).not.toBeNull()
    expect(mutate((p) => (p.assets['darwin-arm64'].url = 'https://evil.example/cloudflared.tgz'))).toBeNull()
    expect(mutate((p) => (p.assets['darwin-arm64'].url = 'https://github.com/evil/repo/releases/download/2026.9.3/x.tgz'))).toBeNull()
    expect(
      mutate((p) => (p.assets['darwin-arm64'].url = String(p.assets['darwin-arm64'].url).replace('/2026.9.3/', '/2025.1.1/')))
    ).toBeNull()
    expect(mutate((p) => (p.assets['darwin-arm64'].sha256 = 'abc'))).toBeNull()
    expect(mutate((p) => delete p.assets['darwin-arm64'].binSha256)).toBeNull()
    expect(mutate((p) => delete p.assets['darwin-arm64'].signature)).toBeNull()
    expect(mutate((p) => (p.assets['darwin-arm64'].binMaxSize = 10))).toBeNull()
    expect(mutate((p) => (p.version = '1.2'))).toBeNull()
    expect(parsePin(null)).toBeNull()
    expect(parsePin([])).toBeNull()
  })
  it('edad del pin en meses (aviso a los 10)', () => {
    expect(pinAgeMonths(CLOUDFLARED_PIN as CloudflaredPin, Date.parse('2027-07-24T00:00:00Z'))).toBeGreaterThan(9.5)
    expect(pinAgeMonths(CLOUDFLARED_PIN as CloudflaredPin, Date.parse('2026-10-24T00:00:00Z'))).toBeLessThan(2)
  })
})

describe('firma', () => {
  it('el requisito exige identificador, cadena Developer ID y equipo', () => {
    const r = codesignRequirement({ identifier: 'cloudflared', teamId: '68WVV388M8', authority: 'x' })
    expect(r).toContain('identifier "cloudflared"')
    expect(r).toContain('anchor apple generic')
    expect(r).toContain('1.2.840.113635.100.6.1.13')
    expect(r).toContain('subject.OU] = "68WVV388M8"')
  })
  it('lee los detalles de codesign', () => {
    const d = parseCodesignDetails('Identifier=cloudflared\nAuthority=A\nAuthority=B\nTeamIdentifier=68WVV388M8\n')
    expect(d).toEqual({ identifier: 'cloudflared', teamId: '68WVV388M8', authorities: ['A', 'B'] })
  })
  mit(
    'el requisito es sintácticamente válido para codesign (un binario de Apple NO lo cumple, pero no es un error de sintaxis)',
    async () => {
      let msg = ''
      try {
        await realRun('/usr/bin/codesign', [
          '--verify',
          '--strict',
          `-R=${codesignRequirement({ identifier: 'ls', teamId: '68WVV388M8', authority: 'x' })}`,
          '/bin/ls'
        ])
      } catch (e) {
        msg = String((e as { stderr?: string }).stderr)
      }
      expect(msg).toContain('failed to satisfy specified code requirement')
    }
  )
})

describe('instalación', () => {
  mit('sin consentimiento NO hay ninguna petición de red', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(tgz) })
    const b = make(tgz, run(), f)
    await expect(b.install({ consent: false })).rejects.toMatchObject({ code: 'consent' })
    expect(f.calls).toEqual([])
    expect(existsSync(binDir)).toBe(false)
  })

  mit('con allowTravelDownload=false no hay petición', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(tgz) })
    await expect(make(tgz, run(), f, { allow: false }).install({ consent: true })).rejects.toMatchObject({ code: 'policy' })
    expect(f.calls).toEqual([])
  })

  mit('sin asset para la plataforma no hay petición', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({})
    const b = new CloudflaredBinary({ pin: pinFor1(tgz), binDir, platform: 'win32', arch: 'x64', fetch: f.fetch })
    await expect(b.install({ consent: true })).rejects.toMatchObject({ code: 'unsupported' })
    expect(f.calls).toEqual([])
  })

  mit('hash correcto: instala con permisos 0700, firma verificada y auditoría', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(tgz) })
    const r = run()
    const b = make(tgz, r, f)
    const progress: number[] = []
    const path = await b.install({ consent: true, onProgress: (d) => progress.push(d) })
    expect(path).toBe(join(binDir, 'cloudflared-2026.9.3', 'cloudflared'))
    expect(readFileSync(path)).toEqual(BIN)
    expect(lstatSync(path).mode & 0o777).toBe(0o700)
    expect(lstatSync(join(binDir, 'cloudflared-2026.9.3')).mode & 0o777).toBe(0o700)
    expect(lstatSync(binDir).mode & 0o777).toBe(0o700)
    expect(progress.at(-1)).toBe(tgz.length)
    expect(audits).toEqual([{ kind: 'travel-binary-installed', why: '2026.9.3' }])
    expect(r.calls.some((c) => c[0] === '/usr/bin/codesign')).toBe(true)
    // Sin restos de la instalación.
    expect(readdirSync(binDir)).toEqual(['cloudflared-2026.9.3'])
    expect(b.quickState()).toBe('ready')
    expect(await b.verifyInstalled()).toBe('ready')
    expect(await b.ensureReady()).toBe(path)
  })

  mit('hash del .tgz incorrecto: nada se instala, se audita y se borra lo descargado', async () => {
    const tgz = makeTgz('ok')
    const other = Buffer.concat([tgz.subarray(0, tgz.length - 1), Buffer.from([tgz[tgz.length - 1] ^ 1])])
    const f = fetchOf({ [URL0]: () => respond(other) })
    const b = make(tgz, run(), f)
    await expect(b.install({ consent: true })).rejects.toMatchObject({ code: 'bad-hash' })
    expect(audits).toContainEqual({ kind: 'travel-binary-bad-hash' })
    expect(readdirSync(binDir)).toEqual([])
    expect(b.quickState()).toBe('missing')
  })

  mit('descarga más grande que el tamaño del pin: se aborta', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(Buffer.concat([tgz, Buffer.alloc(10)])) })
    await expect(make(tgz, run(), f).install({ consent: true })).rejects.toMatchObject({ code: 'download' })
    expect(readdirSync(binDir)).toEqual([])
  })

  mit('descarga más corta que el pin: hash incorrecto', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(tgz.subarray(0, tgz.length - 5)) })
    await expect(make(tgz, run(), f).install({ consent: true })).rejects.toMatchObject({ code: 'bad-hash' })
  })

  mit('respuesta que no es 200 → error de descarga', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(Buffer.from('nope'), { status: 404 }) })
    await expect(make(tgz, run(), f).install({ consent: true })).rejects.toMatchObject({ code: 'download' })
  })

  mit('redirección a un host permitido se sigue; a uno no permitido, fallo sin pedirlo', async () => {
    const tgz = makeTgz('ok')
    const CDN = 'https://objects.githubusercontent.com/github-production-release-asset/abc?x=1'
    const ok = fetchOf({
      [URL0]: () => new Response(null, { status: 302, headers: { location: CDN } }),
      [CDN]: () => respond(tgz)
    })
    await expect(make(tgz, run(), ok).install({ consent: true })).resolves.toContain('cloudflared-2026.9.3')
    expect(ok.calls).toEqual([URL0, CDN])

    rmSync(binDir, { recursive: true, force: true })
    const EVIL = 'https://evil.example/cloudflared.tgz'
    const bad = fetchOf({ [URL0]: () => new Response(null, { status: 302, headers: { location: EVIL } }), [EVIL]: () => respond(tgz) })
    await expect(make(tgz, run(), bad).install({ consent: true })).rejects.toMatchObject({ code: 'download' })
    expect(bad.calls).toEqual([URL0]) // nunca se pidió el host no permitido
    for (const loc of [
      'http://objects.githubusercontent.com/x',
      'https://objects.githubusercontent.com:8443/x',
      'https://github.com.evil.example/x'
    ])
      expect(
        await make(tgz, run(), fetchOf({ [URL0]: () => new Response(null, { status: 302, headers: { location: loc } }) }))
          .install({ consent: true })
          .catch((e: BinaryError) => e.code)
      ).toBe('download')
  })

  mit('bucle de redirecciones: se corta', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => new Response(null, { status: 302, headers: { location: URL0 } }) })
    await expect(make(tgz, run(), f).install({ consent: true })).rejects.toMatchObject({ code: 'download' })
    expect(f.calls.length).toBeLessThanOrEqual(7)
  })

  for (const kind of ['symlink', 'dotdot', 'two', 'subdir', 'absolute'] as const) {
    mit(`tgz con ${kind}: se rechaza (aunque el hash del .tgz sea el del pin)`, async () => {
      const tgz = makeTgz(kind)
      const f = fetchOf({ [URL0]: () => respond(tgz) })
      await expect(make(tgz, run(), f).install({ consent: true })).rejects.toMatchObject({ code: 'extract' })
      expect(readdirSync(binDir)).toEqual([])
    })
  }

  mit('binario extraído mayor que el tope o con otro hash: se rechaza', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(tgz) })
    const small = pinFor1(tgz, BIN, { binMaxSize: 100, binSize: 100 })
    await expect(make(tgz, run(), f, { pin: small }).install({ consent: true })).rejects.toMatchObject({ code: 'bad-hash' })
    const wrong = pinFor1(tgz, Buffer.from('otro'), {})
    await expect(make(tgz, run(), f, { pin: wrong }).install({ consent: true })).rejects.toMatchObject({ code: 'bad-hash' })
    expect(readdirSync(binDir)).toEqual([])
  })

  mit('firma incorrecta (sin firmar o de otro equipo): no se instala', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(tgz) })
    await expect(make(tgz, run(false), f).install({ consent: true })).rejects.toMatchObject({ code: 'bad-signature' })
    await expect(make(tgz, run('wrong-team'), f).install({ consent: true })).rejects.toMatchObject({ code: 'bad-signature' })
    expect(readdirSync(binDir)).toEqual([])
  })

  mit('dos instalaciones a la vez: la segunda es `busy`', async () => {
    const tgz = makeTgz('ok')
    const f = fetchOf({ [URL0]: () => respond(tgz) })
    const b = make(tgz, run(), f)
    const first = b.install({ consent: true })
    await expect(b.install({ consent: true })).rejects.toMatchObject({ code: 'busy' })
    await first
  })

  mit('instalar la versión nueva borra las viejas', async () => {
    const tgz = makeTgz('ok')
    mkdirSync(join(binDir, 'cloudflared-2025.1.1'), { recursive: true })
    writeFileSync(join(binDir, 'cloudflared-2025.1.1', 'cloudflared'), 'viejo')
    const f = fetchOf({ [URL0]: () => respond(tgz) })
    const b = make(tgz, run(), f)
    expect(b.quickState()).toBe('outdated')
    await b.install({ consent: true })
    expect(readdirSync(binDir)).toEqual(['cloudflared-2026.9.3'])
  })
})

describe('antes de cada arranque', () => {
  async function installed(): Promise<{ b: CloudflaredBinary; path: string; tgz: Buffer }> {
    const tgz = makeTgz('ok')
    const b = make(tgz, run(), fetchOf({ [URL0]: () => respond(tgz) }))
    const path = await b.install({ consent: true })
    audits.length = 0
    return { b, path, tgz }
  }

  mit('re-hash: un binario modificado se borra, se audita y exige reinstalar', async () => {
    const { b, path } = await installed()
    chmodSync(path, 0o700)
    writeFileSync(path, Buffer.concat([BIN.subarray(0, BIN.length - 1), Buffer.from('X')]))
    await expect(b.ensureReady()).rejects.toMatchObject({ code: 'bad-hash' })
    expect(audits).toContainEqual({ kind: 'travel-binary-bad-hash' })
    expect(existsSync(path)).toBe(false)
    expect(b.quickState()).toBe('bad-hash')
  })

  mit('un binario con otro tamaño, sustituido por un enlace o con permisos de escritura ajenos no es fiable', async () => {
    let s = await installed()
    writeFileSync(s.path, 'corto')
    chmodSync(s.path, 0o700)
    expect(await s.b.verifyInstalled()).toBe('bad-hash')
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'onyx-bin-'))
    binDir = join(dir, 'bin')
    s = await installed()
    rmSync(s.path)
    writeFileSync(join(dir, 'elsewhere'), BIN)
    const { symlinkSync } = await import('node:fs')
    symlinkSync(join(dir, 'elsewhere'), s.path)
    expect(await s.b.verifyInstalled()).toBe('bad-hash')
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'onyx-bin-'))
    binDir = join(dir, 'bin')
    s = await installed()
    chmodSync(s.path, 0o722)
    expect(await s.b.verifyInstalled()).toBe('bad-hash')
  })

  mit('firma que ya no vale: se borra y no se ejecuta', async () => {
    const { path, tgz } = await installed()
    const b = make(tgz, run(false), fetchOf({}))
    await expect(b.ensureReady()).rejects.toMatchObject({ code: 'bad-signature' })
    expect(existsSync(path)).toBe(false)
  })

  mit('sin instalar → no-binary; con otra versión → outdated', async () => {
    const tgz = makeTgz('ok')
    const b = make(tgz, run(), fetchOf({}))
    await expect(b.ensureReady()).rejects.toMatchObject({ code: 'no-binary' })
    expect(await b.verifyInstalled()).toBe('missing')
    mkdirSync(join(binDir, 'cloudflared-2025.1.1'), { recursive: true })
    expect(await b.verifyInstalled()).toBe('outdated')
  })

  mit('un binario preinstalado por la organización con el mismo hash sirve sin descargar', async () => {
    const tgz = makeTgz('ok')
    const b = make(tgz, run(), fetchOf({}))
    mkdirSync(join(binDir, 'cloudflared-2026.9.3'), { recursive: true, mode: 0o700 })
    writeFileSync(b.installedPath(), BIN, { mode: 0o700 })
    expect(await b.ensureReady()).toBe(b.installedPath())
  })
})
