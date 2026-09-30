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
const VERSION = '9.8.7'
const root = mkdtempSync(join(tmpdir(), 'onyx-fetch-'))
let server: Server
let base = ''
let zipBuf: Buffer
let hits: string[] = []

const pinFor = (over: Record<string, unknown> = {}) => ({
  version: VERSION,
  url: `${base}/opencode.zip`,
  sha256: createHash('sha256').update(zipBuf).digest('hex'),
  size: zipBuf.length,
  ...over
})
const silent = () => undefined
const binDirs = (name: string) => join(root, name, 'bin')

beforeAll(async () => {
  if (!isMac) return
  const src = join(root, 'src')
  mkdirSync(src)
  writeFileSync(join(src, 'opencode'), `#!/bin/sh\necho ${VERSION}\n`)
  chmodSync(join(src, 'opencode'), 0o644) // el script debe poner 755
  execFileSync('ditto', ['-c', '-k', src, join(root, 'fixture.zip')])
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

describe.skipIf(!isMac)('fetch-opencode', () => {
  it('SHA correcto: extrae, da permisos 755 y comprueba la versión', async () => {
    const binDir = binDirs('ok')
    const r = await fetcher.fetchOpencode({ pin: pinFor(), binDir, log: silent })
    expect(r).toMatchObject({ status: 'fetched', version: VERSION, path: join(binDir, 'opencode') })
    expect(execFileSync('stat', ['-f', '%Lp', r.path]).toString().trim()).toBe('755')
    expect(readdirSync(binDir)).toEqual(['opencode'])
    expect(readdirSync(join(root, 'ok')).filter((f) => f.startsWith('.fetch-'))).toEqual([])
  })

  it('SHA incorrecto: falla, no extrae y no deja restos', async () => {
    const binDir = binDirs('badsha')
    await expect(fetcher.fetchOpencode({ pin: pinFor({ sha256: 'a'.repeat(64) }), binDir, log: silent })).rejects.toThrow(/SHA-256/)
    expect(existsSync(binDir)).toBe(false)
    expect(readdirSync(join(root, 'badsha'))).toEqual([])
  })

  it('tamaño distinto: falla antes de calcular nada y no extrae', async () => {
    const binDir = binDirs('badsize')
    await expect(fetcher.fetchOpencode({ pin: pinFor({ size: zipBuf.length + 1 }), binDir, log: silent })).rejects.toThrow(/Tamaño/)
    expect(existsSync(binDir)).toBe(false)
    expect(readdirSync(join(root, 'badsize'))).toEqual([])
  })

  it('sigue un redirect 302', async () => {
    const binDir = binDirs('redirect')
    const r = await fetcher.fetchOpencode({ pin: pinFor({ url: `${base}/redirect` }), binDir, log: silent })
    expect(r.status).toBe('fetched')
    expect(hits).toEqual(['/redirect', '/opencode.zip'])
  })

  it('versión distinta a la fijada: falla y no instala el binario', async () => {
    const binDir = binDirs('badver')
    await expect(fetcher.fetchOpencode({ pin: pinFor({ version: '1.0.0' }), binDir, log: silent })).rejects.toThrow(/pin/)
    expect(existsSync(binDir)).toBe(false)
  })

  it('--if-missing: con el binario correcto ya presente no vuelve a descargar', async () => {
    const binDir = binDirs('ifmissing')
    await fetcher.fetchOpencode({ pin: pinFor(), binDir, log: silent })
    hits = []
    const r = await fetcher.fetchOpencode({ pin: pinFor(), binDir, ifMissing: true, log: silent })
    expect(r.status).toBe('present')
    expect(hits).toEqual([])
    // sin --if-missing sí descarga de nuevo
    expect((await fetcher.fetchOpencode({ pin: pinFor(), binDir, log: silent })).status).toBe('fetched')
    expect(hits).toEqual(['/opencode.zip'])
  })

  it('sin red (servidor inexistente): error explícito y sin restos', async () => {
    const binDir = binDirs('nonet')
    await expect(fetcher.fetchOpencode({ pin: pinFor({ url: 'http://127.0.0.1:1/x.zip' }), binDir, log: silent })).rejects.toThrow(
      /No se pudo descargar/
    )
    expect(readdirSync(join(root, 'nonet'))).toEqual([])
  })

  it('readPin acepta el pin real del repo', () => {
    expect(fetcher.readPin().version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
