import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { jpegOrientation } from './jpeg-orientation'

function jpeg(orientation: number, little = true): Buffer {
  const bytes = Buffer.alloc(40)
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0, 34])
  bytes.write('Exif\0\0', 6, 'latin1')
  bytes.write(little ? 'II' : 'MM', 12)
  const u16 = (value: number, offset: number): void => {
    if (little) bytes.writeUInt16LE(value, offset)
    else bytes.writeUInt16BE(value, offset)
  }
  const u32 = (value: number, offset: number): void => {
    if (little) bytes.writeUInt32LE(value, offset)
    else bytes.writeUInt32BE(value, offset)
  }
  u16(42, 14)
  u32(8, 16)
  u16(1, 20)
  u16(0x112, 22)
  u16(3, 24)
  u32(1, 26)
  u16(orientation, 30)
  return bytes
}
describe('orientación JPEG acotada al primer IFD', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('lee orientación %s en ambos órdenes TIFF', (orientation) => {
    expect(jpegOrientation(jpeg(orientation))).toBe(orientation)
    expect(jpegOrientation(jpeg(orientation, false))).toBe(orientation)
  })
  it('no sigue punteros ni lee fuera del segmento EXIF', () => {
    const bytes = jpeg(6)
    for (let n = 0; n < 38; n++) expect(jpegOrientation(bytes.subarray(0, n))).toBe(1)
    for (const value of [0, 0xffff, 0xffffffff]) {
      const invalid = Buffer.from(bytes)
      invalid.writeUInt32LE(value, 16)
      expect(jpegOrientation(invalid)).toBe(1)
    }
    const invalid = Buffer.from(bytes)
    invalid.writeUInt16LE(65535, 20)
    expect(jpegOrientation(invalid)).toBe(1)
    expect(jpegOrientation(jpeg(9))).toBe(1)
    expect(jpegOrientation(Buffer.from('not JPEG'))).toBe(1)
  })
  it('lee una foto sintética con EXIF real', async () => {
    expect(jpegOrientation(await readFile(new URL('./fixtures-free-images/synthetic-exif-6.jpg', import.meta.url)))).toBe(6)
  })
})
