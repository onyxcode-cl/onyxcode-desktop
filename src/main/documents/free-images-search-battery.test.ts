import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FreeImagesService, type FreeImageRequirements } from './free-images'

interface ImageInfo {
  url: string
  thumburl: string
  width: number
  height: number
  thumbwidth: number
  thumbheight: number
  sha1: string
}
interface Capture {
  url: string
  response: { query?: { pages?: Array<{ imageinfo?: ImageInfo[] }> } }
}
interface AssessedCandidate {
  source: string
  usefulByMetadata: boolean
  reason: string
}
interface Measurement {
  queriesExecuted: string[]
  shown: number
  usefulByMetadata: number
  candidates: AssessedCandidate[]
}
interface BatteryCase {
  id: string
  requirements: FreeImageRequirements
  before: Measurement
  after: Measurement
}
const fixtures = join(__dirname, 'fixtures-free-images')
const report = JSON.parse(readFileSync(join(fixtures, 'search-battery-results.json'), 'utf8')) as {
  commonsRequests: number
  cases: BatteryCase[]
}
const queries = JSON.parse(readFileSync(join(fixtures, 'search-battery-queries.json'), 'utf8')) as Array<{ id: string; queries: string[] }>
const files = readdirSync(join(fixtures, 'search-battery')).filter((name) => name.endsWith('.json'))

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  bytes[3] = 0xc0
  bytes.writeUInt16BE(17, 4)
  bytes[6] = 8
  bytes.writeUInt16BE(height, 7)
  bytes.writeUInt16BE(width, 9)
  return bytes
}

/** Metadata replay only. Captures stay intact; synthetic pixels/hash prevent any real download.
 * Their dimensions reproduce Commons' unscaled-original response, including its misleading thumbwidth. */
function replay() {
  const captures = files.map((file) => JSON.parse(readFileSync(join(fixtures, 'search-battery', file), 'utf8')) as Capture)
  const pixels = new Map<string, Buffer>()
  for (const capture of captures) {
    for (const page of capture.response.query?.pages ?? []) {
      const info = page.imageinfo?.[0]
      if (!info) continue
      const original = Buffer.concat([jpeg(info.width, info.height), Buffer.from(info.sha1 ?? '')])
      info.sha1 = createHash('sha1').update(original).digest('hex')
      pixels.set(info.url, original)
      if (info.thumburl) {
        pixels.set(info.thumburl, info.thumburl.includes('thumbnail_unscaled') ? original : jpeg(info.thumbwidth, info.thumbheight))
      }
    }
  }
  const missing: string[] = []
  const calls: string[] = []
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'commons.wikimedia.org') {
      const query = url.searchParams.get('gsrsearch')?.replace(/ filetype:bitmap$/, '')
      calls.push(query ?? '')
      const hit = captures.find((capture) => {
        const recorded = new URL(capture.url)
        return (
          recorded.searchParams.get('gsrlimit') === url.searchParams.get('gsrlimit') &&
          recorded.searchParams.get('gsrsearch')?.replace(/ filetype:bitmap$/, '') === query
        )
      })
      if (hit) return new Response(JSON.stringify(hit.response))
    } else {
      const bytes = pixels.get(url.href)
      if (bytes) return new Response(new Uint8Array(bytes))
    }
    missing.push(url.href)
    throw new Error('No recorded response; live network is forbidden in this test')
  }
  const service = new FreeImagesService({
    fetch: fetcher,
    processor: {
      normalize: async (bytes, edge) => {
        const width = bytes.readUInt16BE(9)
        const height = bytes.readUInt16BE(7)
        const scale = Math.min(1, edge / Math.max(width, height))
        return jpeg(Math.round(width * scale), Math.round(height * scale))
      },
      sheet: async () => Buffer.from('synthetic sheet; no visual assessment')
    }
  })
  return { service, missing, calls }
}

describe('batería real de búsqueda: replay sin red ni píxeles del proveedor', () => {
  it('conserva las 35 respuestas reales y las siete consultas de comparación', () => {
    expect(files).toHaveLength(report.commonsRequests)
    expect(report.cases).toHaveLength(7)
    expect(queries.map((item) => item.id)).toEqual(report.cases.map((item) => item.id))
  })

  it.each(report.cases)('$id: mantiene orden y pertinencia de las primeras seis candidatas', async (item) => {
    const { service, missing, calls } = replay()
    const result = await service.search({
      queries: queries.find((entry) => entry.id === item.id)!.queries,
      requirements: item.requirements
    })
    expect(missing).toEqual([])
    expect(calls).toEqual(item.after.queriesExecuted)
    expect(result.candidates.map((candidate) => candidate.source)).toEqual(item.after.candidates.map((candidate) => candidate.source))
    expect(result.candidates).toHaveLength(item.after.shown)
    const supported = result.candidates.filter(
      (candidate) => item.after.candidates.find((entry) => entry.source === candidate.source)?.usefulByMetadata
    )
    expect(supported).toHaveLength(item.after.usefulByMetadata)
    expect(supported.length).toBeGreaterThanOrEqual(item.before.usefulByMetadata)
    expect(item.after.candidates.every((candidate) => candidate.reason.length > 20)).toBe(true)
  })
})
