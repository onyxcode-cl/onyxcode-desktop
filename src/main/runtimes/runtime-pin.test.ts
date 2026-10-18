import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assetFor, downloadHosts, parseRuntimePin, urlPrefix } from './runtime-pin'

const PIN_PATH = resolve(__dirname, '../../../resources/runtimes/pin.json')
/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = (): Record<string, any> => JSON.parse(readFileSync(PIN_PATH, 'utf8'))

describe('resources/runtimes/pin.json (el único lugar donde se fijan las versiones)', () => {
  it('es válido y trae Node.js y uv para macOS arm64 y Windows x64', () => {
    const pin = parseRuntimePin(raw())
    expect(pin).not.toBeNull()
    for (const id of ['node', 'uv'] as const)
      for (const key of ['darwin-arm64', 'win32-x64']) expect(assetFor(pin, id, ...(key.split('-') as [string, string]))).not.toBeNull()
  })

  it('CADA activo lleva tamaño exacto y SHA-256 (un pin sin huella falla)', () => {
    const r = raw()
    for (const id of ['node', 'uv'])
      for (const [key, a] of Object.entries<any>(r[id].assets)) {
        expect(a.sha256, `${id} ${key}`).toMatch(/^[0-9a-f]{64}$/)
        expect(Number.isSafeInteger(a.size) && a.size > 0, `${id} ${key} tamaño`).toBe(true)
        expect(a.url.startsWith(urlPrefix(id as 'node' | 'uv', r[id].version)), `${id} ${key} url`).toBe(true)
      }
  })

  it('un activo SIN sha256 invalida todo el pin', () => {
    const r = raw()
    delete r.node.assets['darwin-arm64'].sha256
    expect(parseRuntimePin(r)).toBeNull()
    const r2 = raw()
    r2.uv.assets['win32-x64'].sha256 = ''
    expect(parseRuntimePin(r2)).toBeNull()
    const r3 = raw()
    r3.uv.assets['win32-x64'].sha256 = 'A'.repeat(64) // mayúsculas: no es la forma fijada
    expect(parseRuntimePin(r3)).toBeNull()
  })

  it('un activo sin tamaño, con tamaño absurdo o sin límites de descompresión invalida el pin', () => {
    for (const [field, value] of [
      ['size', 0],
      ['size', 9e12],
      ['size', 1.5],
      ['unpackedMax', 0],
      ['maxEntries', undefined]
    ] as const) {
      const r = raw()
      r.node.assets['darwin-arm64'][field] = value
      expect(parseRuntimePin(r), `${field}=${value}`).toBeNull()
    }
  })

  it('solo se admiten las URL oficiales de la versión fijada (otro host, otra versión o http se rechazan)', () => {
    const cases: Array<[string, string, string]> = [
      ['node', 'darwin-arm64', 'https://evil.example/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz'],
      ['node', 'darwin-arm64', 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz'],
      ['node', 'darwin-arm64', 'http://nodejs.org/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz'],
      ['node', 'darwin-arm64', 'https://nodejs.org/dist/v24.22.0/../v1/x.tar.gz'],
      ['uv', 'win32-x64', 'https://github.com/otro/uv/releases/download/0.13.1/uv-x86_64-pc-windows-msvc.zip'],
      ['uv', 'win32-x64', 'https://github.com/astral-sh/uv/releases/download/0.12.0/uv-x86_64-pc-windows-msvc.zip']
    ]
    for (const [id, key, url] of cases) {
      const r = raw()
      r[id].assets[key].url = url
      expect(parseRuntimePin(r), url).toBeNull()
    }
  })

  it('rutas del pin sin «..», absolutas ni barras invertidas', () => {
    for (const bin of ['../node', '/usr/bin/node', 'C:\\node.exe', 'bin\\node']) {
      const r = raw()
      r.node.assets['darwin-arm64'].bin = bin
      expect(parseRuntimePin(r), bin).toBeNull()
    }
  })

  it('el formato debe coincidir con la extensión del archivo', () => {
    const r = raw()
    r.node.assets['darwin-arm64'].format = 'zip'
    expect(parseRuntimePin(r)).toBeNull()
  })

  it('los hosts de descarga: Node solo nodejs.org; uv GitHub y su CDN de releases', () => {
    expect(downloadHosts('node')).toEqual(['nodejs.org'])
    expect(downloadHosts('uv')).toEqual(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'])
  })

  it('el pin viaja en el paquete (asarUnpack) y verify-bundled lo exige', () => {
    const builder = readFileSync(join(__dirname, '../../../electron-builder.js'), 'utf8')
    expect(builder).toContain("'resources/runtimes/**'")
    const vb = readFileSync(join(__dirname, '../../../scripts/verify-bundled.mjs'), 'utf8')
    expect(vb).toContain('resources/runtimes/pin.json')
  })
})
