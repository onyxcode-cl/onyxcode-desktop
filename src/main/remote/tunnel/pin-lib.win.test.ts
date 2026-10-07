/** Generador del pin para Windows (`win32-x64`) SOLO con datos sintéticos: no descarga nada ni toca Windows. */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BIN_MAX_SIZE, mergePin, serializePin, buildPin, type PinIo } from '../../../../scripts/cloudflared/pin-lib.mjs'
import { parsePin, pinFor } from './binary'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const NAME = 'cloudflared-windows-amd64.exe'
const URL_EXE = `https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/${NAME}`
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.from('fake-exe-bytes'.repeat(50))])
const SUBJECT = 'CN=Cloudflare, Inc., O=Cloudflare, Inc., L=San Francisco, S=California, C=US'

interface Over {
  digest?: string
  body?: string
  size?: number
  exe?: Buffer
  url?: string
}
function io(o: Over = {}): { io: PinIo; calls: string[] } {
  const calls: string[] = []
  const exe = o.exe ?? EXE
  return {
    calls,
    io: {
      getJson: async (url) => {
        calls.push(url)
        return {
          tag_name: '2026.9.3',
          published_at: '2026-09-24T16:14:11Z',
          body: o.body ?? `### Checksums\n${NAME}: ${sha(exe)}\n`,
          assets: [{ name: NAME, size: o.size ?? exe.length, digest: `sha256:${o.digest ?? sha(exe)}`, browser_download_url: o.url ?? URL_EXE }]
        }
      },
      download: async (url) => {
        calls.push(url)
        return exe
      },
      extract: async () => {
        throw new Error('el .exe no se extrae')
      },
      codesign: async () => {
        throw new Error('codesign no aplica a Windows')
      }
    }
  }
}
const build = (o: Over = {}, subject: string | undefined = SUBJECT) =>
  buildPin({ version: '2026.9.3', io: io(o).io, targets: ['win32-x64'], authenticodeSubject: subject })

describe('buildPin win32-x64', () => {
  it('escribe el .exe con size/sha256 = binSize/binSha256 y el sujeto; lo acepta parsePin y pinFor', async () => {
    const pin = await build()
    expect(pin.assets['win32-x64']).toEqual({
      url: URL_EXE,
      size: EXE.length,
      sha256: sha(EXE),
      binSize: EXE.length,
      binSha256: sha(EXE),
      binMaxSize: BIN_MAX_SIZE,
      signature: { subject: SUBJECT }
    })
    const parsed = parsePin(JSON.parse(serializePin(pin)))
    expect(parsed).not.toBeNull()
    expect(pinFor(parsed, 'win32', 'x64')?.signature).toEqual({ subject: SUBJECT })
    expect(pinFor(parsed, 'darwin', 'arm64')).toBeNull()
  })

  it('sin --authenticode-subject (o con uno ajeno) no escribe y ni pregunta a la red', async () => {
    for (const s of [undefined, '', 'CN=x\nO=y', 'CN=Otra Empresa, O=Otra']) {
      const d = io()
      await expect(buildPin({ version: '2026.9.3', io: d.io, targets: ['win32-x64'], authenticodeSubject: s })).rejects.toThrow(/sujeto|authenticode/i)
      expect(d.calls).toEqual([])
    }
  })

  const cases: Array<[string, Over, RegExp]> = [
    ['digest de la API distinto', { digest: 'a'.repeat(64) }, /digest/],
    ['cuerpo con otro hash', { body: `${NAME}: ${'b'.repeat(64)}` }, /cuerpo/],
    ['cuerpo sin el checksum', { body: 'nada' }, /no lista/],
    ['tamaño distinto del de la API', { size: 5 }, /tamaño/],
    ['URL inesperada', { url: 'https://evil.example/x.exe' }, /URL/],
    ['no es un ejecutable (sin MZ)', { exe: Buffer.from('hola'.repeat(20)) }, /MZ/]
  ]
  for (const [name, over, re] of cases)
    it(`rechaza: ${name}`, async () => {
      const exe = over.exe
      await expect(build(exe ? { ...over, body: `${NAME}: ${sha(exe)}` } : over)).rejects.toThrow(re)
    })

  it('plataforma desconocida', async () => {
    await expect(buildPin({ version: '2026.9.3', io: io().io, targets: ['linux-x64'] })).rejects.toThrow(/plataforma/)
  })
})

describe('mergePin', () => {
  it('misma versión: conserva macOS al añadir Windows; otra versión: reemplaza', async () => {
    const win = await build()
    const mac = { version: '2026.9.3', releasedAt: '2026-09-24', assets: { 'darwin-arm64': { url: 'x' } } }
    expect(Object.keys(mergePin(mac, win).assets).sort()).toEqual(['darwin-arm64', 'win32-x64'])
    expect(mergePin({ ...mac, version: '2026.9.2' }, win)).toBe(win)
    expect(mergePin(null, win)).toBe(win)
  })
})
