import { describe, expect, it } from 'vitest'
import { fallbackImageQueries, hasImageOverlay, matchesOrientation, normalizeOrientation, rankImageCandidates } from './free-images-search'
import { parseOpenverseReferences } from './free-images-openverse'
import type { FreeImageRequirements } from './free-images'
const req = (subject: string, rest: Partial<FreeImageRequirements> = {}): FreeImageRequirements => ({
  subject,
  required: [],
  excluded: [],
  usage: 'portada',
  realPhoto: true,
  ...rest
})
describe('planificador y orden local de candidatas', () => {
  it('expande inglés/general sin borrar lugar, acción ni requisitos, y deduplica', () => {
    const r = req('pingüino de Humboldt', { place: 'Chile', required: ['costa'], action: 'nadando' })
    const queries = fallbackImageQueries(r, ['pingüino de Humboldt nadando en costa Chile'])
    expect(queries).toEqual(['Humboldt penguin nadando Chile costa', 'Spheniscus humboldti nadando Chile costa'])
    expect(fallbackImageQueries(req('cafetería'), ['coffee shop interior'])).toEqual(['cafe interior'])
    expect(fallbackImageQueries(req('objeto especial', { place: 'Santiago' }), ['consulta muy compleja'])).toEqual([
      'objeto especial Santiago'
    ])
  })
  it('orientaciones excluyentes incluyen cuadrados reales', () => {
    expect(matchesOrientation(1000, 1000, 'cuadrada')).toBe(true)
    expect(matchesOrientation(1000, 1000, 'horizontal')).toBe(false)
    expect(matchesOrientation(1000, 1000, 'vertical')).toBe(false)
    expect(matchesOrientation(1200, 800, 'cualquiera')).toBe(true)
  })
  it('no confunde reserva chilena, otro pingüino o zoológico extranjero con Humboldt en Chile', () => {
    const photos = [
      { title: 'Humboldt penguin at zoo', description: 'England' },
      {
        title: 'Jote',
        description: 'Reserva Nacional Pingüino de Humboldt, Chile',
        categories: 'Pingüino de Humboldt Nature Reserve|Birds of Chile'
      },
      { title: 'Young Magellanic penguins', description: 'Chile' },
      { title: 'Humboldt penguin', description: 'Spheniscus humboldti at Isla Damas, Chile' }
    ]
    expect(rankImageCandidates(photos, req('pingüino de Humboldt', { place: 'Chile' }))).toEqual([photos[3]])
  })
  it('descarta polilla colibrí, excluidos, y prioriza barrio/interior frente a cadena', () => {
    expect(rankImageCandidates([{ title: 'Hummingbird hawk-moth', description: 'Macroglossum' }], req('colibrí'))).toEqual([])
    const photos = [
      { title: 'Starbucks coffee shop interior', description: 'Tables' },
      { title: 'Café en barrio Yungay', description: '', categories: 'Interiors of shops in Chile' },
      { title: 'Café con taza aislada', description: '' }
    ]
    expect(rankImageCandidates(photos, req('cafetería de barrio', { excluded: ['taza aislada'] }))).toEqual([photos[1], photos[0]])
  })
  it('marca de agua explícita, copyright en título y texto superpuesto; permite copyright del autor', () => {
    expect(hasImageOverlay('Photo', { ImageDescription: { value: 'Text overlay on photograph' } })).toBe(true)
    expect(hasImageOverlay('Photo', { Watermark: { value: 'true' } })).toBe(true)
    expect(hasImageOverlay('Photo', { ObjectName: { value: '© Keven Law' } })).toBe(true)
    expect(hasImageOverlay('Photo', { Artist: { value: '© Keven Law' } })).toBe(false)
  })
  it('PDM del índice sólo es una referencia provisional, no inventa fundamento PD', () => {
    const reference = {
      id: '00000000-0000-4000-8000-000000000001',
      provider: 'wikimedia',
      source: 'wikimedia',
      foreign_landing_url: 'https://commons.wikimedia.org/wiki/File:Old_photo.jpg',
      url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Old.jpg',
      license: 'pdm',
      license_version: '1.0',
      license_url: 'https://creativecommons.org/publicdomain/mark/1.0/'
    }
    expect(parseOpenverseReferences({ results: [reference] })[0].license.name).toBe('Dominio público')
    expect(
      parseOpenverseReferences({ results: [{ ...reference, foreign_landing_url: 'https://commons.wikimedia.org/wiki/File:A%7CB.jpg' }] })
    ).toEqual([])
  })
})

it('Humboldt fuera de un pedido de pingüinos no activa filtro de especie; una foto real excluye composiciones estéreo', () => {
  const university = { title: 'Humboldt University', description: 'Berlin' }
  expect(rankImageCandidates([university], req('Universidad Humboldt'))).toEqual([university])
  expect(
    rankImageCandidates(
      [{ title: 'Dinosaur fossil 3D', description: 'Museum', categories: 'Stereoscopic 3D files (side-by-side parallel)' }],
      req('dinosaur fossil museum')
    )
  ).toEqual([])
})

it.each(['__proto__', 'constructor', 'toString', 'diagonal'])(
  'rechaza orientación desconocida %s sin heredar claves del objeto',
  (value) => {
    expect(normalizeOrientation(value)).toBeUndefined()
  }
)
