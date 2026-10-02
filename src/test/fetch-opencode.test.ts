/**
 * Pruebas de scripts/fetch-opencode.mjs contra un servidor http LOCAL con un ZIP de fixture (un
 * script sh falso que imprime una versión). Sin red real y sin el binario real de OpenCode.
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
import * as fetcher from '../../scripts/fetch-opencode.mjs'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'
const supported = isMac || isWin
/** Nombre del ejecutable de fixture según la plataforma. */
const EXE = isWin ? 'opencode.exe' : 'opencode'
const VERSION = '9.8.7'
const root = mkdtempSync(join(tmpdir(), 'onyx-fetch-'))
let server: Server
let base = ''
let zipBuf: Buffer
let hits: string[] = []

const pinFor = (over: Record<string, unknown> = {}) => {
  const { version, ...assetOver } = over
  return {
    version: (version as string | undefined) ?? VERSION,
    assets: {
      [`${process.platform}-${process.arch}`]: {
        url: `${base}/opencode.zip`,
        sha256: createHash('sha256').update(zipBuf).digest('hex'),
        size: zipBuf.length,
        ...assetOver
      }
    }
  }
}
const silent = () => undefined
/** En Windows el fixture no es ejecutable: la versión se simula (en macOS se ejecuta el script real). */
const fetchOpts = (binDir: string) => ({ binDir, log: silent, ...(isWin ? { versionOf: async () => VERSION } : {}) })
const binDirs = (name: string) => join(root, name, 'bin')

beforeAll(async () => {
  if (!supported) return
  const src = join(root, 'src')
  mkdirSync(src)
  if (isMac) {
    writeFileSync(join(src, EXE), `#!/bin/sh\necho ${VERSION}\n`)
    chmodSync(join(src, EXE), 0o644) // el script debe poner 755
    execFileSync('ditto', ['-c', '-k', src, join(root, 'fixture.zip')])
  } else {
    writeFileSync(join(src, EXE), 'MZ fake')
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    execFileSync(tar, ['-a', '-cf', join(root, 'fixture.zip'), '-C', src, EXE])
  }
  zipBuf = readFileSync(join(root, 'fixture.zip'))
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/opencode.zip' })
      res.end()
    } else if (req.url === '/opencode.zip') {
      res.writeHead(200, { 'content-length': zipBuf.length })
      res.end(zipBuf)
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

describe.skipIf(!supported)('fetch-opencode', () => {
  it('SHA correcto: extrae, da permisos 755 y comprueba la versión', async () => {
    const binDir = binDirs('ok')
    const r = await fetcher.fetchOpencode({ pin: pinFor(), ...fetchOpts(binDir) })
    expect(r).toMatchObject({ status: 'fetched', version: VERSION, path: join(binDir, EXE) })
    if (isMac) expect(execFileSync('stat', ['-f', '%Lp', r.path]).toString().trim()).toBe('755')
    expect(readdirSync(binDir)).toEqual([EXE])
    expect(readdirSync(join(root, 'ok')).filter((f) => f.startsWith('.fetch-'))).toEqual([])
  })

  it('SHA incorrecto: falla, no extrae y no deja restos', async () => {
    const binDir = binDirs('badsha')
    await expect(fetcher.fetchOpencode({ pin: pinFor({ sha256: 'a'.repeat(64) }), ...fetchOpts(binDir) })).rejects.toThrow(/SHA-256/)
    expect(existsSync(binDir)).toBe(false)
    expect(readdirSync(join(root, 'badsha'))).toEqual([])
  })

  it('tamaño distinto: falla antes de calcular nada y no extrae', async () => {
    const binDir = binDirs('badsize')
    await expect(fetcher.fetchOpencode({ pin: pinFor({ size: zipBuf.length + 1 }), ...fetchOpts(binDir) })).rejects.toThrow(/Tamaño/)
    expect(existsSync(binDir)).toBe(false)
    expect(readdirSync(join(root, 'badsize'))).toEqual([])
  })

  it('sigue un redirect 302', async () => {
    const binDir = binDirs('redirect')
    const r = await fetcher.fetchOpencode({ pin: pinFor({ url: `${base}/redirect` }), ...fetchOpts(binDir) })
    expect(r.status).toBe('fetched')
    expect(hits).toEqual(['/redirect', '/opencode.zip'])
  })

  it('versión distinta a la fijada: falla y no instala el binario', async () => {
    const binDir = binDirs('badver')
    await expect(fetcher.fetchOpencode({ pin: pinFor({ version: '1.0.0' }), ...fetchOpts(binDir) })).rejects.toThrow(/pin/)
    expect(existsSync(binDir)).toBe(false)
  })

  it('--if-missing: con el binario correcto ya presente no vuelve a descargar', async () => {
    const binDir = binDirs('ifmissing')
    await fetcher.fetchOpencode({ pin: pinFor(), ...fetchOpts(binDir) })
    hits = []
    const r = await fetcher.fetchOpencode({ pin: pinFor(), ...fetchOpts(binDir), ifMissing: true })
    expect(r.status).toBe('present')
    expect(hits).toEqual([])
    // sin --if-missing sí descarga de nuevo
    expect((await fetcher.fetchOpencode({ pin: pinFor(), ...fetchOpts(binDir) })).status).toBe('fetched')
    expect(hits).toEqual(['/opencode.zip'])
  })

  it('sin red (servidor inexistente): error explícito y sin restos', async () => {
    const binDir = binDirs('nonet')
    await expect(fetcher.fetchOpencode({ pin: pinFor({ url: 'http://127.0.0.1:1/x.zip' }), ...fetchOpts(binDir) })).rejects.toThrow(
      /No se pudo descargar/
    )
    expect(readdirSync(join(root, 'nonet'))).toEqual([])
  })

  it('plataforma sin asset fijado: error claro y nada que descargar', async () => {
    const binDir = binDirs('noasset')
    await expect(fetcher.fetchOpencode({ pin: pinFor(), binDir, log: silent, key: 'linux-s390x' })).rejects.toThrow(
      /No hay binario.*linux-s390x/
    )
    expect(hits).toEqual([])
  })
})

// Sin fixture ni ejecutables: corre en todas las plataformas (también Linux).
describe('fetch-opencode (puro)', () => {
  it('readPin acepta el pin real del repo con assets darwin-arm64 y win32-x64', () => {
    const pin = fetcher.readPin()
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(fetcher.assetFor(pin, 'darwin-arm64').url).toMatch(/opencode-darwin-arm64\.zip$/)
    const win = fetcher.assetFor(pin, 'win32-x64')
    expect(win.url).toMatch(/opencode-windows-x64\.zip$/)
    expect(win.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('nombre del binario y clave de plataforma', () => {
    expect(fetcher.binaryName('win32')).toBe('opencode.exe')
    expect(fetcher.binaryName('darwin')).toBe('opencode')
    expect(fetcher.platformKey('win32', 'x64')).toBe('win32-x64')
  })

  it('el ZIP se extrae con ditto en macOS y con tar.exe de System32 en Windows', () => {
    expect(fetcher.unzipCommand('darwin', '/a.zip', '/d')).toEqual(['ditto', ['-x', '-k', '/a.zip', '/d']])
    const [cmd, args] = fetcher.unzipCommand('win32', 'a.zip', 'd')
    expect(cmd).toMatch(/System32[\\/]tar\.exe$/)
    expect(args).toEqual(['-xf', 'a.zip', '-C', 'd'])
    expect(() => fetcher.unzipCommand('linux', 'a', 'b')).toThrow()
  })

  it('assetFor lanza para una plataforma sin asset', () => {
    expect(() => fetcher.assetFor({ version: '1.0.0', assets: {} }, 'linux-x64')).toThrow(/No hay binario/)
  })
})
