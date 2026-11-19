import { expect, it } from 'vitest'
import { downloadVideoMedia, sniffAudio, WEB_AUDIO_BYTES, WEB_PHOTO_BYTES } from './web-media'

const png = Buffer.from('89504e470d0a1a0a0000000d494844520000010e000001e00806000000', 'hex')
const fetchBytes = (bytes: Buffer, declared?: number) => ({
  resolve: async () => [{ address: '8.8.8.8', family: 4 }],
  request: async () => ({
    status: 200,
    length: declared === undefined ? undefined : String(declared),
    body: (async function* () {
      yield bytes
    })(),
    cancel() {}
  })
})
it('identifica una foto real y guarda URL original, final y hash', async () => {
  expect(await downloadVideoMedia('https://example.com/foto', 'photo', new AbortController().signal, fetchBytes(png))).toMatchObject({
    bytes: png,
    ext: 'png',
    provenance: {
      origen: 'https://example.com/foto',
      urlFinal: 'https://example.com/foto',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    }
  })
})
it.each(['<!doctype html><html>no soy foto</html>', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'])(
  'rechaza HTML y SVG disfrazados de JPG: %s',
  async (value) => {
    for (const kind of ['photo', 'audio'] as const)
      await expect(
        downloadVideoMedia('https://example.com/foto.jpg', kind, new AbortController().signal, fetchBytes(Buffer.from(value)))
      ).rejects.toThrow('no se admiten')
  }
)
it('topes distintos: 20 MiB foto, 50 MiB audio', async () => {
  for (const [kind, limit] of [
    ['photo', WEB_PHOTO_BYTES],
    ['audio', WEB_AUDIO_BYTES]
  ] as const)
    await expect(
      downloadVideoMedia('https://example.com/a', kind, new AbortController().signal, fetchBytes(png, limit + 1))
    ).rejects.toThrow('grande')
})
it('firmas MP3, AAC, M4A, WAV y OGG; rechaza etiquetas falsas o contenedores ajenos', () => {
  expect(sniffAudio(Buffer.from('fffb9064', 'hex'))).toBe('mp3')
  expect(sniffAudio(Buffer.from('fff15080001ffc', 'hex'))).toBe('aac')
  expect(sniffAudio(Buffer.from('00000018667479704d34412000000000', 'hex'))).toBe('m4a')
  expect(sniffAudio(Buffer.from('RIFF0000WAVEfmt '))).toBe('wav')
  expect(sniffAudio(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead')]))).toBe('ogg')
  expect(sniffAudio(Buffer.from('ID3 esto no es mp3'))).toBeNull()
  expect(sniffAudio(Buffer.from('00000018667479706176696600000000', 'hex'))).toBeNull()
})

it('rechaza audio de plataformas cerradas y redirecciones hacia ellas', async () => {
  const deps = fetchBytes(Buffer.from('fffb9064', 'hex'))
  for (const host of ['youtube.com', 'r1.googlevideo.com', 'open.spotify.com', 'audio.scdn.co']) {
    await expect(downloadVideoMedia(`https://${host}/audio.mp3`, 'audio', new AbortController().signal, deps)).rejects.toThrow()
    await expect(
      downloadVideoMedia('https://example.com/audio.mp3', 'audio', new AbortController().signal, {
        ...deps,
        request: async () => ({ status: 302, location: `https://${host}/audio.mp3`, body: (async function* () {})(), cancel() {} })
      })
    ).rejects.toThrow()
  }
})

it('un plazo de red agotado informa descarga, no permisos ni archivos', async () => {
  await expect(
    downloadVideoMedia('https://example.org/audio.mp3', 'audio', new AbortController().signal, {
      ...fetchBytes(Buffer.from('fffb9064', 'hex')),
      request: async () => {
        throw new DOMException('demasiado lento', 'TimeoutError')
      }
    })
  ).rejects.toThrow('tiempo de descarga de audio')
})
