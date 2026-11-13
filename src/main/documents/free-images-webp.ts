import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { privateTmp } from '../office/craft/private-tmp'
import { sniffImage } from './image-files'

/** Fixed code, bytes on stdin, bounded stdout. No script or path from the model is executed. */
const SCRIPT = `import io, sys, warnings
from PIL import Image, ImageOps
Image.MAX_IMAGE_PIXELS = 40000000
warnings.simplefilter('error', Image.DecompressionBombWarning)
data = sys.stdin.buffer.read(6291457)
if len(data) > 6291456: raise ValueError('image too large')
image = Image.open(io.BytesIO(data))
if image.format != sys.argv[2] or getattr(image, 'n_frames', 1) != 1: raise ValueError('unexpected or animated image')
if image.width * image.height > 40000000: raise ValueError('too many pixels')
image = ImageOps.exif_transpose(image)
edge = int(sys.argv[1])
if not 100 <= edge <= 40000: raise ValueError('invalid edge')
image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
rgba = image.convert('RGBA')
background = Image.new('RGB', rgba.size, 'white')
background.paste(rgba, mask=rgba.getchannel('A'))
out = io.BytesIO()
background.save(out, format='JPEG', quality=85)
result = out.getvalue()
if len(result) > 2097152: raise ValueError('output too large')
sys.stdout.buffer.write(result)
`

export function normalizeWebp(bytes: Buffer, maxEdge: number, python?: string): Promise<Buffer> {
  return normalizeRaster(bytes, maxEdge, 'WEBP', python)
}

/** nativeImage ignores EXIF; Pillow applies all eight orientations before resizing. */
export function normalizeExifJpeg(bytes: Buffer, maxEdge: number, python?: string): Promise<Buffer> {
  return normalizeRaster(bytes, maxEdge, 'JPEG', python)
}

async function normalizeRaster(bytes: Buffer, maxEdge: number, format: 'WEBP' | 'JPEG', python?: string): Promise<Buffer> {
  if (!python) {
    const { bundledPythonEnv } = await import('../tasks/python-runtime')
    python = bundledPythonEnv().LAZUNOX_PYTHON
  }
  if (!python) throw new Error('Falta el conversor incluido para esta foto; elige otra imagen.')
  if (!Number.isSafeInteger(maxEdge) || maxEdge < 100 || maxEdge > 40000 || bytes.length > 6 * 1024 * 1024)
    throw new Error('Límites de imagen inválidos.')
  const cwd = await mkdtemp(join(await privateTmp(), 'free-image-'))
  try {
    const output = await new Promise<Buffer>((resolve, reject) => {
      const child = execFile(
        python!,
        ['-I', '-B', '-c', SCRIPT, String(maxEdge), format],
        {
          cwd,
          env: {
            PATH: dirname(python!),
            HOME: cwd,
            TMP: cwd,
            TEMP: cwd,
            TMPDIR: cwd,
            ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {})
          },
          encoding: 'buffer',
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 2 * 1024 * 1024
        },
        (error, stdout) => (error ? reject(new Error('No se pudo convertir la foto dentro de los límites.')) : resolve(stdout))
      )
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(bytes)
    })
    const info = sniffImage(output)
    if (!info || info.kind !== 'jpeg' || Math.max(info.width, info.height) > maxEdge)
      throw new Error('El conversor no produjo una imagen válida.')
    return output
  } finally {
    await rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
