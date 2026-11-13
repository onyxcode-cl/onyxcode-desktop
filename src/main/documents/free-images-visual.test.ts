import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  bitmap: Buffer.alloc(16),
  width: 2,
  height: 2,
  captured: Buffer.alloc(0),
  size: { width: 0, height: 0 }
}))
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: state.width, height: state.height }),
      toBitmap: () => Buffer.from(state.bitmap),
      resize: () => ({ getSize: () => ({ width: 2, height: 2 }), toBitmap: () => Buffer.from(state.bitmap) })
    }),
    createFromBitmap: (bytes: Buffer, size: { width: number; height: number }) => {
      state.captured = Buffer.from(bytes)
      state.size = size
      return { toJPEG: () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]), toPNG: () => Buffer.from('encoded PNG') }
    }
  }
}))
import { nativeFreeImageProcessor, protectFreeImagePreview } from './free-images-visual'
import { isFreeImagePreview } from './free-image-preview'
function png(): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(2, 16)
  bytes.writeUInt32BE(2, 20)
  return bytes
}
beforeEach(() => {
  state.bitmap = Buffer.from([64, 0, 0, 128, 64, 0, 0, 128, 64, 0, 0, 128, 64, 0, 0, 128])
  state.width = 2
  state.height = 2
  state.captured = Buffer.alloc(0)
})
describe('composición raster sin abrir Electron', () => {
  it('entrega una muestra marcada en los píxeles y en sus bytes, conservando la imagen original en RAM', async () => {
    state.width = 400
    state.height = 200
    state.bitmap = Buffer.alloc(400 * 200 * 4, 200)
    const original = Buffer.from(state.bitmap)
    const preview = await protectFreeImagePreview(png())
    expect(isFreeImagePreview(preview)).toBe(true)
    expect(state.bitmap).toEqual(original)
    expect(state.size).toMatchObject({ width: 400, height: 200 })
    expect(state.captured.subarray(0, 400 * 4)).toEqual(original.subarray(0, 400 * 4))
    const center = state.captured.subarray(90 * 400 * 4, 110 * 400 * 4)
    expect(center.includes(30)).toBe(true)
    expect(center.equals(original.subarray(90 * 400 * 4, 110 * 400 * 4))).toBe(false)
  })

  it('aplana BGRA premultiplicado sobre blanco sin multiplicar alfa otra vez', async () => {
    await nativeFreeImageProcessor.normalize(png(), 100)
    expect([...state.captured.subarray(0, 4)]).toEqual([191, 127, 127, 255])
    expect(state.size).toMatchObject({ width: 2, height: 2 })
  })
  it('compone seis casillas con números raster distintos y dimensiones fijas', async () => {
    state.bitmap.fill(240)
    await nativeFreeImageProcessor.sheet(Array.from({ length: 6 }, () => png()))
    expect(state.size).toMatchObject({ width: 1200, height: 800 })
    const digits = []
    for (let i = 0; i < 6; i++) {
      let mask = ''
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 3; x++)
          mask += state.captured[((Math.floor(i / 3) * 400 + 8 + y * 5) * 1200 + (i % 3) * 400 + 15 + x * 5) * 4] === 30 ? '1' : '0'
      digits.push(mask)
      expect(state.captured[((Math.floor(i / 3) * 400 + 214) * 1200 + (i % 3) * 400 + 199) * 4]).toBe(240)
    }
    expect(new Set(digits).size).toBe(6)
    expect(digits[0]).toBe('010111010010111')
  })
})
