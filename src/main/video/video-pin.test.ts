import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseVideoPin, videoPlatform } from './video-pin'

const raw = () => JSON.parse(readFileSync(join(__dirname, '../../../resources/video/pin.json'), 'utf8'))
describe('pin de video', () => {
  it('ofrece solo Mac arm64 y Windows x64; ffprobe Windows viene en ffmpeg', () => {
    const p = parseVideoPin(raw())!
    expect(p).not.toBeNull()
    expect(Object.keys(p.chrome.assets)).toEqual(['darwin-arm64', 'win32-x64'])
    expect(p.ffmpeg.assets['win32-x64'].format).toBe('zip')
    expect(Object.keys(p.ffprobe.assets)).toEqual(['darwin-arm64'])
    expect(videoPlatform('darwin', 'arm64')).toBe('darwin-arm64')
    expect(videoPlatform('win32', 'x64')).toBe('win32-x64')
    expect(videoPlatform('linux', 'x64')).toBeNull()
    expect(videoPlatform('darwin', 'x64')).toBeNull()
  })
  it.each([
    ['url', 'https://evil.test/archive.zip'],
    ['url', 'https://storage.googleapis.com@evil.test/archive.zip'],
    ['sha256', ''],
    ['size', 0],
    ['size', 1.5],
    ['bin', '../chrome'],
    ['bin', 'C:/chrome.exe'],
    ['bin', '/chrome'],
    ['format', '7z'],
    ['strip', 10],
    ['unpackedMax', 0],
    ['maxEntries', 0],
    ['extra', true]
  ])('rechaza un activo inválido: %s %s', (field, value) => {
    const p = raw()
    p.chrome.assets['darwin-arm64'][field] = value
    expect(parseVideoPin(p)).toBeNull()
  })
  it('rechaza versiones, plataformas, huellas del lock o tamaños npm ausentes', () => {
    for (const change of [
      (p) => {
        p.chrome.version = '158.0.8127.2'
      },
      (p) => {
        delete p.chrome.assets['win32-x64']
      },
      (p) => {
        p.hyperframes.lockSha256 = 'bad'
      },
      (p) => {
        p.hyperframes.downloadBytes['win32-x64'] = 0
      }
    ] as ((p: ReturnType<typeof raw>) => void)[]) {
      const p = raw()
      change(p)
      expect(parseVideoPin(p)).toBeNull()
    }
  })
})
