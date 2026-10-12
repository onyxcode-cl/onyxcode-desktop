import { describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_IMAGE_HOSTS,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_URL_LENGTH,
  extractImageRefs,
  inlineRemoteImages,
  isAllowedImageUrl,
  isPrivateAddress,
  sniffImage
} from './remote-images'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const publicDns = async (): Promise<string[]> => ['93.184.216.34']
const ok = (body: Uint8Array, headers: Record<string, string> = {}): Response =>
  new Response(body as unknown as BodyInit, { status: 200, headers })

describe('isAllowedImageUrl', () => {
  it('acepta https de los bancos de imágenes permitidos', () => {
    for (const h of ALLOWED_IMAGE_HOSTS) expect(isAllowedImageUrl(`https://${h}/foto.jpg?w=800`)).toBe(true)
  })
  it('rechaza http, otros dominios, credenciales, puertos, IP y URL demasiado larga', () => {
    expect(isAllowedImageUrl('http://images.unsplash.com/a.jpg')).toBe(false)
    expect(isAllowedImageUrl('https://evil.example/a.jpg')).toBe(false)
    expect(isAllowedImageUrl('https://images.unsplash.com.evil.example/a.jpg')).toBe(false)
    expect(isAllowedImageUrl('https://user:pw@images.unsplash.com/a.jpg')).toBe(false)
    expect(isAllowedImageUrl('https://images.unsplash.com:8443/a.jpg')).toBe(false)
    expect(isAllowedImageUrl('https://127.0.0.1/a.jpg')).toBe(false)
    expect(isAllowedImageUrl('https://[::1]/a.jpg')).toBe(false)
    expect(isAllowedImageUrl(`https://images.unsplash.com/${'a'.repeat(MAX_URL_LENGTH)}`)).toBe(false)
    expect(isAllowedImageUrl('no es una url')).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:10.0.0.1'
  ])('%s es privada o reservada', (ip) => expect(isPrivateAddress(ip)).toBe(true))
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('%s es pública', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false)
  )
})

describe('sniffImage', () => {
  it('reconoce PNG y JPEG y rechaza SVG, HTML y vacío', () => {
    expect(sniffImage(PNG)).toBe('image/png')
    expect(sniffImage(JPG)).toBe('image/jpeg')
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
  })
})

describe('extractImageRefs', () => {
  it('toma <img src> y url() de CSS, ignora lo que no es https y decodifica &amp;', () => {
    const html = `<img src="https://images.unsplash.com/a.jpg?w=1&amp;q=80"><img src='https://images.pexels.com/b.png'>
      <div style="background:url('https://upload.wikimedia.org/c.jpg')"></div><style>.x{background-image:url(https://cdn.pixabay.com/d.jpg)}</style>
      <img src="data:image/png;base64,AAAA"><img src="http://images.unsplash.com/no.jpg"><a href="https://images.unsplash.com/enlace.jpg">x</a>`
    const refs = extractImageRefs(html)
    expect([...refs.values()].sort()).toEqual(
      [
        'https://cdn.pixabay.com/d.jpg',
        'https://images.pexels.com/b.png',
        'https://images.unsplash.com/a.jpg?w=1&q=80',
        'https://upload.wikimedia.org/c.jpg'
      ].sort()
    )
    expect(refs.get('https://images.unsplash.com/a.jpg?w=1&amp;q=80')).toBe('https://images.unsplash.com/a.jpg?w=1&q=80')
  })
})

describe('inlineRemoteImages', () => {
  it('sin imágenes de internet devuelve el HTML tal cual y no hace peticiones', async () => {
    const fetchImpl = vi.fn()
    const r = await inlineRemoteImages('<p>hola</p><img src="data:image/png;base64,AAAA">', { fetchImpl, resolveHost: publicDns })
    expect(r).toEqual({ html: '<p>hola</p><img src="data:image/png;base64,AAAA">', inlined: 0, blocked: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('descarga, incrusta como data: y pide sin cookies ni credenciales', async () => {
    const fetchImpl = vi.fn(async () => ok(PNG))
    const r = await inlineRemoteImages('<img src="https://images.unsplash.com/a.jpg?w=1&amp;q=2">', { fetchImpl, resolveHost: publicDns })
    expect(r.inlined).toBe(1)
    expect(r.html).toContain(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
    expect(r.html).not.toContain('unsplash')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://images.unsplash.com/a.jpg?w=1&q=2',
      expect.objectContaining({ credentials: 'omit', redirect: 'manual' })
    )
  })

  it('un dominio no permitido NO se pide y queda una imagen gris que lo explica', async () => {
    const fetchImpl = vi.fn()
    const r = await inlineRemoteImages('<img src="https://evil.example/leak?data=secreto">', { fetchImpl, resolveHost: publicDns })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.blocked).toEqual(['https://evil.example/leak?data=secreto'])
    expect(r.html).not.toContain('evil.example')
    expect(r.html).toContain('data:image/svg+xml;base64,')
  })

  it('un dominio permitido que resuelve a una red privada se descarta', async () => {
    const fetchImpl = vi.fn()
    const r = await inlineRemoteImages('<img src="https://images.unsplash.com/a.jpg">', {
      fetchImpl,
      resolveHost: async () => ['192.168.1.5']
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.inlined).toBe(0)
  })

  it('una redirección a otro dominio se valida y se descarta', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } }))
    const r = await inlineRemoteImages('<img src="https://images.unsplash.com/a.jpg">', { fetchImpl, resolveHost: publicDns })
    expect(r.inlined).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('una redirección dentro del dominio permitido se sigue', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/a.jpg') ? new Response(null, { status: 302, headers: { location: '/b.jpg' } }) : ok(JPG)
    )
    const r = await inlineRemoteImages('<img src="https://images.unsplash.com/a.jpg">', { fetchImpl, resolveHost: publicDns })
    expect(r.inlined).toBe(1)
    expect(r.html).toContain('data:image/jpeg;base64,')
  })

  it('descarta lo que no es una imagen real (SVG o HTML con tipo falso) y lo demasiado grande', async () => {
    const svg = vi.fn(async () => ok(new TextEncoder().encode('<svg onload="alert(1)"/>'), { 'content-type': 'image/png' }))
    expect(
      (await inlineRemoteImages('<img src="https://images.unsplash.com/a.png">', { fetchImpl: svg, resolveHost: publicDns })).inlined
    ).toBe(0)
    const big = vi.fn(async () => ok(new Uint8Array(MAX_IMAGE_BYTES + 10).fill(0xff), { 'content-length': String(MAX_IMAGE_BYTES + 10) }))
    expect(
      (await inlineRemoteImages('<img src="https://images.unsplash.com/g.jpg">', { fetchImpl: big, resolveHost: publicDns })).inlined
    ).toBe(0)
  })

  it('hay un máximo de imágenes por documento', async () => {
    const html = Array.from({ length: MAX_IMAGES + 3 }, (_, i) => `<img src="https://images.unsplash.com/${i}.jpg">`).join('')
    const fetchImpl = vi.fn(async () => ok(JPG))
    const r = await inlineRemoteImages(html, { fetchImpl, resolveHost: publicDns })
    expect(r.inlined).toBe(MAX_IMAGES)
    expect(r.blocked).toHaveLength(3)
  })

  it('un fallo de red no rompe el documento', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('sin red')
    })
    const r = await inlineRemoteImages('<h1>Título</h1><img src="https://images.unsplash.com/a.jpg">', {
      fetchImpl,
      resolveHost: publicDns
    })
    expect(r.html).toContain('<h1>Título</h1>')
    expect(r.inlined).toBe(0)
    expect(r.blocked).toHaveLength(1)
  })
})
