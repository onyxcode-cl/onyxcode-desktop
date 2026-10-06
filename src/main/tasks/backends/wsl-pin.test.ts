import { describe, expect, it } from 'vitest'
import { compareWslRootfsVersion, isWslRootfsVersion, parseWslPin, wslRootfsUrl } from './wsl-pin'

const good = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: '2026.10.1',
  minVersion: '2026.10.1',
  builtAt: '2026-10-06',
  url: wslRootfsUrl('2026.10.1'),
  sha256: 'a'.repeat(64),
  size: 120_000_000,
  unpackedMax: 943_718_400,
  ...o
})

describe('parseWslPin', () => {
  it('acepta la forma exacta y la url del repo dedicado', () => {
    const p = parseWslPin(good())
    expect(p?.version).toBe('2026.10.1')
    expect(p?.url).toBe('https://github.com/onyxcode-cl/lazunox-wsl/releases/download/rootfs-2026.10.1/lazunox-rootfs-2026.10.1-x64.tar.gz')
  })
  it('acepta minVersion anterior a version', () => {
    expect(parseWslPin(good({ version: '2026.11.15', url: wslRootfsUrl('2026.11.15'), minVersion: '2026.10.1' }))).not.toBeNull()
  })
  it('rechaza lo que no es un objeto', () => {
    for (const bad of [null, undefined, 'x', 3, [], [good()]]) expect(parseWslPin(bad)).toBeNull()
  })
  it('rechaza versiones fuera de YYYY.M.D', () => {
    for (const v of [
      '2026.10',
      '2026.10.1.0',
      '2026.13.1',
      '2026.10.32',
      '2026.0.1',
      '2026.10.0',
      '2026.010.1',
      'v2026.10.1',
      '1.2.3',
      7
    ]) {
      expect(parseWslPin(good({ version: v, minVersion: v, url: wslRootfsUrl(String(v)) }))).toBeNull()
    }
  })
  it('rechaza minVersion > version o inválida', () => {
    expect(parseWslPin(good({ minVersion: '2026.10.2' }))).toBeNull()
    expect(parseWslPin(good({ minVersion: '2026.9.30' }))).not.toBeNull()
    expect(parseWslPin(good({ minVersion: 'x' }))).toBeNull()
    expect(parseWslPin(good({ minVersion: undefined }))).toBeNull()
  })
  it('rechaza una url fuera del repo, de la etiqueta o con otra forma', () => {
    const base = wslRootfsUrl('2026.10.1')
    const bads = [
      base.replace('onyxcode-cl/lazunox-wsl', 'otro/repo'),
      base.replace('rootfs-2026.10.1/', 'rootfs-2026.10.2/'),
      base.replace('-x64.tar.gz', '-x64.tar.gz?x=1'),
      base.replace('https:', 'http:'),
      base.replace('github.com', 'github.com:444'),
      base.replace('https://', 'https://u:p@'),
      base.replace('github.com', 'objects.githubusercontent.com'),
      base + '/',
      base.replace('.tar.gz', '.zip'),
      ''
    ]
    for (const url of bads) expect(parseWslPin(good({ url }))).toBeNull()
    expect(parseWslPin(good({ url: undefined }))).toBeNull()
  })
  it('rechaza sha256 que no sea hex minúscula de 64', () => {
    for (const sha256 of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), '', 5]) {
      expect(parseWslPin(good({ sha256 }))).toBeNull()
    }
  })
  it('rechaza tamaños no enteros, cero, negativos, excesivos o incoherentes', () => {
    for (const size of [0, -1, 1.5, '10', NaN, Infinity, 3 * 1024 ** 3]) expect(parseWslPin(good({ size }))).toBeNull()
    for (const unpackedMax of [0, -5, 2.5, '9', 5 * 1024 ** 3, 100]) expect(parseWslPin(good({ unpackedMax }))).toBeNull()
  })
  it('rechaza builtAt mal formado', () => {
    for (const builtAt of ['2026-13-01', '2026-10-6', '06/10/2026', '', 20261006]) expect(parseWslPin(good({ builtAt }))).toBeNull()
  })
  it('no corrige ni rellena: un campo ausente invalida el pin', () => {
    for (const k of ['version', 'minVersion', 'builtAt', 'url', 'sha256', 'size', 'unpackedMax']) {
      const o = good()
      delete o[k]
      expect(parseWslPin(o)).toBeNull()
    }
  })
})

describe('versiones de la imagen', () => {
  it('compara numéricamente, no como texto', () => {
    expect(compareWslRootfsVersion('2026.10.1', '2026.9.30')).toBeGreaterThan(0)
    expect(compareWslRootfsVersion('2026.9.30', '2026.10.1')).toBeLessThan(0)
    expect(compareWslRootfsVersion('2026.10.1', '2026.10.1')).toBe(0)
    expect(compareWslRootfsVersion('2027.1.1', '2026.12.31')).toBeGreaterThan(0)
    expect(compareWslRootfsVersion('basura', '2026.10.1')).toBeLessThan(0)
  })
  it('valida la forma', () => {
    expect(isWslRootfsVersion('2026.10.1')).toBe(true)
    expect(isWslRootfsVersion('2026.1.31')).toBe(true)
    expect(isWslRootfsVersion('2026.01.1')).toBe(false)
  })
})
