import { sniffImage, MAX_IMAGE_PIXELS } from './image-files'
import { normalizeWebp } from './free-images-webp'

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
