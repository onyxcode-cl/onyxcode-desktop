/**
 * Pruebas de scripts/fetch-ripgrep.mjs contra un servidor http LOCAL con un .tar.gz de fixture (un script sh falso que imprime una
 * versión, con la misma estructura que el release oficial: `ripgrep-<versión>-<triple>/rg`). Sin red real y sin el `rg` real.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// @ts-expect-error: script .mjs sin tipos (no forma parte de los tsconfig)
import * as fetcher from '../../scripts/fetch-ripgrep.mjs'

const supported = process.platform === 'darwin' || process.platform === 'linux'
const VERSION = '9.8.7'
const ARCHIVE = `ripgrep-${VERSION}-aarch64-apple-darwin.tar.gz`
const root = mkdtempSync(join(tmpdir(), 'lazunox-fetch-rg-'))
let server: Server
let base = ''
let buf: Buffer
let hits: string[] = []

const pinFor = (over: Record<string, unknown> = {}) => {
  const { version, ...assetOver } = over
  return {
    version: (version as string | undefined) ?? VERSION,
    assets: {
      [`${process.platform}-${process.arch}`]: {
        url: `${base}/${ARCHIVE}`,
        sha256: createHash('sha256').update(buf).digest('hex'),
        size: buf.length,
        ...assetOver
      }
    }
  }
}
const silent = () => undefined
const binDirs = (name: string) => join(root, name, 'bin')

beforeAll(async () => {
  if (!supported) return
  const src = join(root, 'src')
  const top = join(src, `ripgrep-${VERSION}-aarch64-apple-darwin`)
  mkdirSync(top, { recursive: true })
  writeFileSync(join(top, 'rg'), `#!/bin/sh\necho "ripgrep ${VERSION} (rev falso)"\n`)
  chmodSync(join(top, 'rg'), 0o644) // el script debe poner 755
  writeFileSync(join(top, 'README.md'), 'no debe extraerse')
  execFileSync('tar', ['-czf', join(root, 'fixture.tar.gz'), '-C', src, `ripgrep-${VERSION}-aarch64-apple-darwin`])
  buf = readFileSync(join(root, 'fixture.tar.gz'))
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === `/redirect/${ARCHIVE}`) {
      res.writeHead(302, { location: `/${ARCHIVE}` })
      res.end()
    } else if (req.url === `/${ARCHIVE}`) {
      res.writeHead(200, { 'content-length': buf.length })
      res.end(buf)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server?.close()
  rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  hits = []
})

describe.skipIf(!supported)('fetch-ripgrep', () => {
  it('SHA correcto: extrae SOLO rg, da permisos 755 y comprueba la versión', async () => {
    const binDir = binDirs('ok')
    const r = await fetcher.fetchRipgrep({ pin: pinFor(), binDir, log: silent })
    expect(r).toMatchObject({ status: 'fetched', version: VERSION, path: join(binDir, 'rg') })
    expect(
      execFileSync('stat', [process.platform === 'darwin' ? '-f' : '-c', process.platform === 'darwin' ? '%Lp' : '%a', r.path])
        .toString()
        .trim()
    ).toBe('755')
    expect(readdirSync(binDir).sort()).toEqual(['.pin-sha256', 'rg'])
    expect(readFileSync(join(binDir, '.pin-sha256'), 'utf8').trim()).toBe(createHash('sha256').update(buf).digest('hex'))
    expect(readdirSync(join(root, 'ok')).filter((f) => f.startsWith('.fetch-'))).toEqual([])
  })

  it('SHA incorrecto: falla, no extrae y no deja restos', async () => {
    const binDir = binDirs('badsha')
    await expect(fetcher.fetchRipgrep({ pin: pinFor({ sha256: 'a'.repeat(64) }), binDir, log: silent })).rejects.toThrow(/SHA-256/)
    expect(existsSync(binDir)).toBe(false)
    expect(readdirSync(join(root, 'badsha'))).toEqual([])
  })

  it('tamaño distinto: falla antes de calcular nada y no extrae', async () => {
    const binDir = binDirs('badsize')
    await expect(fetcher.fetchRipgrep({ pin: pinFor({ size: buf.length + 1 }), binDir, log: silent })).rejects.toThrow(/Tamaño/)
    expect(existsSync(binDir)).toBe(false)
    expect(readdirSync(join(root, 'badsize'))).toEqual([])
  })

  it('versión distinta a la fijada: falla y no instala el binario', async () => {
    const binDir = binDirs('badver')
    await expect(fetcher.fetchRipgrep({ pin: pinFor({ version: '1.0.0' }), binDir, log: silent })).rejects.toThrow(/pin/)
    expect(existsSync(binDir)).toBe(false)
  })

  it('--if-missing: con el binario correcto ya presente no vuelve a descargar', async () => {
    const binDir = binDirs('ifmissing')
    await fetcher.fetchRipgrep({ pin: pinFor(), binDir, log: silent })
    hits = []
    const r = await fetcher.fetchRipgrep({ pin: pinFor(), binDir, log: silent, ifMissing: true })
    expect(r.status).toBe('present')
    expect(hits).toEqual([])
    // sin --if-missing sí descarga de nuevo
    expect((await fetcher.fetchRipgrep({ pin: pinFor(), binDir, log: silent })).status).toBe('fetched')
    expect(hits).toEqual([`/${ARCHIVE}`])
  })

  it('--if-missing: sin huella, con otra huella o con otra versión se vuelve a descargar; con la huella buena se da por bueno', async () => {
    const binDir = binDirs('otrobin')
    await fetcher.fetchRipgrep({ pin: pinFor(), binDir, log: silent })
    writeFileSync(join(binDir, '.pin-sha256'), 'f'.repeat(64) + '\n')
    hits = []
    expect((await fetcher.fetchRipgrep({ pin: pinFor(), binDir, log: silent, ifMissing: true })).status).toBe('fetched')
    expect(hits).toEqual([`/${ARCHIVE}`])
    expect((await fetcher.fetchRipgrep({ pin: pinFor(), binDir, log: silent, ifMissing: true })).status).toBe('present')
    rmSync(join(binDir, '.pin-sha256'))
    expect((await fetcher.fetchRipgrep({ pin: pinFor(), binDir, log: silent, ifMissing: true })).status).toBe('fetched')
    // el binario existente dice 9.8.7 pero el pin pide otra versión: falla en la verificación (el archivo de fixture dice 9.8.7)
    await expect(fetcher.fetchRipgrep({ pin: pinFor({ version: '9.9.9' }), binDir, log: silent, ifMissing: true })).rejects.toThrow(/pin/)
  })

  it('sin red (servidor inexistente): error explícito y sin restos', async () => {
    const binDir = binDirs('nonet')
    await expect(fetcher.fetchRipgrep({ pin: pinFor({ url: `http://127.0.0.1:1/${ARCHIVE}` }), binDir, log: silent })).rejects.toThrow(
      /No se pudo descargar/
    )
    expect(readdirSync(join(root, 'nonet'))).toEqual([])
  })

  it('sigue un redirect 302', async () => {
    const binDir = binDirs('redirect')
    const r = await fetcher.fetchRipgrep({ pin: pinFor({ url: `${base}/redirect/${ARCHIVE}` }), binDir, log: silent })
    expect(r.status).toBe('fetched')
    expect(hits).toEqual([`/redirect/${ARCHIVE}`, `/${ARCHIVE}`])
  })

  it('plataforma sin asset fijado: error claro y nada que descargar', async () => {
    await expect(fetcher.fetchRipgrep({ pin: pinFor(), binDir: binDirs('noasset'), log: silent, key: 'linux-s390x' })).rejects.toThrow(
      /No hay binario de ripgrep.*linux-s390x/
    )
    expect(hits).toEqual([])
  })
})

// Sin fixture ni ejecutables: corre en todas las plataformas.
describe('fetch-ripgrep (puro)', () => {
  it('el pin real fija ripgrep 15.1.0 del release oficial para macOS, Windows y Linux, con tamaño y SHA-256', () => {
    const pin = fetcher.readPin()
    expect(pin.version).toBe('15.1.0')
    const files: Record<string, RegExp> = {
      'darwin-arm64': /ripgrep-15\.1\.0-aarch64-apple-darwin\.tar\.gz$/,
      'win32-x64': /ripgrep-15\.1\.0-x86_64-pc-windows-msvc\.zip$/,
      'linux-x64': /ripgrep-15\.1\.0-x86_64-unknown-linux-musl\.tar\.gz$/
    }
    for (const [key, re] of Object.entries(files)) {
      const a = fetcher.assetFor(pin, key)
      expect(a.url).toMatch(re)
      expect(a.url.startsWith('https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/')).toBe(true)
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(a.size).toBeGreaterThan(1_000_000)
      expect(a.size).toBeLessThan(5_000_000)
    }
  })

  it('nombre del binario, clave de plataforma y carpeta raíz del archivo', () => {
    expect(fetcher.binaryName('win32')).toBe('rg.exe')
    expect(fetcher.binaryName('darwin')).toBe('rg')
    expect(fetcher.platformKey('win32', 'x64')).toBe('win32-x64')
    expect(fetcher.archiveRoot('https://x/y/ripgrep-15.1.0-aarch64-apple-darwin.tar.gz')).toBe('ripgrep-15.1.0-aarch64-apple-darwin')
    expect(fetcher.archiveRoot('https://x/y/ripgrep-15.1.0-x86_64-pc-windows-msvc.zip')).toBe('ripgrep-15.1.0-x86_64-pc-windows-msvc')
    expect(() => fetcher.archiveRoot('https://x/y/otra-cosa.tar.gz')).toThrow(/inesperado/)
  })

  it('solo se extrae el ejecutable: tar en macOS y tar.exe de System32 en Windows', () => {
    expect(fetcher.extractCommand('darwin', '/a.tgz', '/d', 'r/rg')).toEqual(['/usr/bin/tar', ['-xf', '/a.tgz', '-C', '/d', 'r/rg']])
    const [cmd, args] = fetcher.extractCommand('win32', 'a.zip', 'd', 'r/rg.exe')
    expect(cmd).toMatch(/System32[\\/]tar\.exe$/)
    expect(args).toEqual(['-xf', 'a.zip', '-C', 'd', 'r/rg.exe'])
    expect(() => fetcher.extractCommand('freebsd', 'a', 'b', 'c')).toThrow()
  })

  it('assetFor lanza para una plataforma sin asset', () => {
    expect(() => fetcher.assetFor({ version: '1.0.0', assets: {} }, 'linux-x64')).toThrow(/No hay binario/)
  })
})
