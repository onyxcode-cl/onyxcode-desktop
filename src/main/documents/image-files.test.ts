import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES } from './input-path'
import { prepareImages, sniffImage, MAX_IMAGE_PIXELS } from './image-files'
import { markFreeImagePreview, isFreeImagePreview } from './free-image-preview'
import { setPrivateTmpBase } from '../office/craft/private-tmp'

/** PNG de 2×3 píxeles (cabecera mínima: firma + IHDR; alcanza para leer el tamaño). */
export const png = (w = 2, h = 3): Buffer => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}
const gif = (w = 5, h = 4): Buffer => {
  const b = Buffer.alloc(13)
  b.write('GIF89a', 0, 'latin1')
  b.writeUInt16LE(w, 6)
  b.writeUInt16LE(h, 8)
  return b
}
const jpeg = (w = 640, h = 480): Buffer =>
  Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    0x01,
    0x01,
    0x11,
    0x00
  ])
const webpVp8x = (w = 100, h = 50): Buffer => {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1')
  b.write('WEBP', 8, 'latin1')
  b.write('VP8X', 12, 'latin1')
  b.writeUIntLE(w - 1, 24, 3)
  b.writeUIntLE(h - 1, 27, 3)
  return b
}

describe('sniffImage: tipo y tamaño por los bytes, no por el nombre', () => {
  it('mantiene tamaño JPEG con comentario de muestra y reconoce copias renombradas', async () => {
    const preview = markFreeImagePreview(jpeg(640, 480))
    expect(sniffImage(preview)).toMatchObject({ kind: 'jpeg', width: 640, height: 480 })
    expect(isFreeImagePreview(preview)).toBe(true)
    await expect(
      prepareImages('/unused', ['renombrada.jpg'], [], async () => ({
        bytes: preview,
        abs: '/unused/renombrada.jpg',
        rel: 'renombrada.jpg',
        tipo: 'pdf'
      }))
    ).rejects.toThrow(/vista previa.*imagenes_usar/)
  })

  it('PNG, GIF, JPEG y WebP', () => {
    expect(sniffImage(png(2, 3))).toMatchObject({ kind: 'png', mime: 'image/png', ext: 'png', width: 2, height: 3 })
    expect(sniffImage(gif(5, 4))).toMatchObject({ kind: 'gif', width: 5, height: 4 })
    expect(sniffImage(jpeg(640, 480))).toMatchObject({ kind: 'jpeg', ext: 'jpg', width: 640, height: 480 })
    expect(sniffImage(webpVp8x(100, 50))).toMatchObject({ kind: 'webp', width: 100, height: 50 })
  })
  it('lo que no es imagen o está truncado da null', () => {
    expect(sniffImage(Buffer.from('%PDF-1.7 hola'))).toBeNull()
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImage(Buffer.from('MZ\u0090\u0000'))).toBeNull()
    expect(sniffImage(png().subarray(0, 12))).toBeNull()
    expect(sniffImage(Buffer.alloc(0))).toBeNull()
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull()
  })
  it('un PNG con dimensión cero no vale', () => {
    expect(sniffImage(png(0, 5))).toBeNull()
  })
})

describe('prepareImages: seguridad de la lectura', () => {
  let root: string
  let tmpBase: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lzx-img-root-'))
    tmpBase = mkdtempSync(join(tmpdir(), 'lzx-img-tmp-'))
    setPrivateTmpBase(tmpBase)
    mkdirSync(join(root, 'img'))
  })
  afterEach(() => {
    setPrivateTmpBase(null)
    rmSync(root, { recursive: true, force: true })
    rmSync(tmpBase, { recursive: true, force: true })
  })
  const put = (rel: string, bytes: Buffer): void => writeFileSync(join(root, rel), bytes)

  it('una imagen buena se copia a un temporal propio (con la extensión de su FIRMA) y la original no se toca', async () => {
    put('img/foto.png', png(10, 20))
    const { images, cleanup } = await prepareImages(root, ['img/foto.png'])
    const r = images.get('img/foto.png')!
    expect(r).toMatchObject({ kind: 'png', width: 10, height: 20 })
    expect(r.file.startsWith(tmpBase)).toBe(true)
    expect(r.file.startsWith(root)).toBe(false)
    expect(existsSync(r.file)).toBe(true)
    await cleanup()
    expect(existsSync(r.file)).toBe(false)
  })

  it('un JPEG guardado como .png se acepta por su firma y la copia se llama .jpg', async () => {
    put('img/mentira.png', jpeg())
    const { images, cleanup } = await prepareImages(root, ['img/mentira.png'])
    expect(images.get('img/mentira.png')!.file.endsWith('.jpg')).toBe(true)
    await cleanup()
  })

  it.each([
    ['ruta con ..', '../fuera.png'],
    ['ruta con .. en medio', 'img/../../fuera.png'],
    ['ruta absoluta', '/etc/passwd.png'],
    ['ruta absoluta de Windows', 'C:\\Windows\\x.png'],
    ['con ~', '~/foto.png'],
    ['sin extensión de imagen', 'img/notas.txt'],
    ['un script con extensión de imagen que no existe', 'img/no-existe.png']
  ])('rechaza: %s', async (_n, rel) => {
    await expect(prepareImages(root, [rel])).rejects.toThrow()
    expect(readdirSync(tmpBase)).toEqual([]) // no deja nada en disco
  })

  it('un archivo que NO es imagen (aunque se llame .png) se rechaza', async () => {
    put('img/falsa.png', Buffer.from('%PDF-1.7 esto no es una imagen'))
    await expect(prepareImages(root, ['img/falsa.png'])).rejects.toThrow(/no es una imagen/)
    expect(readdirSync(tmpBase)).toEqual([])
  })

  it('un SVG (puede traer scripts) se rechaza', async () => {
    put('img/logo.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))
    await expect(prepareImages(root, ['img/logo.png'])).rejects.toThrow(/no es una imagen/)
  })

  it('una imagen de más de 5 MB se rechaza', async () => {
    put('img/enorme.png', Buffer.concat([png(), Buffer.alloc(MAX_IMAGE_BYTES)]))
    await expect(prepareImages(root, ['img/enorme.png'])).rejects.toThrow(/demasiado grande/)
  })

  it('demasiados píxeles (bomba de descompresión) se rechaza', async () => {
    put('img/bomba.png', png(8000, Math.ceil(MAX_IMAGE_PIXELS / 8000) + 1))
    await expect(prepareImages(root, ['img/bomba.png'])).rejects.toThrow(/demasiados píxeles/)
  })

  it('un enlace simbólico al archivo o a una carpeta de fuera se rechaza', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'lzx-img-out-'))
    try {
      writeFileSync(join(outside, 'secreto.png'), png())
      symlinkSync(join(outside, 'secreto.png'), join(root, 'img', 'enlace.png'))
      await expect(prepareImages(root, ['img/enlace.png'])).rejects.toThrow(/enlace/)
      symlinkSync(outside, join(root, 'carpeta-enlace'))
      await expect(prepareImages(root, ['carpeta-enlace/secreto.png'])).rejects.toThrow()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('más de 10 imágenes se rechaza antes de leer nada', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `img/${i}.png`)
    await expect(prepareImages(root, many)).rejects.toThrow(/Demasiadas imágenes/)
  })

  it('si la tercera imagen es mala, las dos primeras copias también se borran', async () => {
    put('img/a.png', png())
    put('img/b.png', png())
    put('img/c.png', Buffer.from('nada'))
    await expect(prepareImages(root, ['img/a.png', 'img/b.png', 'img/c.png'])).rejects.toThrow()
    expect(readdirSync(tmpBase)).toEqual([])
  })

  it('sin rutas no crea nada', async () => {
    const p = await prepareImages(root, [])
    expect(p.images.size).toBe(0)
    expect(readdirSync(tmpBase)).toEqual([])
    await p.cleanup()
  })
})
