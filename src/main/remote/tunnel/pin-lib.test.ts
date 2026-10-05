/** Generador del pin (`scripts/cloudflared/pin-lib.mjs`) SOLO con dobles: no descarga nada real. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BIN_MAX_SIZE, SIGNATURE, bodyChecksum, buildPin, serializePin, type PinIo } from '../../../../scripts/cloudflared/pin-lib.mjs'
import { parsePin } from './binary'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const NAME = 'cloudflared-darwin-arm64.tgz'
const URL0 = `https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/${NAME}`
const TGZ = Buffer.from('tgz-bytes'.repeat(100))
const BIN = Buffer.from('binary-bytes'.repeat(100))

interface Over {
  digest?: string
  body?: string
  size?: number
  tag?: string
  sig?: { identifier: string | null; teamId: string | null; authorities: string[] }
  tgz?: Buffer
  bin?: Buffer
  url?: string
}
function io(o: Over = {}): { io: PinIo; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    io: {
      getJson: async (url) => {
        calls.push(url)
        return {
          tag_name: o.tag ?? '2026.9.3',
          published_at: '2026-09-24T16:14:11Z',
          // En la release oficial el cuerpo lista el hash del BINARIO extraído y la API da el del `.tgz`.
          body: o.body ?? `### Checksums\n${NAME}: ${sha(BIN)}\n`,
          assets: [
            { name: NAME, size: o.size ?? TGZ.length, digest: `sha256:${o.digest ?? sha(TGZ)}`, browser_download_url: o.url ?? URL0 }
          ]
        }
      },
      download: async (url) => {
        calls.push(url)
        return o.tgz ?? TGZ
      },
      extract: async () => o.bin ?? BIN,
      codesign: async () =>
        o.sig ?? { identifier: SIGNATURE.identifier, teamId: SIGNATURE.teamId, authorities: [SIGNATURE.authority, 'Apple'] }
    }
  }
}

describe('buildPin', () => {
  it('con las tres fuentes de acuerdo escribe los DOS hashes y la firma', async () => {
    const d = io()
    const pin = await buildPin({ version: '2026.9.3', io: d.io })
    expect(pin).toEqual({
      version: '2026.9.3',
      releasedAt: '2026-09-24',
      assets: {
        'darwin-arm64': {
          url: URL0,
          size: TGZ.length,
          sha256: sha(TGZ),
          binSize: BIN.length,
          binSha256: sha(BIN),
          binMaxSize: BIN_MAX_SIZE,
          signature: SIGNATURE
        }
      }
    })
    // Lo que genera lo acepta el validador de la app.
    expect(parsePin(JSON.parse(serializePin(pin)))).not.toBeNull()
    expect(serializePin(pin).endsWith('}\n')).toBe(true)
  })

  const cases: Array<[string, Over, RegExp]> = [
    ['digest de la API distinto del cálculo local', { digest: 'a'.repeat(64) }, /digest/],
    ['cuerpo con otro hash', { body: `${NAME}: ${'b'.repeat(64)}` }, /cuerpo/],
    ['cuerpo sin el checksum', { body: 'nada' }, /no lista/],
    ['tamaño distinto del de la API', { size: 5 }, /tamaño/],
    ['firma de otro equipo', { sig: { identifier: 'cloudflared', teamId: 'ZZZZZZZZZZ', authorities: [SIGNATURE.authority] } }, /firma/],
    ['sin autoridad Developer ID', { sig: { identifier: 'cloudflared', teamId: SIGNATURE.teamId, authorities: [] } }, /firma/],
    ['identificador distinto', { sig: { identifier: 'otro', teamId: SIGNATURE.teamId, authorities: [SIGNATURE.authority] } }, /firma/],
    ['release de otra etiqueta', { tag: '2026.9.2' }, /release/],
    ['URL de descarga inesperada', { url: 'https://evil.example/x.tgz' }, /URL/],
    ['binario gigante', { bin: Buffer.alloc(BIN_MAX_SIZE + 1), body: `${NAME}: ${sha(Buffer.alloc(BIN_MAX_SIZE + 1))}` }, /grande/]
  ]
  for (const [name, over, re] of cases)
    it(`rechaza: ${name} (y no escribe nada)`, async () => {
      await expect(buildPin({ version: '2026.9.3', io: io(over).io })).rejects.toThrow(re)
    })

  it('acepta que el cuerpo liste el hash del .tgz', async () => {
    const pin = await buildPin({ version: '2026.9.3', io: io({ body: `| ${NAME} | ${sha(TGZ)} |` }).io })
    expect(pin.version).toBe('2026.9.3')
  })

  it('versión mal formada: ni siquiera pregunta a la red', async () => {
    const d = io()
    await expect(buildPin({ version: '../../x', io: d.io })).rejects.toThrow(/versión/)
    expect(d.calls).toEqual([])
  })

  it('lee el cuerpo en los formatos habituales', () => {
    const h = 'c'.repeat(64)
    expect(bodyChecksum(`${NAME}: ${h}`, NAME)).toBe(h)
    expect(bodyChecksum(`${h}  ${NAME}`, NAME)).toBe(h)
    expect(bodyChecksum(`| ${NAME} | ${h.toUpperCase()} |`, NAME)).toBe(h)
    expect(bodyChecksum('otra cosa', NAME)).toBeNull()
  })
})
