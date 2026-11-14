import { markFreeImagePreview } from './free-image-preview'
import { sniffImage, MAX_IMAGE_PIXELS } from './image-files'
import { normalizeExifJpeg, normalizeWebp } from './free-images-webp'
import { jpegOrientation } from './jpeg-orientation'

export interface FreeImageProcessor {
  normalize(bytes: Buffer, maxEdge: number): Promise<Buffer>
  sheet(images: Buffer[]): Promise<Buffer>
}

/** No window, network or app launch: only Electron's image decoder, loaded when needed. */
export const nativeFreeImageProcessor: FreeImageProcessor = {
  async normalize(bytes, maxEdge) {
    const info = sniffImage(bytes)
    if (!info || info.kind === 'gif' || info.width * info.height > MAX_IMAGE_PIXELS) throw new Error('Imagen inválida o demasiado grande.')
    if (info.kind === 'webp') return normalizeWebp(bytes, maxEdge)
    if (info.kind === 'jpeg' && jpegOrientation(bytes) !== 1) return normalizeExifJpeg(bytes, maxEdge)
    const { nativeImage } = await import('electron')
    let image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error('No se pudo decodificar la imagen.')
    const { width, height } = image.getSize()
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('Demasiados píxeles.')
    if (Math.max(width, height) > maxEdge)
      image = image.resize(width >= height ? { width: maxEdge, quality: 'best' } : { height: maxEdge, quality: 'best' })
    const finalSize = image.getSize()
    const pixels = image.toBitmap()
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3] / 255
      for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.min(255, Math.round(pixels[i + channel] + 255 * (1 - alpha)))
      pixels[i + 3] = 255
    }
    return nativeImage.createFromBitmap(pixels, { ...finalSize, scaleFactor: 1 }).toJPEG(85)
  },
  async sheet(images) {
    const { nativeImage } = await import('electron')
    const width = 1200,
      height = 800,
      cellWidth = 400,
      cellHeight = 400
    const pixels = Buffer.alloc(width * height * 4, 255)
    const digits = ['010111010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111']
    for (let i = 0; i < images.length && i < 6; i++) {
      let image = nativeImage.createFromBuffer(images[i])
      if (image.isEmpty()) throw new Error('Miniatura inválida.')
      const size = image.getSize()
      const scale = Math.min(380 / size.width, 350 / size.height, 1)
      image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
      const { width: w, height: h } = image.getSize()
      const bitmap = image.toBitmap()
      const x = (i % 3) * cellWidth + Math.floor((cellWidth - w) / 2)
      const y = Math.floor(i / 3) * cellHeight + 40 + Math.floor((350 - h) / 2)
      for (let row = 0; row < h; row++) bitmap.copy(pixels, ((y + row) * width + x) * 4, row * w * 4, (row + 1) * w * 4)
      // Raster numerals avoid SVG/HTML and platform font dependencies.
      for (let n = 0; n < 15; n++)
        if (digits[i][n] === '1')
          for (let dy = 0; dy < 5; dy++)
            for (let dx = 0; dx < 5; dx++) {
              const offset =
                ((Math.floor(i / 3) * cellHeight + 8 + Math.floor(n / 3) * 5 + dy) * width + (i % 3) * cellWidth + 15 + (n % 3) * 5 + dx) *
                4
              pixels.fill(30, offset, offset + 3)
            }
    }
    return nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 }).toPNG()
  }
}

/** Visually inspectable, visibly labelled and machine-detectable preview. Only imagenes_usar returns clean pixels. */
export async function protectFreeImagePreview(bytes: Buffer): Promise<Buffer> {
  const { nativeImage } = await import('electron')
  let image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error('Vista previa inválida.')
  let size = image.getSize()
  if (!size.width || !size.height || size.width * size.height > MAX_IMAGE_PIXELS) throw new Error('Vista previa demasiado grande.')
  if (Math.max(size.width, size.height) > 960) {
    image = image.resize(size.width >= size.height ? { width: 960, quality: 'best' } : { height: 960, quality: 'best' })
    size = image.getSize()
  }
  const pixels = image.toBitmap()
  // Small fixed raster alphabet: deterministic on Mac and Windows, no font, SVG, browser or network.
  const glyphs: Record<string, string> = {
    M: '10001110111010110001100011000110001',
    U: '10001100011000110001100011000101110',
    E: '11111100001000011110100001000011111',
    S: '01111100001000001110000010000111110',
    T: '11111001000010000100001000010000100',
    R: '11110100011000111110101001001010001',
    A: '01110100011000111111100011000110001',
    N: '10001110011010110011100011000110001',
    O: '01110100011000110001100011000101110',
    ' ': '00000000000000000000000000000000000'
  }
  const label = 'MUESTRA NO USAR'
  const scale = Math.max(1, Math.min(4, Math.floor(size.width / (label.length * 6 + 4))))
  const labelWidth = label.length * 6 * scale
  const left = Math.max(0, Math.floor((size.width - labelWidth) / 2))
  const top = Math.max(0, Math.floor(size.height / 2 - 3.5 * scale))
  // Translucent stripe leaves the subject inspectable; raster text survives image re-encoding.
  for (let y = Math.max(0, top - 2 * scale); y < Math.min(size.height, top + 9 * scale); y++)
    for (let x = 0; x < size.width; x++) {
      const at = (y * size.width + x) * 4
      for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(pixels[at + c] * 0.45 + 140)
      pixels[at + 3] = 255
    }
  for (let c = 0; c < label.length; c++)
    for (let bit = 0; bit < 35; bit++)
      if (glyphs[label[c]][bit] === '1')
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const x = left + (c * 6 + (bit % 5)) * scale + dx
            const y = top + Math.floor(bit / 5) * scale + dy
            if (x >= size.width || y >= size.height) continue
            const at = (y * size.width + x) * 4
            pixels.fill(30, at, at + 3)
            pixels[at + 3] = 255
          }
  return markFreeImagePreview(nativeImage.createFromBitmap(pixels, { ...size, scaleFactor: 1 }).toJPEG(80))
}
