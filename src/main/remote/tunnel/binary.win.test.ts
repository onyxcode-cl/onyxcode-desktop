/**
 * Instalación y verificación de `cloudflared` para WINDOWS con plataforma inyectada (sin red, sin PowerShell ni Windows real): el `.exe`
 * es un archivo cualquiera, `fetch` y `powershell.exe` son dobles. Lo que NO se ha probado en un Windows real está en
 * docs/REMOTO-WINDOWS.md (Authenticode real, Defender/SmartScreen, ACL de `userData\bin`).
 */
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuditInput } from '../audit'
import {
  BinaryError,
  CloudflaredBinary,
  parsePin,
  pinFor,
  type CloudflaredPin,
  type FetchLike,
  type PinAsset,
  type RunFile
} from './binary'
import { CLOUDFLARED_PIN } from './pin'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const EXE = Buffer.from('MZ-fake-cloudflared-exe\n'.repeat(60))
const SUBJECT = 'CN=Cloudflare, Inc., O=Cloudflare, Inc., L=San Francisco, S=California, C=US'
const URL_EXE = 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-windows-amd64.exe'

let dir = ''
let binDir = ''
const audits: AuditInput[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-binw-'))
  binDir = join(dir, 'bin')
  audits.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function winAsset(over: Partial<PinAsset> = {}, exe: Buffer = EXE): PinAsset {
  return {
    url: URL_EXE,
    size: exe.length,
    sha256: sha(exe),
    binSize: exe.length,
    binSha256: sha(exe),
    binMaxSize: 80_000_000,
    signature: { subject: SUBJECT },
    ...over
  }
}
const pinWin = (over: Partial<PinAsset> = {}, exe: Buffer = EXE): CloudflaredPin => ({
  version: '2026.9.3',
  releasedAt: '2026-09-24',
  assets: { 'win32-x64': winAsset(over, exe) }
})

const respond = (body: Buffer): Response => new Response(new Uint8Array(body), { status: 200 })
function fetchOf(body: Buffer = EXE): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetch: async (url) => {
      calls.push(url)
      if (url !== URL_EXE) throw new Error(`sin ruta: ${url}`)
      return respond(body)
    }
  }
}

/** `powershell.exe` de mentira: devuelve lo que se le pida. */
function ps(result: { Status: string; Subject: string } | 'throws' | 'garbage' = { Status: 'Valid', Subject: SUBJECT }): {
  run: RunFile
  calls: string[][]
} {
  const calls: string[][] = []
  return {
    calls,
    run: async (file, args) => {
      calls.push([file, ...args])
      if (result === 'throws') throw new Error('powershell no disponible')
      if (result === 'garbage') return { stdout: 'no es json', stderr: '' }
      return { stdout: JSON.stringify(result), stderr: '' }
    }
  }
}

function make(
  r: ReturnType<typeof ps>,
  f: ReturnType<typeof fetchOf>,
  o: { pin?: CloudflaredPin; dir?: string; allow?: boolean } = {}
): CloudflaredBinary {
  return new CloudflaredBinary({
    pin: o.pin ?? pinWin(),
    binDir: o.dir ?? binDir,
    platform: 'win32',
    arch: 'x64',
    fetch: f.fetch,
    run: r.run,
    systemRoot: 'C:\\Windows',
    allowDownload: () => o.allow !== false,
    audit: (e) => audits.push(e)
  })
}

describe('pin de Windows (forma)', () => {
  it('el pin real todavía NO trae Windows: el modo viaje allí queda «unsupported» (falla cerrado)', () => {
    expect(pinFor(CLOUDFLARED_PIN, 'win32', 'x64')).toBeNull()
  })
  it('acepta un asset `.exe` bien formado', () => {
    expect(parsePin(pinWin())?.assets['win32-x64']?.signature).toEqual({ subject: SUBJECT })
  })
  it('rechaza lo mal formado (hash o tamaño distintos del exe, url .tgz, sin sujeto, sujeto con control)', () => {
    expect(parsePin(pinWin({ binSha256: 'a'.repeat(64) }))).toBeNull()
    expect(parsePin(pinWin({ binSize: EXE.length - 1 }))).toBeNull()
    expect(parsePin(pinWin({ url: URL_EXE.replace('.exe', '.tgz') }))).toBeNull()
    expect(parsePin(pinWin({ url: 'https://evil.example/cloudflared.exe' }))).toBeNull()
    expect(parsePin(pinWin({ signature: {} as never }))).toBeNull()
    expect(parsePin(pinWin({ signature: { subject: 'CN=x\u0000' } }))).toBeNull()
    expect(
      parsePin(pinWin({ signature: { identifier: 'cloudflared', teamId: 'ABCDE12345', authority: 'x (ABCDE12345)' } as never }))
    ).toBeNull()
  })
  it('un asset de macOS con url `.exe` sigue rechazado', () => {
    const p = JSON.parse(JSON.stringify(CLOUDFLARED_PIN)) as { assets: Record<string, { url: string }> }
    p.assets['darwin-arm64'].url = p.assets['darwin-arm64'].url.replace('.tgz', '.exe')
    expect(parsePin(p)).toBeNull()
  })
})

describe('instalación en Windows', () => {
  it('sin consentimiento o con la política cerrada no hay ninguna petición', async () => {
    const f = fetchOf()
    await expect(make(ps(), f).install({ consent: false })).rejects.toMatchObject({ code: 'consent' })
    await expect(make(ps(), f, { allow: false }).install({ consent: true })).rejects.toMatchObject({ code: 'policy' })
    expect(f.calls).toEqual([])
  })

  it('sin asset de Windows en el pin no hay petición (unsupported)', async () => {
    const f = fetchOf()
    const b = new CloudflaredBinary({ pin: CLOUDFLARED_PIN, binDir, platform: 'win32', arch: 'x64', fetch: f.fetch })
    await expect(b.install({ consent: true })).rejects.toMatchObject({ code: 'unsupported' })
    await expect(b.ensureReady()).rejects.toMatchObject({ code: 'unsupported' })
    expect(f.calls).toEqual([])
  })

  it('descarga el .exe, verifica hash y Authenticode y lo deja en cloudflared-<v>\\cloudflared.exe sin llamar a tar', async () => {
    const f = fetchOf()
    const r = ps()
    const b = make(r, f)
    const path = await b.install({ consent: true })
    expect(path).toBe(join(binDir, 'cloudflared-2026.9.3', 'cloudflared.exe'))
    expect(readFileSync(path)).toEqual(EXE)
    expect(f.calls).toEqual([URL_EXE])
    expect(r.calls).toHaveLength(1)
    const [file, ...args] = r.calls[0] as string[]
    expect(file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'])
    expect(args[5]).toContain('Get-AuthenticodeSignature -LiteralPath')
    expect(r.calls.flat().some((x) => x.includes('tar'))).toBe(false)
    expect(readdirSync(binDir)).toEqual(['cloudflared-2026.9.3']) // sin restos
    expect(audits).toEqual([{ kind: 'travel-binary-installed', why: '2026.9.3' }])
    expect(b.quickState()).toBe('ready')
    expect(await b.verifyInstalled()).toBe('ready')
    expect(await b.ensureReady()).toBe(path)
  })

  it('una comilla simple en la ruta se escapa (sin inyección en el script de PowerShell)', async () => {
    const odd = join(dir, "O'Brien; calc", 'bin')
    const r = ps()
    await make(r, fetchOf(), { dir: odd }).install({ consent: true })
    const script = (r.calls[0] as string[])[6] as string
    expect(script).toContain("O''Brien; calc")
    expect(script).not.toMatch(/-LiteralPath '[^']*O'Brien/)
  })

  it.each([
    ['estado distinto de Valid', { Status: 'HashMismatch', Subject: SUBJECT }],
    ['sujeto distinto', { Status: 'Valid', Subject: 'CN=Otra Empresa' }],
    ['sin firmante', { Status: 'NotSigned', Subject: '' }],
    ['powershell falla', 'throws' as const],
    ['salida que no es JSON', 'garbage' as const]
  ])('firma no válida (%s): no se instala nada y se informa bad-signature', async (_n, result) => {
    const b = make(ps(result), fetchOf())
    await expect(b.install({ consent: true })).rejects.toMatchObject({ code: 'bad-signature' })
    expect(audits).toEqual([{ kind: 'travel-binary-bad-hash' }])
    expect(existsSync(join(binDir, 'cloudflared-2026.9.3'))).toBe(false)
    expect(readdirSync(binDir)).toEqual([])
  })

  it('un .exe con otro contenido (hash distinto) se rechaza antes de la firma', async () => {
    const r = ps()
    const other = Buffer.from('X'.repeat(EXE.length))
    await expect(make(r, fetchOf(other)).install({ consent: true })).rejects.toMatchObject({ code: 'bad-hash' })
    expect(r.calls).toEqual([])
    expect(readdirSync(binDir)).toEqual([])
  })

  it('un redirect a un host fuera de la lista cerrada se rechaza (misma lista que en macOS)', async () => {
    const f: FetchLike = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/c.exe' } })
    await expect(make(ps(), { fetch: f, calls: [] }).install({ consent: true })).rejects.toBeInstanceOf(BinaryError)
  })
})

describe('antes de cada arranque en Windows', () => {
  async function installed(): Promise<{ b: CloudflaredBinary; path: string; r: ReturnType<typeof ps> }> {
    const r = ps()
    const b = make(r, fetchOf())
    const path = await b.install({ consent: true })
    return { b, path, r }
  }
  it('el bit de escritura de grupo/otros NO cuenta (NTFS no tiene 0022); el hash sí', async () => {
    const { b, path } = await installed()
    chmodSync(path, 0o777)
    expect(await b.verifyInstalled()).toBe('ready')
    writeFileSync(path, Buffer.concat([EXE.subarray(0, EXE.length - 1), Buffer.from('Z')]))
    expect(await b.verifyInstalled()).toBe('bad-hash')
    expect(existsSync(path)).toBe(false) // lo que no casa se borra
  })
  it('ensureReady vuelve a comprobar Authenticode en cada arranque y, si falla, borra el binario', async () => {
    const { b, path } = await installed()
    const bad = new CloudflaredBinary({
      pin: pinWin(),
      binDir,
      platform: 'win32',
      arch: 'x64',
      run: ps({ Status: 'UnknownError', Subject: SUBJECT }).run,
      systemRoot: 'C:\\Windows'
    })
    await expect(bad.ensureReady()).rejects.toMatchObject({ code: 'bad-signature' })
    expect(existsSync(path)).toBe(false)
    expect(b.quickState()).toBe('missing')
  })
})
