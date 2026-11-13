import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commonsLicense } from './free-images-license'
import { allowedCommonsFile, FreeImagesService, FREE_IMAGE_MAX_BYTES, parseCommonsImages, type FreeImageSearch } from './free-images'
import type { FreeImageProcessor } from './free-images-visual'
import { sniffImage } from './image-files'
import { INTERNAL_NAME, RELEASES_ORIGIN, RELEASES_REPO } from '@shared/brand'

function jpeg(width = 1200, height = 800): Buffer {
  const b = Buffer.alloc(30)
  b[0] = 0xff
  b[1] = 0xd8
  b[2] = 0xff
  b[3] = 0xc0
  b.writeUInt16BE(17, 4)
  b[6] = 8
  b.writeUInt16BE(height, 7)
  b.writeUInt16BE(width, 9)
  return b
}
const bytes = jpeg()
const sha1 = createHash('sha1').update(bytes).digest('hex')
const metadata = {
  Artist: { value: 'Example photographer' },
  LicenseShortName: { value: 'CC BY-SA 4.0' },
  License: { value: 'cc-by-sa-4.0' },
  LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  UsageTerms: { value: 'Creative Commons Attribution-Share Alike 4.0' },
  Copyrighted: { value: 'True' },
  AttributionRequired: { value: 'true' },
  Credit: { value: 'Own work' }
}
function page(id = 1, meta = metadata) {
  return {
    pageid: id,
    title: `File:Photo ${id}.jpg`,
    imageinfo: [
      {
        url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo${id}.jpg`,
        thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Photo${id}.jpg/1280px-Photo.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:Photo${id}.jpg`,
        mime: 'image/jpeg',
        width: 1200,
        height: 800,
        thumbwidth: 1200,
        thumbheight: 800,
        size: bytes.length,
        sha1,
        extmetadata: meta
      }
    ]
  }
}
function response(pages = [page()]) {
  return { query: { pages } }
}
const processor: FreeImageProcessor = {
  normalize: vi.fn(async (b, edge) => {
    const width = b.readUInt16BE(9),
      height = b.readUInt16BE(7)
    const scale = Math.min(1, edge / Math.max(width, height))
    return jpeg(Math.round(width * scale), Math.round(height * scale))
  }),
  sheet: vi.fn(async (images) => Buffer.concat([Buffer.from('sheet:'), ...images]))
}
const input: FreeImageSearch = {
  queries: ['interior de cafetería', 'coffee shop interior'],
  requirements: {
    subject: 'interior de cafetería',
    required: ['local y mobiliario'],
    excluded: ['taza aislada'],
    usage: 'foto de presentación',
    realPhoto: true
  }
}
const evaluation = {
  mode: 'visual' as const,
  observed: 'Se observa un local con mesas.',
  meets: ['local y mobiliario'],
  doubts: 'Lugar exacto no confirmado.'
}
const servers: Server[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
})
function fakeFetch(mutator?: (url: URL) => Response): typeof fetch {
  return vi.fn(async (url) => {
    const u = new URL(String(url))
    return mutator?.(u) ?? (u.hostname === 'commons.wikimedia.org' ? Response.json(response()) : new Response(new Uint8Array(bytes)))
  }) as typeof fetch
}

describe('licencias de archivos Commons', () => {
  it('usa la respuesta real ya capturada sin volver a buscar en la red', async () => {
    const real = JSON.parse(await readFile(new URL('./fixtures-free-images/commons-search-real.json', import.meta.url), 'utf8'))
    const licenses = real.query.pages.map((p: { imageinfo: { extmetadata: unknown }[] }) => commonsLicense(p.imageinfo[0].extmetadata))
    expect(licenses.filter(Boolean).length).toBeGreaterThan(0)
    expect(licenses.filter(Boolean).every((l: { name: string }) => l.name.startsWith('CC BY-SA'))).toBe(true)
  })
  it.each(['CC BY-NC 4.0', 'CC BY-ND 4.0', 'Fair use', '', 'Copyright uncertain'])('rechaza %s', (name) =>
    expect(commonsLicense({ ...metadata, LicenseShortName: { value: name } })).toBeNull()
  )
  it('rechaza nombre/enlace/versión contradictorios, términos NC y crédito excesivo', () => {
    expect(commonsLicense({ ...metadata, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } })).toBeNull()
    expect(commonsLicense({ ...metadata, Permission: { value: 'Non-commercial only' } })).toBeNull()
    expect(commonsLicense({ ...metadata, Credit: { value: 'Non-commercial only' } })).toBeNull()
    expect(commonsLicense({ ...metadata, Credit: { value: 'x'.repeat(3000) } })).toBeNull()
    expect(commonsLicense({ ...metadata, UsageTerms: { value: 'Creative Commons Attribution-Share Alike 3.0' } })).toBeNull()
  })
  it('admite CC0 y dominio público solo con evidencia identificable', () => {
    const pd = {
      LicenseShortName: { value: 'Public domain' },
      License: { value: 'pd-old-100' },
      LicenseUrl: { value: 'https://creativecommons.org/publicdomain/mark/1.0/' },
      Copyrighted: { value: 'False' }
    }
    expect(commonsLicense(pd)?.name).toContain('pd-old-100')
    expect(commonsLicense({ ...pd, License: { value: 'unknown' } })).toBeNull()
    expect(commonsLicense({ ...pd, AttributionRequired: { value: 'true' } })).toBeNull()
    expect(
      commonsLicense({
        ...pd,
        LicenseShortName: { value: 'CC0' },
        License: { value: 'cc-zero' },
        LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' },
        Copyrighted: { value: 'True' }
      })
    ).toBeNull()
    expect(
      commonsLicense({
        ...pd,
        LicenseShortName: { value: 'CC0' },
        License: { value: 'cc-zero' },
        LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' }
      })?.name
    ).toBe('CC0 1.0')
  })
  it('rechaza fundamentos PD desconocidos y términos contradictorios en PD o CC0', () => {
    const pd = {
      LicenseShortName: { value: 'Public domain' },
      License: { value: 'pd-old-100' },
      LicenseUrl: { value: 'https://creativecommons.org/publicdomain/mark/1.0/' },
      Copyrighted: { value: 'False' },
      UsageTerms: { value: 'Public domain' }
    }
    expect(commonsLicense(pd)).not.toBeNull()
    for (const code of ['pd-unknown', 'pd-old-unknown', 'pd-old-999', 'pd-usgov-unknown'])
      expect(commonsLicense({ ...pd, License: { value: code } })).toBeNull()
    expect(commonsLicense({ ...pd, UsageTerms: { value: 'Public domain, Creative Commons Attribution 4.0' } })).toBeNull()
    const cc0 = {
      ...pd,
      LicenseShortName: { value: 'CC0' },
      License: { value: 'cc-zero' },
      LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' }
    }
    expect(commonsLicense({ ...cc0, UsageTerms: { value: 'Creative Commons CC0 Waiver' } })).not.toBeNull()
    for (const terms of ['Creative Commons Attribution 4.0', 'Public domain ShareAlike', 'Unknown license'])
      expect(commonsLicense({ ...cc0, UsageTerms: { value: terms } })).toBeNull()
  })
})

describe('servicio de fotos sin rutas ni URLs del modelo', () => {
  it.each([
    'http://upload.wikimedia.org/wikipedia/commons/x.jpg',
    'https://upload.wikimedia.org.evil.test/wikipedia/commons/x.jpg',
    'https://user@upload.wikimedia.org/wikipedia/commons/x.jpg',
    'https://127.0.0.1/x.jpg',
    'https://upload.wikimedia.org:444/wikipedia/commons/x.jpg'
  ])('rechaza destino %s', (url) => expect(allowedCommonsFile(url)).toBe(false))
  it('filtra duplicados/tamaño y entrega hoja y ampliación con estados separados', async () => {
    const fetch = fakeFetch((u) =>
      u.hostname === 'commons.wikimedia.org' ? Response.json(response([page(), page(2)])) : new Response(new Uint8Array(bytes))
    )
    const service = new FreeImagesService({ fetch, processor })
    const found = await service.search(input)
    expect(found.candidates).toHaveLength(1)
    expect(found.sheet).toBeInstanceOf(Buffer)
    const id = found.candidates[0].id
    await expect(service.use(id, evaluation)).rejects.toThrow('amplía')
    const viewed = await service.view([id])
    expect(viewed[0].mimeType).toBe('image/jpeg')
    const used = await service.use(id, evaluation)
    expect(used.credit).toContain('CC BY-SA 4.0')
    expect(used.credit).toContain('adaptaciones')
    expect(used.provenance.evaluationStatus).toBe('declarada-por-el-modelo')
    expect(used.provenance.status).toBe('licencia-comprobada')
    expect(used.provenance.sha256).toBe(createHash('sha256').update(used.bytes).digest('hex'))
    await expect(new FreeImagesService({ fetch, processor }).view([id])).rejects.toThrow('desconocido')
    await expect(service.view(['https://evil.test/p.jpg'])).rejects.toThrow('no se aceptan URLs')
  })
  it('prepara un JPEG menor cuando se pide tamaño útil reducido para el PDF', async () => {
    const service = new FreeImagesService({ fetch: fakeFetch(), processor })
    const found = await service.search({ ...input, minWidth: 300, minHeight: 200 })
    const id = found.candidates[0].id
    await service.view([id])
    const asset = await service.use(id, evaluation)
    expect(sniffImage(asset.bytes)).toMatchObject({ kind: 'jpeg', width: 300, height: 200 })
    expect(asset.provenance).toMatchObject({ width: 300, height: 200 })
    expect(asset.ext).toBe('jpg')
    expect(asset.credit).toContain('reducción de tamaño')
  })
  it('conserva cache de bytes normalizados y limita a dos rondas por requisitos', async () => {
    const fetch = fakeFetch(),
      service = new FreeImagesService({ fetch, processor })
    const first = await service.search(input)
    const id = first.candidates[0].id
    await service.view([id])
    const calls = vi.mocked(fetch).mock.calls.length
    await service.view([id])
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls) // recently verified metadata and bytes cached
    expect((await service.search({ ...input, searchId: first.searchId })).round).toBe(2)
    await expect(service.search(input)).rejects.toThrow('dos rondas')
  })
  it('rechaza un original cuyos bytes no coinciden con sha1 y una licencia cambiada', async () => {
    let changed = false
    const fetch = fakeFetch((u) =>
      u.hostname === 'commons.wikimedia.org'
        ? Response.json(response([page(1, changed ? { ...metadata, LicenseShortName: { value: 'CC BY-NC 4.0' } } : metadata)]))
        : new Response(new Uint8Array(bytes))
    )
    let now = Date.now()
    const service = new FreeImagesService({ fetch, processor, now: () => now }),
      found = await service.search(input),
      id = found.candidates[0].id
    await service.view([id])
    changed = true
    now += 120001 // expired verification must not silently authorize a changed license
    await expect(service.use(id, evaluation)).rejects.toThrow('licencia')
    const bad = new FreeImagesService({
      fetch: fakeFetch((u) =>
        u.hostname === 'commons.wikimedia.org' ? Response.json(response()) : new Response(new Uint8Array(jpeg(1200, 799)))
      ),
      processor
    })
    const badSearch = await bad.search(input)
    expect(badSearch.candidates).toHaveLength(0) // altered dimensions detected before display
  })
  it('sin red devuelve ninguna, sin fingir revisión visual', async () => {
    const service = new FreeImagesService({ fetch: vi.fn().mockRejectedValue(new Error('offline')), processor })
    const found = await service.search(input)
    expect(found.candidates).toEqual([])
    expect(found.sheet).toBeUndefined()
    expect(found.notice).toContain('sin fotos')
  })
  it('respeta Retry-After y rechaza descargas grandes', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '3600' } })) as typeof globalThis.fetch
    const service = new FreeImagesService({ fetch, processor })
    await service.search(input)
    await service.search(input)
    expect(fetch).toHaveBeenCalledTimes(1)
    const large = new FreeImagesService({
      fetch: fakeFetch((u) =>
        u.hostname === 'commons.wikimedia.org'
          ? Response.json(response())
          : new Response('x', { headers: { 'content-length': String(FREE_IMAGE_MAX_BYTES + 1) } })
      ),
      processor
    })
    expect((await large.search(input)).candidates).toHaveLength(0)
  })
  it.each(['2', 'date'])('reintenta 429 respetando Retry-After %s y anuncia contacto de la app', async (header) => {
    let now = Date.UTC(2026, 0, 1)
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    let attempts = 0
    const fetch = fakeFetch((u) => {
      if (u.hostname !== 'commons.wikimedia.org') return new Response(new Uint8Array(bytes))
      if (++attempts === 1)
        return new Response('', {
          status: 429,
          headers: { 'retry-after': header === 'date' ? new Date(now + 2000).toUTCString() : header }
        })
      return Response.json(response())
    })
    const service = new FreeImagesService({ fetch, processor, now: () => now, sleep })
    expect((await service.search(input)).candidates).toHaveLength(1)
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2000)
    const init = vi.mocked(fetch).mock.calls[0][1]!
    expect(init.headers).toMatchObject({
      'User-Agent': `${INTERNAL_NAME}/free-images (document photos; ${RELEASES_ORIGIN}/${RELEASES_REPO})`
    })
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('maxlag=5')
  })
  it('respeta el mínimo de cinco segundos en 503 de API y no redescarga el original al preparar', async () => {
    let now = Date.now(),
      attempts = 0
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    const fetch = fakeFetch((u) => {
      if (u.hostname !== 'commons.wikimedia.org') return new Response(new Uint8Array(bytes))
      return ++attempts === 1
        ? Response.json({ error: { code: 'maxlag' } }, { status: 503, headers: { 'Retry-After': '1' } })
        : Response.json(response())
    })
    const service = new FreeImagesService({ fetch, processor, now: () => now, sleep })
    const found = await service.search(input)
    expect(found.candidates).toHaveLength(1)
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5000)
    const id = found.candidates[0].id
    await service.view([id])
    const checkedAt = new Date(now).toISOString()
    now += 1000
    const calls = vi.mocked(fetch).mock.calls.length
    expect((await service.use(id, evaluation)).provenance.checkedAt).toBe(checkedAt)
    expect(fetch).toHaveBeenCalledTimes(calls)
  })
  it('detecta maxlag con HTTP 200 y limita reintentos/espera acumulada', async () => {
    let now = Date.now()
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    const fetch = vi.fn(async () =>
      Response.json({ error: { code: 'maxlag', lag: 8 } }, { headers: { 'Retry-After': '5' } })
    ) as typeof globalThis.fetch
    const service = new FreeImagesService({ fetch, processor, now: () => now, sleep })
    expect((await service.search(input)).candidates).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls.reduce((total, [ms]) => total + ms, 0)).toBe(10000)
  })
  it('recupera maxlag transitorio y no reintenta un 403', async () => {
    let now = Date.now(),
      attempts = 0
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    const fetch = fakeFetch((u) => {
      if (u.hostname !== 'commons.wikimedia.org') return new Response(new Uint8Array(bytes))
      return ++attempts === 1 ? Response.json({ error: { code: 'maxlag' } }) : Response.json(response())
    })
    expect((await new FreeImagesService({ fetch, processor, now: () => now, sleep }).search(input)).candidates).toHaveLength(1)
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5000)
    const denied = vi.fn(async () => new Response('', { status: 403 })) as typeof globalThis.fetch
    expect((await new FreeImagesService({ fetch: denied, processor, sleep }).search(input)).candidates).toEqual([])
    expect(denied).toHaveBeenCalledTimes(1)
  })
  it('agrupa dos finalistas, reutiliza la ficha y descarga cada original una sola vez entre ver y usar', async () => {
    const secondBytes = Buffer.concat([bytes, Buffer.from('second')])
    const secondPage = page(2)
    secondPage.imageinfo[0].sha1 = createHash('sha1').update(secondBytes).digest('hex')
    const fetch = fakeFetch((u) =>
      u.hostname === 'commons.wikimedia.org'
        ? Response.json(response([page(), secondPage]))
        : new Response(new Uint8Array(u.pathname.includes('Photo2') ? secondBytes : bytes))
    )
    const service = new FreeImagesService({ fetch, processor })
    const found = await service.search(input)
    const ids = found.candidates.map((candidate) => candidate.id)
    expect(ids).toHaveLength(2)
    await service.view(ids)
    await service.use(ids[0], evaluation)
    await service.use(ids[1], evaluation)
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)))
    expect(urls.filter((url) => url.searchParams.has('pageids')).map((url) => url.searchParams.get('pageids'))).toEqual(['1|2'])
    expect(urls.filter((url) => url.hostname === 'upload.wikimedia.org')).toHaveLength(2)
    // Two batched searches, two thumbnails, one finalist metadata batch and two originals.
    expect(urls).toHaveLength(7)
  })
  it('hereda ficha/tamaño al continuar por searchId, acepta ajustes y no permite una tercera ronda sin id', async () => {
    const service = new FreeImagesService({ fetch: fakeFetch(), processor })
    const first = await service.search({
      queries: input.queries,
      requirements: { subject: 'café', usage: 'portada' },
      minWidth: 300,
      minHeight: 200
    })
    const second = await service.search({ queries: ['mesas de café', 'cafe tables'], searchId: first.searchId })
    expect(second.round).toBe(2)
    const id = second.candidates[0].id
    await service.view([id])
    const asset = await service.use(id, evaluation)
    expect(asset.provenance.requirements).toEqual({ subject: 'café', usage: 'portada', required: [], excluded: [], realPhoto: true })
    expect(asset.provenance.width).toBe(300)
    await expect(service.search({ queries: input.queries, requirements: { subject: 'café', usage: 'portada' } })).rejects.toThrow(
      'dos rondas'
    )
    const other = await service.search(input)
    const revised = { ...input.requirements!, subject: 'mesas y sillas' }
    await service.search({ queries: input.queries, requirements: revised, searchId: other.searchId })
    await expect(service.search({ queries: input.queries, requirements: revised })).rejects.toThrow('dos rondas')
  })
  it('los errores de ficha ausente o id ajeno incluyen un ejemplo corregible', async () => {
    const service = new FreeImagesService({ fetch: fakeFetch(), processor })
    await expect(service.search({ queries: input.queries })).rejects.toThrow('Ejemplo inicial: {"queries"')
    await expect(service.search({ queries: input.queries, searchId: 'inventado' })).rejects.toThrow('Omítelo al iniciar')
  })
  it('descarga con servidor falso y no sigue redirecciones', async () => {
    let redirect = false
    const server = createServer((req, res) => {
      if (req.url?.startsWith('/api')) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(response()))
      } else if (redirect) {
        res.writeHead(302, { location: 'http://127.0.0.1:1/no' })
        res.end()
      } else res.end(bytes)
    })
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const transport: typeof fetch = async (url, init) => {
      const u = new URL(String(url))
      return fetch(`http://127.0.0.1:${port}/${u.hostname === 'commons.wikimedia.org' ? 'api' : 'image'}`, init)
    }
    const good = new FreeImagesService({ fetch: transport, processor })
    expect((await good.search(input)).candidates).toHaveLength(1)
    redirect = true
    const blocked = new FreeImagesService({ fetch: transport, processor })
    expect((await blocked.search(input)).candidates).toHaveLength(0)
  })
  it('ignora metadatos sin versión exacta del archivo y orientación/tamaño inadecuados', async () => {
    const raw = response()
    delete (raw.query.pages[0].imageinfo[0] as Partial<{ sha1: string }>).sha1
    expect(parseCommonsImages(raw)).toEqual([])
    const service = new FreeImagesService({ fetch: fakeFetch(), processor })
    expect((await service.search({ ...input, orientation: 'portrait' })).candidates).toHaveLength(0)
    await expect(service.search({ ...input, queries: ['single'] })).rejects.toThrow('dos o tres')
  })
})
