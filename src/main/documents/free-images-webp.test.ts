import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { normalizeWebp } from './free-images-webp'
import { sniffImage } from './image-files'

const python = process.env.FREE_IMAGES_TEST_PYTHON
// Opt-in real bundled Pillow; no Electron process or app is launched.
describe.skipIf(!python)('conversor WebP real incluido', () => {
  it('convierte WebP transparente a JPEG, reduce y no amplía', async () => {
    const bytes = await readFile(new URL('./fixtures-free-images/synthetic-transparent.webp', import.meta.url))
    const small = await normalizeWebp(bytes, 100, python)
    expect(sniffImage(small)).toMatchObject({ kind: 'jpeg', width: 100, height: 67 })
    const original = await normalizeWebp(bytes, 1920, python)
    expect(sniffImage(original)).toMatchObject({ kind: 'jpeg', width: 300, height: 200 })
  })
  it('rechaza bytes corruptos y dimensiones solicitadas fuera de límite', async () => {
    await expect(normalizeWebp(Buffer.from('not an image'), 100, python)).rejects.toThrow('convertir')
    await expect(normalizeWebp(Buffer.alloc(0), 99999, python)).rejects.toThrow('Límites')
  })
})
