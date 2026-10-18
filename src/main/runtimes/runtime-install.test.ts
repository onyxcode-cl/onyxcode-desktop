import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { posixOnly } from '../../test/platform'
import type { FetchLike } from '../remote/tunnel/binary'
import { parseRuntimePin, type RuntimePin } from './runtime-pin'
import {
  RuntimeError,
  appRuntimeBins,
  inspectRuntime,
  installRuntimes,
  removeRuntimes,
  runtimesStatus,
  scopedPath,
  toRuntimeError,
  type RuntimeDeps
} from './runtime-install'

// ---- fixtures: un «Node» y un «uv» de mentira dentro de tar.gz reales ----
function tarHeader(name: string, size: number, type = '0', mode = 0o755): Buffer {
  const b = Buffer.alloc(512)
  const put = (s: string, off: number, len: number): void => void b.write(s.slice(0, len), off, 'latin1')
  put(name, 0, 100)
  put(mode.toString(8).padStart(7, '0') + '\0', 100, 8)
  put('0000000\0', 108, 8)
  put('0000000\0', 116, 8)
  put(size.toString(8).padStart(11, '0') + '\0', 124, 12)
  put('00000000000\0', 136, 12)
  put('        ', 148, 8)
  put(type, 156, 1)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += b[i]!
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return b
}
function makeTgz(files: Array<{ name: string; data: string; mode?: number }>): Buffer {
  const parts: Buffer[] = []
  for (const f of files) {
    const d = Buffer.from(f.data)
    parts.push(tarHeader(f.name, d.length, '0', f.mode), d, Buffer.alloc((512 - (d.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

// Plataforma FIJA de la prueba: el pin solo admite darwin-arm64 y win32-x64, así que no depende del equipo donde corre (el VPS es linux-x64).
const PLAT = 'darwin'
const ARCH = 'arm64'
const NODE_V = '9.8.7'
const UV_V = '1.2.3'
const nodeTgz = makeTgz([
  { name: 'node-v9.8.7-x/bin/node', data: `#!/bin/sh\necho v${NODE_V}\n` },
  { name: 'node-v9.8.7-x/lib/node_modules/npm/bin/npm-cli.js', data: '// npm', mode: 0o644 }
])
const uvTgz = makeTgz([{ name: 'uv-x/uv', data: `#!/bin/sh\necho "uv ${UV_V} (abc 2026-01-01)"\n` }])

function pinFor(over: { node?: Buffer; uv?: Buffer } = {}): RuntimePin {
  const n = over.node ?? nodeTgz
  const u = over.uv ?? uvTgz
  const key = `${PLAT}-${ARCH}`
  const raw = {
    schema: 1,
    fetchedAt: '2026-10-18',
    node: {
      version: NODE_V,
      channel: 'LTS',
      releasedAt: '2026-10-14',
      license: 'MIT',
      source: 'https://nodejs.org/dist/v9.8.7/SHASUMS256.txt',
      assets: {
        [key]: {
          url: `https://nodejs.org/dist/v${NODE_V}/node-v${NODE_V}-x.tar.gz`,
          format: 'tar.gz',
          size: n.length,
          sha256: sha(n),
          strip: 1,
          into: '',
          bin: 'bin/node',
          npmCli: 'lib/node_modules/npm/bin/npm-cli.js',
          unpackedMax: 1_000_000,
          maxEntries: 50
        }
      }
    },
    uv: {
      version: UV_V,
      channel: 'stable',
      releasedAt: '2026-10-14',
      license: 'MIT',
      source: 'https://github.com/astral-sh/uv/releases/tag/1.2.3',
      assets: {
        [key]: {
          url: `https://github.com/astral-sh/uv/releases/download/${UV_V}/uv-x.tar.gz`,
          format: 'tar.gz',
          size: u.length,
          sha256: sha(u),
          strip: 1,
          into: 'bin',
          bin: 'bin/uv',
          unpackedMax: 1_000_000,
          maxEntries: 50
        }
      }
    }
  }
  const pin = parseRuntimePin(raw)
  if (!pin) throw new Error('pin de prueba inválido')
  return pin
}

/** Servidor falso: nodejs.org sirve `node`; github.com redirige al CDN de GitHub, que sirve `uv`. */
function fakeFetch(files: { node: Buffer; uv: Buffer }, seen: string[] = []): FetchLike {
  return async (url) => {
    seen.push(url)
    const u = new URL(url)
    if (u.hostname === 'nodejs.org') return new Response(new Uint8Array(files.node), { status: 200 })
    if (u.hostname === 'github.com')
      return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/x/uv-x.tar.gz?sig=1' } })
    if (u.hostname === 'release-assets.githubusercontent.com') return new Response(new Uint8Array(files.uv), { status: 200 })
    return new Response('no', { status: 404 })
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzx-rt-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const mk = (over: Partial<RuntimeDeps> = {}): RuntimeDeps => ({
  runtimesDir: join(dir, 'runtimes'),
  pin: pinFor(),
  platform: PLAT,
  arch: ARCH,
  fetch: fakeFetch({ node: nodeTgz, uv: uvTgz }),
  freeBytes: async () => 1e12,
  ...over
})

describe.skipIf(!posixOnly)('instalación de Node.js y uv (con archivos de mentira reales)', () => {
  it('descarga, verifica la huella, extrae, ejecuta --version y deja todo en su carpeta', async () => {
    const seen: string[] = []
    const d = mk({ fetch: fakeFetch({ node: nodeTgz, uv: uvTgz }, seen) })
    expect(runtimesStatus(d).ready).toBe(false)
    const progress: string[] = []
    const st = await installRuntimes(d, (p) => progress.push(p.phase))
    expect(st.ready).toBe(true)
    const bins = appRuntimeBins(d)
    expect(bins.node).toBe(join(dir, 'runtimes', `node-${NODE_V}`, 'bin', 'node'))
    expect(bins.npmCli).toBe(join(dir, 'runtimes', `node-${NODE_V}`, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    expect(bins.uv).toBe(join(dir, 'runtimes', `uv-${UV_V}`, 'bin', 'uv'))
    expect(progress).toEqual(expect.arrayContaining(['download', 'extract', 'verify', 'done']))
    // Solo se habló con los hosts de la lista (y la redirección de GitHub a su CDN).
    expect(seen.map((u) => new URL(u).hostname)).toEqual(['nodejs.org', 'github.com', 'release-assets.githubusercontent.com'])
    // Ni temporales ni descargas a medias.
    expect(readdirSync(join(dir, 'runtimes')).sort()).toEqual([`node-${NODE_V}`, `uv-${UV_V}`])
    expect(JSON.parse(readFileSync(join(dir, 'runtimes', `node-${NODE_V}`, '.lazunox-runtime.json'), 'utf8'))).toMatchObject({
      id: 'node',
      version: NODE_V,
      sha256: sha(nodeTgz)
    })
  })

  it('es idempotente: con todo instalado no hay ninguna petición de red', async () => {
    const seen: string[] = []
    const d = mk({ fetch: fakeFetch({ node: nodeTgz, uv: uvTgz }, seen) })
    await installRuntimes(d)
    seen.length = 0
    await installRuntimes(d)
    expect(seen).toEqual([])
  })

  it('repara una instalación dañada (ejecutable truncado) y no repite lo que está bien', async () => {
    const seen: string[] = []
    const d = mk({ fetch: fakeFetch({ node: nodeTgz, uv: uvTgz }, seen) })
    await installRuntimes(d)
    writeFileSync(join(dir, 'runtimes', `uv-${UV_V}`, 'bin', 'uv'), '#!/bin/sh\n')
    expect(inspectRuntime(d, 'uv').state).toBe('broken')
    expect(inspectRuntime(d, 'node').state).toBe('installed')
    seen.length = 0
    const st = await installRuntimes(d)
    expect(st.ready).toBe(true)
    expect(seen.map((u) => new URL(u).hostname)).not.toContain('nodejs.org')
  })

  it('HUELLA INCORRECTA: se borra, no se extrae y NO se ejecuta nada', async () => {
    const tampered = Buffer.from(nodeTgz)
    tampered[tampered.length - 20] ^= 0xff // mismo tamaño, otro contenido
    const run = vi.fn(async () => ({ code: 0, output: '' }))
    const d = mk({ fetch: fakeFetch({ node: tampered, uv: uvTgz }), run })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'hash' })
    expect(run).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'runtimes', `node-${NODE_V}`))).toBe(false)
    expect(readdirSync(join(dir, 'runtimes'))).toEqual([]) // ni .tmp ni .part
  })

  it('TAMAÑO distinto al fijado: rechazado antes de extraer', async () => {
    const bigger = Buffer.concat([nodeTgz, Buffer.from('basura')])
    const d = mk({ fetch: fakeFetch({ node: bigger, uv: uvTgz }) })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'hash' })
    expect(readdirSync(join(dir, 'runtimes'))).toEqual([])
  })

  it('RUTA MALICIOSA dentro del archivo (huella válida): se rechaza, no queda nada fuera ni dentro', async () => {
    const evil = makeTgz([
      { name: 'node-v9.8.7-x/bin/node', data: `#!/bin/sh\necho v${NODE_V}\n` },
      { name: 'node-v9.8.7-x/../../../escapado.txt', data: 'pwned' }
    ])
    const run = vi.fn(async () => ({ code: 0, output: '' }))
    const d = mk({ pin: pinFor({ node: evil }), fetch: fakeFetch({ node: evil, uv: uvTgz }), run })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'unsafe' })
    expect(run).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'escapado.txt'))).toBe(false)
    expect(existsSync(join(dir, 'runtimes', `node-${NODE_V}`))).toBe(false)
    expect(readdirSync(join(dir, 'runtimes'))).toEqual([])
  })

  it('el programa responde otra versión: no se da por bueno', async () => {
    const wrong = makeTgz([
      { name: 'node-v9.8.7-x/bin/node', data: '#!/bin/sh\necho v1.0.0\n' },
      { name: 'node-v9.8.7-x/lib/node_modules/npm/bin/npm-cli.js', data: '// npm', mode: 0o644 }
    ])
    const d = mk({ pin: pinFor({ node: wrong }), fetch: fakeFetch({ node: wrong, uv: uvTgz }) })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'broken' })
    expect(existsSync(join(dir, 'runtimes', `node-${NODE_V}`))).toBe(false)
  })

  it('una redirección a un host fuera de la lista se rechaza (nodejs.org solo sirve desde nodejs.org)', async () => {
    const evilFetch: FetchLike = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/node.tar.gz' } })
    const d = mk({ fetch: evilFetch })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'unsafe' })
    expect(readdirSync(join(dir, 'runtimes'))).toEqual([])
  })

  it('el host de GitHub NO vale para Node (cada runtime tiene su lista)', async () => {
    const f: FetchLike = async (url) =>
      new URL(url).hostname === 'nodejs.org'
        ? new Response(null, { status: 302, headers: { location: 'https://github.com/x/node.tar.gz' } })
        : new Response('no', { status: 404 })
    await expect(installRuntimes(mk({ fetch: f }))).rejects.toMatchObject({ code: 'unsafe' })
  })

  it('F8-B198: huella distinta → «hash» (la descarga no es la esperada) y no se instala nada', async () => {
    const tampered = Buffer.from(nodeTgz)
    tampered[tampered.length - 1] ^= 0xff
    const d = mk({ fetch: fakeFetch({ node: tampered, uv: uvTgz }) })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'hash' })
    expect(readdirSync(join(dir, 'runtimes'))).toEqual([])
  })

  it('F8-B198: disco lleno al guardar (ENOSPC) → «disk», no «download»', async () => {
    const d = mk({
      download: async () => {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      }
    })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'disk' })
    expect(readdirSync(join(dir, 'runtimes'))).toEqual([])
  })

  it('F8-B198: sin permiso de escritura (EACCES) al guardar → «permission»', async () => {
    const d = mk({
      download: async () => {
        throw Object.assign(new Error('EACCES: permission denied, open'), { code: 'EACCES' })
      }
    })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'permission' })
  })

  it('F8-B198: la carpeta de runtimes no se puede crear → falla antes de descargar y NO culpa a la conexión', async () => {
    // Un archivo donde debería ir la carpeta: `mkdir` falla ANTES de descargar nada.
    writeFileSync(join(dir, 'runtimes'), 'x')
    const seen: string[] = []
    const d = mk({ fetch: fakeFetch({ node: nodeTgz, uv: uvTgz }, seen) })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'io' })
    expect(seen).toEqual([])
  })

  it('F8-B198: errores sueltos del sistema de archivos se clasifican por su código', () => {
    const e = (code: string): Error => Object.assign(new Error(code), { code })
    expect(toRuntimeError(e('ENOSPC')).code).toBe('disk')
    expect(toRuntimeError(e('EPERM')).code).toBe('permission')
    expect(toRuntimeError(e('EROFS')).code).toBe('permission')
    expect(toRuntimeError(new Error('raro')).code).toBe('io')
  })

  it('F8-B198: sin conexión → «offline»; el sitio responde mal (404) → «download»', async () => {
    const offline = mk({
      fetch: async () => {
        throw new TypeError('fetch failed')
      }
    })
    await expect(installRuntimes(offline)).rejects.toMatchObject({ code: 'offline' })
    const notFound = mk({ fetch: async () => new Response('no', { status: 404 }) })
    await expect(installRuntimes(notFound)).rejects.toMatchObject({ code: 'download' })
  })

  it('sin red: error «offline» y no queda nada a medias', async () => {
    const d = mk({
      fetch: async () => {
        throw new Error('offline')
      }
    })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'offline' })
    expect(readdirSync(join(dir, 'runtimes'))).toEqual([])
  })

  it('poco disco: avisa antes de descargar nada', async () => {
    const seen: string[] = []
    const d = mk({ fetch: fakeFetch({ node: nodeTgz, uv: uvTgz }, seen), freeBytes: async () => 10 })
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'disk' })
    expect(seen).toEqual([])
  })

  it('cancelar a mitad: «cancelled» y sin restos', async () => {
    const ac = new AbortController()
    const f: FetchLike = async (_url, init) => {
      ac.abort()
      init.signal?.throwIfAborted()
      return new Response(new Uint8Array(nodeTgz), { status: 200 })
    }
    const d = mk({ fetch: f })
    await expect(installRuntimes(d, undefined, ac.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(readdirSync(join(dir, 'runtimes'))).toEqual([])
  })

  it('sin activo para la plataforma: «unsupported»', async () => {
    const raw = JSON.parse(JSON.stringify(pinFor())) as RuntimePin
    for (const id of ['node', 'uv'] as const) {
      const a = raw[id].assets
      raw[id].assets = { 'linux-x64': Object.values(a)[0]! } as never
    }
    const d = mk({ pin: raw, platform: 'darwin', arch: 'arm64' })
    await expect(installRuntimes(d)).rejects.toBeInstanceOf(RuntimeError)
    expect(runtimesStatus(d).unsupported).toBe(true)
  })

  it('quitar borra la carpeta entera y el estado vuelve a «falta»', async () => {
    const d = mk()
    await installRuntimes(d)
    await removeRuntimes(d.runtimesDir)
    expect(existsSync(d.runtimesDir)).toBe(false)
    expect(runtimesStatus(d).node.state).toBe('missing')
  })
})

describe('PATH acotado', () => {
  it('solo la carpeta del runtime y las del sistema; nunca el PATH del usuario', () => {
    const p = scopedPath('darwin', ['/x/runtimes/node-1/bin'])
    expect(p).toBe('/x/runtimes/node-1/bin:/usr/bin:/bin')
    expect(p).not.toContain('homebrew')
  })
})
