import { createServer } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { searchVideoMusic } from './music-search'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((done) => s.close(() => done()))
})
it('busca con servidor falso, convierte milisegundos y devuelve metadata y archivo directo', async () => {
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    expect(url.searchParams.get('q')).toBe('guitarra alegre')
    expect(url.searchParams.get('category')).toBe('music')
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        results: [
          {
            title: '<b>Guitarra</b>',
            creator: 'Artista',
            duration: 153000,
            category: 'music',
            genres: ['folk'],
            tags: [{ name: 'happy' }],
            license: 'by',
            license_url: 'https://creativecommons.org/licenses/by/4.0/',
            url: 'https://cdn.example.org/song.mp3'
          },
          { title: 'Sitio cerrado', category: 'music', url: 'https://open.spotify.com/a' },
          { category: 'music', url: 'http://example.com/a' },
          { category: 'sound_effect', url: 'https://example.com/a.wav' }
        ]
      })
    )
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  const result = await searchVideoMusic({ consulta: 'guitarra alegre', limite: 3 }, new AbortController().signal, {
    get: async (url) => Buffer.from(await (await fetch(`http://127.0.0.1:${port}/${new URL(url).search}`)).arrayBuffer())
  })
  expect(result.pistas).toEqual([
    expect.objectContaining({
      titulo: 'Guitarra',
      duracion: 153,
      generos: ['folk'],
      etiquetas: ['happy'],
      licencia: 'by',
      origen: 'https://cdn.example.org/song.mp3'
    })
  ])
})
it.each([{ consulta: '' }, { consulta: 'x', limite: 13 }, { consulta: 'x', url: 'https://example.com' }])(
  'rechaza entrada inválida %j sin red',
  async (args) => {
    await expect(
      searchVideoMusic(args, new AbortController().signal, {
        get: async () => {
          throw Error('no debe llegar aquí')
        }
      })
    ).rejects.toThrow('consulta')
  }
)
