import { createHash } from 'node:crypto'
import { publicHttpsBytes, type PublicHttpsDeps } from '../util/public-https'
import { sniffImage, MAX_IMAGE_PIXELS } from '../documents/image-files'

export const WEB_PHOTO_BYTES = 20 * 1024 * 1024
export const WEB_AUDIO_BYTES = 50 * 1024 * 1024

/** Firma del contenedor, no extensión ni Content-Type; ffprobe valida después el flujo de audio. */
export function sniffAudio(b: Buffer): 'mp3' | 'm4a' | 'aac' | 'wav' | 'ogg' | null {
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return 'wav'
  if (
    b.length >= 36 &&
    b.toString('ascii', 0, 4) === 'OggS' &&
    (b.includes(Buffer.from('vorbis'), 27) || b.includes(Buffer.from('OpusHead'), 27))
  )
    return 'ogg'
  if (
    b.length >= 16 &&
    b.toString('ascii', 4, 8) === 'ftyp' &&
    /^(M4A |M4B |isom|iso2|mp4[12]|avc1|dash)$/.test(b.toString('ascii', 8, 12))
  )
    return 'm4a'
  let offset = 0
  if (b.length >= 10 && b.toString('ascii', 0, 3) === 'ID3') {
    if (b[3] > 4 || [...b.subarray(6, 10)].some((v) => v > 127)) return null
    offset = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0)
  }
  if (offset + 4 <= b.length && b[offset] === 0xff) {
    const h = b[offset + 1]!,
      rate = b[offset + 2]!
    if ((h & 0xf6) === 0xf0 && ((rate >> 2) & 15) < 13) return 'aac'
    if ((h & 0xe0) === 0xe0 && (h & 0x18) !== 0x08 && (h & 6) !== 0 && (rate & 0xf0) !== 0 && (rate & 0xf0) !== 0xf0 && (rate & 12) !== 12)
      return 'mp3'
  }
  return null
}

export async function downloadVideoMedia(origin: string, kind: 'photo' | 'audio', signal: AbortSignal, deps?: PublicHttpsDeps) {
  const blocked = ['youtube.com', 'youtu.be', 'googlevideo.com', 'spotify.com', 'scdn.co', 'netflix.com', 'music.apple.com']
  const { bytes, url } = await publicHttpsBytes(origin, kind === 'photo' ? WEB_PHOTO_BYTES : WEB_AUDIO_BYTES, signal, {
    ...deps,
    allowUrl: (u) =>
      (deps?.allowUrl?.(u) ?? true) && (kind !== 'audio' || !blocked.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)))
  })
  const image = kind === 'photo' ? sniffImage(bytes) : null
  const ext = kind === 'photo' ? image?.ext : sniffAudio(bytes)
  if (!ext || (image && image.width * image.height > MAX_IMAGE_PIXELS))
    throw Error('El recurso no es una foto JPG/PNG/WebP/GIF o audio MP3/M4A/AAC/WAV/OGG válido; HTML y SVG no se admiten.')
  return {
    bytes,
    ext,
    provenance: { origen: origin, urlFinal: url, tipo: kind, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
}
