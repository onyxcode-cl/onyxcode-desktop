import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commonsLicense } from './free-images-license'
import {
  allowedCommonsFile,
  FreeImagesService,
  FREE_IMAGE_MAX_BYTES,
  parseCommonsImages,
  normalizeImageEvaluation,
  type FreeImageSearch
} from './free-images'
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
    title: `File:Coffee shop interior Photo ${id}.jpg`,
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
  it('resuelve la primera llamada Mac con cinco consultas sin aumentar el trabajo de red', async () => {
    // Forma exacta de la llamada rechazada en la prueba Mac: cinco sugerencias, no un fallo de red.
    const queries = [
      'dinosaur skeleton museum',
      'Tyrannosaurus rex fossil',
      'Triceratops dinosaur',
      'Stegosaurus dinosaur illustration',
      'dinosaur fossil footprints'
    ]
    const requirements = { subject: 'dinosaurios para niños, esqueletos y fósiles reconocibles', usage: 'presentación infantil' }
    const fetch = fakeFetch()
    const service = new FreeImagesService({ fetch, processor })
    const first = await service.search({ queries, requirements })
    expect(first.round).toBe(1)
    expect(first.candidates).toHaveLength(1)
    expect(first.notice).toContain('Se usaron las primeras cuatro consultas; se omitieron 1')
    const requested = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    const baselineFetch = fakeFetch()
    await new FreeImagesService({ fetch: baselineFetch, processor }).search({ queries: queries.slice(0, 4), requirements })
    expect(requested).toEqual(vi.mocked(baselineFetch).mock.calls.map(([url]) => String(url)))
    await service.view([first.candidates[0].id])
    const asset = await service.use(first.candidates[0].id, evaluation)
    expect(asset.provenance.queries).not.toContain(queries[4])
    const second = await service.search({ queries, searchId: first.searchId })
    expect(second.round).toBe(2)
    expect(second.notice).toContain('se omitieron 1')
    await expect(service.search({ queries, searchId: first.searchId })).rejects.toThrow('dos rondas')
    expect(queries).toHaveLength(5)
  })

  it.each([
    [Array.from({ length: 9 }, (_, i) => `consulta ${i}`), 'queries:'],
    [['uno', 'dos', 'tres', 'cuatro', 42], 'queries[4]:'],
    [['uno', 'dos', 'tres', 'cuatro', ''], 'queries[4]:'],
    [['uno', 'dos', 'tres', 'cuatro', 'uno'], 'queries:']
  ])('valida incluso sugerencias que no ejecutará: %j', async (queries, field) => {
    const fetch = fakeFetch()
    const service = new FreeImagesService({ fetch, processor })
    await expect(service.search({ ...input, queries } as FreeImageSearch)).rejects.toThrow(field)
    expect(fetch).not.toHaveBeenCalled()
    expect((await service.search(input)).round).toBe(1)
  })

  it('acepta cuatro consultas de la prueba Mac en primera y segunda ronda sin reintento del modelo', async () => {
    const service = new FreeImagesService({ fetch: fakeFetch(), processor })
    const queries = ['dinosaur skeleton museum', 'tyrannosaurus rex fossil', 'dinosaur footprints fossil', 'stegosaurus dinosaur']
    const first = await service.search({ queries, requirements: { subject: 'dinosaurios para niños', usage: 'presentación infantil' } })
    expect(first.round).toBe(1)
    expect(first.candidates).toHaveLength(1)
    const second = await service.search({ queries, searchId: first.searchId })
    expect(second.round).toBe(2)
    expect(second.candidates).toHaveLength(1)
    await expect(service.search({ queries, searchId: first.searchId })).rejects.toThrow('dos rondas')
  })
  it.each([
    [{ queries: ['ok', 2] }, 'queries[1]'],
    [{ requirements: [] }, 'requirements'],
    [{ requirements: { subject: 2, usage: 'Portada' } }, 'requirements.subject'],
    [{ requirements: { subject: 'Café', usage: 2 } }, 'requirements.usage'],
    [{ requirements: { ...input.requirements, required: 'mesas' } }, 'requirements.required'],
    [{ requirements: { ...input.requirements, excluded: [2] } }, 'requirements.excluded[0]'],
    [{ requirements: { ...input.requirements, realPhoto: 'true' } }, 'requirements.realPhoto'],
    [{ requirements: { ...input.requirements, place: false } }, 'requirements.place'],
    [{ requirements: { ...input.requirements, action: [] } }, 'requirements.action'],
    [{ minWidth: '1000' }, 'minWidth'],
    [{ minHeight: 99 }, 'minHeight'],
    [{ searchId: 2 }, 'searchId']
  ])('indica el campo incorrecto y no consume una ronda ni consulta la red: %s', async (patch, field) => {
    const fetch = fakeFetch()
    const service = new FreeImagesService({ fetch, processor })
    await expect(service.search({ ...input, ...patch } as FreeImageSearch)).rejects.toThrow(`${field}:`)
    expect(fetch).not.toHaveBeenCalled()
    expect((await service.search(input)).round).toBe(1)
  })
  it.each([{ doubts: [] }, { doubts: ['No se confirma el lugar', 'No se confirma la fecha'] }, { doubts: 'Lugar no confirmado' }])(
    'prepara doubts=%j y conserva texto normalizado en procedencia',
    async ({ doubts }) => {
      const service = new FreeImagesService({ fetch: fakeFetch(), processor })
      const id = (await service.search(input)).candidates[0].id
      await service.view([id])
      const asset = await service.use(id, { ...evaluation, doubts })
      expect(asset.provenance.evaluation.doubts).toBe(Array.isArray(doubts) ? doubts.join('\n') : doubts)
    }
  )
  it.each([
    [{ mode: 'guess' }, 'evaluation.mode'],
    [{ observed: [] }, 'evaluation.observed'],
    [{ meets: 'mesas' }, 'evaluation.meets'],
    [{ meets: [4] }, 'evaluation.meets[0]'],
    [{ doubts: false }, 'evaluation.doubts'],
    [{ doubts: ['bien', 2] }, 'evaluation.doubts[1]'],
    [{ doubts: ['x'.repeat(700), 'y'.repeat(700)] }, 'evaluation.doubts'],
    [{ doubts: Array(13).fill('duda') }, 'evaluation.doubts']
  ])('explica el campo de evaluación incorrecto: %s', (patch, field) => {
    expect(() => normalizeImageEvaluation({ ...evaluation, ...patch })).toThrow(`${field}:`)
  })

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
    expect(used.provenance.fullCredit).toContain('adaptaciones')
    expect(used.credit.length).toBeLessThanOrEqual(120)
    expect(used.provenance.evaluationStatus).toBe('declarada-por-el-modelo')
    expect(used.provenance.status).toBe('licencia-comprobada')
    expect(used.provenance.sha256).toBe(createHash('sha256').update(used.bytes).digest('hex'))
    await expect(new FreeImagesService({ fetch, processor }).view([id])).rejects.toThrow('desconocido')
    await expect(service.view(['https://evil.test/p.jpg'])).rejects.toThrow('no se aceptan URLs')
  })
  it.each(['h1', 'h6'])('limpia el pie de %s y conserva los metadatos reales íntegros en procedencia', async (caseId) => {
    const captured = JSON.parse(await readFile(new URL(`./fixtures-free-images/${caseId}-attribution-real.json`, import.meta.url), 'utf8'))
    const raw = {
      ...metadata,
      Artist: { value: captured.author },
      LicenseShortName: { value: captured.license },
      License: { value: caseId === 'h1' ? 'cc-by-2.0' : 'cc-by-sa-4.0' },
      LicenseUrl: { value: captured.licenseUrl },
      UsageTerms: { value: caseId === 'h1' ? 'Creative Commons Attribution 2.0' : 'Creative Commons Attribution-Share Alike 4.0' },
      Credit: { value: captured.notices }
    }
    const fetch = fakeFetch((u) =>
      u.hostname === 'commons.wikimedia.org' ? Response.json(response([page(1, raw)])) : new Response(new Uint8Array(bytes))
    )
    const service = new FreeImagesService({ fetch, processor })
    const found = await service.search(input)
    const id = found.candidates[0].id
    await service.view([id])
    const asset = await service.use(id, evaluation)
    expect(asset.credit).toBe(
      `Foto: ${caseId === 'h1' ? 'Cafeterías Nebraska' : 'Spielvogel'} · ${captured.license} · Wikimedia Commons · con cambios`
    )
    expect(asset.credit.length).toBeLessThanOrEqual(120)
    expect(asset.provenance.fullCredit).toContain(captured.author)
    expect(asset.provenance.notices).toBe(captured.notices)
    expect(asset.provenance.rawMetadata).toMatchObject({ Artist: captured.author, Credit: captured.notices })
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
    expect(asset.provenance.fullCredit).toContain('reducción de tamaño')
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
    expect(fetch).toHaveBeenCalledTimes(2) // One blocked attempt per provider, retained across rounds.
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
    expect(fetch).toHaveBeenCalledTimes(4) // Three Commons attempts and one bounded secondary-index attempt.
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
    expect(denied).toHaveBeenCalledTimes(2) // One Commons attempt and one secondary-index attempt; no 403 retry.
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
    // Two queries + two bounded variants + one secondary index; two thumbnails, one finalist batch and two originals.
    expect(urls).toHaveLength(10)
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
    await expect(service.search({ ...input, queries: ['single'] })).rejects.toThrow('queries: usa de dos a ocho')
  })
})

describe('tercera ronda: orientación, cobertura y verificación de origen', () => {
  it.each(['landscape', 'horizontal', 'any', 'cualquiera'] as const)(
    'acepta requirements.orientation=%s y la conserva en la segunda ronda',
    async (orientation) => {
      const service = new FreeImagesService({ fetch: fakeFetch(), processor })
      const first = await service.search({ ...input, requirements: { ...input.requirements!, orientation } })
      expect(first.candidates).toHaveLength(1)
      const second = await service.search({
        searchId: first.searchId,
        queries: ['café interior', 'cafe interior'],
        requirements: { subject: input.requirements!.subject, usage: 'portada' }
      })
      const id = second.candidates[0].id
      await service.view([id])
      const asset = await service.use(id, evaluation)
      expect(asset.provenance.requirements.orientation).toBe(['any', 'cualquiera'].includes(orientation) ? 'any' : 'landscape')
      expect(asset.provenance.requirements.required).toEqual(input.requirements!.required)
    }
  )
  it.each(['portrait', 'vertical', 'square', 'cuadrada'] as const)(
    'filtra horizontales ante orientation=%s en requirements',
    async (orientation) => {
      expect(
        (
          await new FreeImagesService({ fetch: fakeFetch(), processor }).search({
            ...input,
            requirements: { ...input.requirements!, orientation }
          })
        ).candidates
      ).toEqual([])
    }
  )
  it('rechaza orientación desconocida y dos orientaciones contradictorias antes de red', async () => {
    const fetch = fakeFetch(),
      service = new FreeImagesService({ fetch, processor })
    await expect(service.search({ ...input, orientation: 'diagonal' as 'any' })).rejects.toThrow('orientation: usa')
    await expect(
      service.search({ ...input, orientation: 'portrait', requirements: { ...input.requirements!, orientation: 'horizontal' } })
    ).rejects.toThrow('contradice')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserva relevancia index de Commons y excluye watermark en plantilla/título, no copyright del autor', () => {
    const first = { ...page(1), index: 9 },
      second = { ...page(2), index: 1 }
    expect(parseCommonsImages(response([first, second])).map((p) => p.pageId)).toEqual([2, 1])
    const marked = page(3, { ...metadata, Categories: { value: 'Watermarked images' } } as typeof metadata)
    expect(parseCommonsImages(response([marked]))).toEqual([])
    const copyrightTitle = { ...page(), title: 'File:Photo copyright Example.jpg' }
    expect(parseCommonsImages(response([copyrightTitle]))).toEqual([])
    expect(parseCommonsImages(response([page(1, { ...metadata, Artist: { value: '© Example photographer' } })]))).toHaveLength(1)
  })
  it('amplía por su cuenta una consulta pobre y conserva resultado aunque otra consulta falle', async () => {
    const fetch = fakeFetch((u) => {
      if (u.hostname === 'api.openverse.org') return Response.json({ results: [] })
      if (u.hostname !== 'commons.wikimedia.org') return new Response(new Uint8Array(bytes))
      const q = u.searchParams.get('gsrsearch') ?? ''
      if (q.startsWith('coffee shop interior')) return Response.json(response())
      if (q.startsWith('cafe interior')) throw new Error('temporary timeout')
      return Response.json(response([]))
    })
    const found = await new FreeImagesService({ fetch, processor }).search({
      queries: ['cafetería de barrio', 'neighborhood cafe'],
      requirements: { subject: 'cafetería de barrio', usage: 'portada' }
    })
    expect(found.candidates).toHaveLength(1)
    const queries = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => new URL(String(url)))
      .filter((url) => url.searchParams.has('gsrsearch'))
    expect(queries.map((url) => url.searchParams.get('gsrsearch'))).toContain('coffee shop interior filetype:bitmap')
    expect(queries.every((url) => url.searchParams.get('gsrsort') === 'relevance')).toBe(true)
    expect(found.notice).toContain('Siguiente paso obligatorio')
  })
  it('una segunda consulta caída no borra las candidatas ya comprobadas', async () => {
    let calls = 0
    const fetch = fakeFetch((u) => {
      if (u.hostname === 'api.openverse.org') return Response.json({ results: [] })
      if (u.hostname !== 'commons.wikimedia.org') return new Response(new Uint8Array(bytes))
      if (++calls === 1) return Response.json(response())
      throw new Error('offline')
    })
    expect((await new FreeImagesService({ fetch, processor }).search(input)).candidates).toHaveLength(1)
    expect(calls).toBe(2)
  })
  const reference = () => ({
    id: '00000000-0000-4000-8000-000000000001',
    source: 'wikimedia',
    provider: 'wikimedia',
    foreign_landing_url: 'https://commons.wikimedia.org/wiki/File:Photo1.jpg',
    url: page().imageinfo[0].url,
    license: 'by-sa',
    license_version: '4.0',
    license_url: metadata.LicenseUrl.value
  })
  it('Openverse rescata búsqueda vacía sólo tras comprobar Commons y vuelve a comprobar al usar', async () => {
    let changed = false
    const fetch = fakeFetch((u) => {
      if (u.hostname === 'api.openverse.org') return Response.json({ results: [reference()] })
      if (u.hostname !== 'commons.wikimedia.org') return new Response(new Uint8Array(bytes))
      if (u.searchParams.has('generator')) return Response.json(response([]))
      return Response.json(response([page(1, changed ? { ...metadata, LicenseShortName: { value: 'CC BY-NC 4.0' } } : metadata)]))
    })
    let now = Date.now()
    const service = new FreeImagesService({ fetch, processor, now: () => now })
    const found = await service.search(input)
    expect(found.candidates).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => new URL(String(url)).searchParams.get('titles') === 'File:Photo1.jpg')).toBe(true)
    await service.view([found.candidates[0].id])
    changed = true
    now += 120001
    await expect(service.use(found.candidates[0].id, evaluation)).rejects.toThrow('licencia')
  })
  it.each([
    { url: 'https://127.0.0.1/private.jpg' },
    { foreign_landing_url: 'https://evil.test/wiki/File:Photo1.jpg' },
    { license: 'by-nc' },
    { license_url: 'https://creativecommons.org/licenses/by/4.0/' },
    { source: 'flickr', provider: 'flickr' }
  ])('rechaza Openverse sin identidad/licencia verificable %j', async (patch) => {
    const fetch = fakeFetch((u) => {
      if (u.hostname === 'api.openverse.org') return Response.json({ results: [{ ...reference(), ...patch }] })
      if (u.hostname !== 'commons.wikimedia.org') throw new Error('No debe descargar')
      return Response.json(u.searchParams.has('generator') ? response([]) : response())
    })
    expect((await new FreeImagesService({ fetch, processor }).search(input)).candidates).toEqual([])
    expect(
      vi.mocked(fetch).mock.calls.every(([url]) => ['api.openverse.org', 'commons.wikimedia.org'].includes(new URL(String(url)).hostname))
    ).toBe(true)
  })
})

describe('miniatura sin escalar y límites por proveedor', () => {
  it('acepta thumbnail_unscaled sólo verificando el original por SHA1 y dimensiones reales', async () => {
    const original = page()
    original.imageinfo[0].thumburl = `${original.imageinfo[0].url}?utm_content=thumbnail_unscaled`
    original.imageinfo[0].thumbwidth = 1280
    original.imageinfo[0].thumbheight = 853
    const fetch = fakeFetch((u) =>
      u.hostname === 'commons.wikimedia.org'
        ? Response.json(response([original]))
        : u.hostname === 'api.openverse.org'
          ? Response.json({ results: [] })
          : new Response(new Uint8Array(bytes))
    )
    const found = await new FreeImagesService({ fetch, processor }).search(input)
    expect(found.candidates).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('utm_content'))).toBe(false)
    const altered = Buffer.concat([bytes, Buffer.from('different original')])
    const badFetch = fakeFetch((u) =>
      u.hostname === 'commons.wikimedia.org'
        ? Response.json(response([original]))
        : u.hostname === 'api.openverse.org'
          ? Response.json({ results: [] })
          : new Response(new Uint8Array(altered))
    )
    expect((await new FreeImagesService({ fetch: badFetch, processor }).search(input)).candidates).toEqual([])
  })
  it('un Retry-After largo del índice secundario no bloquea ver/usar un original de Commons', async () => {
    const fetch = fakeFetch((u) =>
      u.hostname === 'commons.wikimedia.org'
        ? Response.json(response())
        : u.hostname === 'api.openverse.org'
          ? new Response('', { status: 429, headers: { 'retry-after': '3600' } })
          : new Response(new Uint8Array(bytes))
    )
    const sleep = vi.fn(async () => undefined)
    const service = new FreeImagesService({ fetch, processor, sleep })
    const found = await service.search(input)
    expect(found.candidates).toHaveLength(1)
    await service.view([found.candidates[0].id])
    expect((await service.use(found.candidates[0].id, evaluation)).provenance.status).toBe('licencia-comprobada')
    expect(sleep).not.toHaveBeenCalled()
  })
})
