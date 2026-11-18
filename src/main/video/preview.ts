/** Miniatura de MP4 sin red ni rutas de medios para el decodificador. Nunca instala piezas. */
import { spawn } from 'node:child_process'
import { open, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { VideoFilePreview } from '@shared/ipc-extras'
import { MAX_BYTES, sniffDocKind } from '../viewer/doc-kind'

async function durationOf(file: FileHandle, size: number): Promise<number | null> {
  let boxes = 0
  async function walk(start: number, end: number): Promise<number | null> {
    for (let pos = start; pos + 8 <= end && ++boxes <= 10000;) {
      const buf = Buffer.alloc(Math.min(64, end - pos))
      const { bytesRead } = await file.read(buf, 0, buf.length, pos)
      if (bytesRead < 8) return null
      const type = buf.toString('ascii', 4, 8)
      const raw = buf.readUInt32BE(0)
      const header = raw === 1 ? 16 : 8
      const length = raw === 1 && bytesRead >= 16 ? Number(buf.readBigUInt64BE(8)) : raw === 0 ? end - pos : raw
      if (!Number.isSafeInteger(length) || length < header || pos + length > end) return null
      if (type === 'moov') return walk(pos + header, pos + length)
      if (type === 'mvhd') {
        const version = buf[header]
        const offset = header + (version === 1 ? 20 : 12)
        const needed = offset + (version === 1 ? 12 : 8)
        if ((version !== 0 && version !== 1) || bytesRead < needed || length < needed) return null
        const scale = buf.readUInt32BE(offset)
        const ticks = version === 1 ? Number(buf.readBigUInt64BE(offset + 4)) : buf.readUInt32BE(offset + 4)
        const seconds = ticks / scale
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null
      }
      pos += length
    }
    return null
  }
  return walk(0, size)
}

function firstFrame(file: FileHandle, size: number, ffmpeg: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    // Solo pipe: incluso una referencia externa dentro de un MP4 hostil queda fuera de los protocolos admitidos.
    const child = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        'pipe',
        '-threads',
        '1',
        '-f',
        'mov',
        '-i',
        'pipe:0',
        '-an',
        '-frames:v',
        '1',
        '-vf',
        'scale=240:240:force_original_aspect_ratio=decrease',
        '-threads',
        '1',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1'
      ],
      { env: {}, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    const input = file.createReadStream({ start: 0, end: size - 1, autoClose: false })
    const chunks: Buffer[] = []
    let bytes = 0
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000)
    const finish = (ok: boolean): void => {
      clearTimeout(timer)
      input.destroy()
      const image = Buffer.concat(chunks)
      resolve(
        ok && image.length > 2 && image[0] === 255 && image[1] === 216 ? `data:image/jpeg;base64,${image.toString('base64')}` : undefined
      )
    }
    child.stdout.on('data', (b: Buffer) => {
      bytes += b.length
      if (bytes > 256 * 1024) child.kill('SIGKILL')
      else chunks.push(b)
    })
    child.stdin.on('error', () => {
      input.destroy()
    })
    input.on('error', () => child.kill('SIGKILL'))
    child.once('error', () => finish(false))
    child.once('close', (code) => finish(code === 0 && bytes <= 256 * 1024))
    input.pipe(child.stdin)
  })
}

let active = 0
/** Quien llama valida el ámbito ANTES y DESPUÉS de preparar la miniatura. */
export async function videoPreview(
  path: string,
  assertPath: (path: string) => string,
  ffmpeg?: string
): Promise<VideoFilePreview | undefined> {
  if (active >= 2) return undefined
  active++
  let file: FileHandle | undefined
  try {
    const real = assertPath(path)
    if (!/\.mp4$/i.test(real) || (await realpath(real)) !== real) return undefined
    file = await open(real, 'r')
    const info = await file.stat()
    const current = await stat(assertPath(path))
    if (!info.isFile() || info.size > MAX_BYTES.mp4 || info.dev !== current.dev || info.ino !== current.ino) return undefined
    const head = Buffer.alloc(Math.min(info.size, 32))
    await file.read(head, 0, head.length, 0)
    if (sniffDocKind(real, head) !== 'mp4') return undefined
    const duration = await durationOf(file, info.size)
    if (duration === null) return undefined
    const poster = ffmpeg ? await firstFrame(file, info.size, ffmpeg) : undefined
    if (assertPath(path) !== real) return undefined
    return { duration, ...(poster ? { poster } : {}) }
  } catch {
    return undefined
  } finally {
    await file?.close()
    active--
  }
}
