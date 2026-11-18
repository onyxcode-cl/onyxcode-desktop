import { describe, expect, it, vi } from 'vitest'
import { publicHttpsBytes, publicAddress, type PublicResponse, type PublicHttpsDeps } from './public-https'

const signal = () => new AbortController().signal
const reply = (status = 200, chunks = [Buffer.from('ok')], extras = {}): PublicResponse => ({
  status,
  body: (async function* () {
    yield* chunks
  })(),
  cancel: vi.fn(),
  ...extras
})
const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])

describe('descargas HTTPS del host', () => {
  it.each([
    'http://example.com/a',
    'file:///a',
    'https://user:pass@example.com/a',
    'https://example.com:444/a',
    'https://localhost/a',
    'https://printer.local/a',
    'https://127.1/a',
    'https://2130706433/a',
    'https://[::1]/a',
    'https://[::ffff:7f00:1]/a'
  ])('rechaza %s antes del socket', async (url) => {
    const request = vi.fn()
    await expect(publicHttpsBytes(url, 20, signal(), { resolve, request })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
  it.each([
    '10.1.2.3',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    'fe90::1',
    'fd00::1',
    '::ffff:192.168.1.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1'
  ])('bloquea IP resuelta %s y DNS mixto', async (address) => {
    expect(publicAddress(address)).toBe(false)
    const request = vi.fn()
    await expect(
      publicHttpsBytes('https://example.com/a', 20, signal(), {
        resolve: async () => [
          { address: '8.8.8.8', family: 4 },
          { address, family: address.includes(':') ? 6 : 4 }
        ],
        request
      })
    ).rejects.toThrow('IP públicas')
    expect(request).not.toHaveBeenCalled()
  })
  it('pasa la dirección validada al transporte, sin segunda resolución (rebinding)', async () => {
    let calls = 0
    const request = vi.fn(async (_url, address) => {
      expect(address).toBe('93.184.216.34')
      return reply()
    })
    await publicHttpsBytes('https://example.com/a', 20, signal(), {
      resolve: async () => [{ address: ++calls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }],
      request
    })
    expect(calls).toBe(1)
    expect(request).toHaveBeenCalledOnce()
  })
  it('revalida cada salto y cancela sus cuerpos', async () => {
    const redirect = reply(302, [], { location: 'https://cdn.example.org/foto' }),
      final = reply()
    const request = vi.fn().mockResolvedValueOnce(redirect).mockResolvedValueOnce(final)
    const result = await publicHttpsBytes('https://example.com/a', 20, signal(), { resolve, request })
    expect(result.url).toBe('https://cdn.example.org/foto')
    expect(redirect.cancel).toHaveBeenCalledOnce()
    expect(final.cancel).toHaveBeenCalledOnce()
  })
  it.each(['http://example.org/a', 'https://127.0.0.1/a', 'https://[::1]/a'])('rechaza redirección %s', async (location) => {
    const request = vi.fn(async () => reply(302, [], { location }))
    await expect(publicHttpsBytes('https://example.com/a', 20, signal(), { resolve, request })).rejects.toThrow()
    expect(request).toHaveBeenCalledOnce()
  })
  it('también rechaza DNS privado en el destino de una redirección', async () => {
    const request = vi.fn(async () => reply(302, [], { location: 'https://evil.example/a' }))
    await expect(
      publicHttpsBytes('https://example.com/a', 20, signal(), {
        resolve: async (host) => [{ address: host === 'evil.example' ? '10.0.0.1' : '8.8.8.8', family: 4 }],
        request
      })
    ).rejects.toThrow('IP públicas')
    expect(request).toHaveBeenCalledOnce()
  })
  it('admite solo tres redirecciones', async () => {
    const request = vi.fn(async () => reply(302, [], { location: '/otra' }))
    await expect(publicHttpsBytes('https://example.com/a', 20, signal(), { resolve, request })).rejects.toThrow('redirecciones')
    expect(request).toHaveBeenCalledTimes(4)
  })
  it.each([reply(200, [], { length: '21' }), reply(200, [Buffer.alloc(11), Buffer.alloc(10)])])(
    'acota Content-Length y bytes recibidos',
    async (res) => {
      await expect(publicHttpsBytes('https://example.com/a', 20, signal(), { resolve, request: async () => res })).rejects.toThrow('grande')
      expect(res.cancel).toHaveBeenCalledOnce()
    }
  )
  it('el plazo cubre DNS y cuerpo lento', async () => {
    // Un timer normal mantiene vivo el proceso mientras AbortSignal.timeout vence.
    const keep = setTimeout(() => {}, 1000)
    try {
      for (const deps of [
        { resolve: () => new Promise(() => {}) },
        {
          resolve,
          request: async () =>
            reply(200, [], {
              body: (async function* () {
                await new Promise(() => {})
                yield Buffer.alloc(1)
              })()
            })
        }
      ] as PublicHttpsDeps[]) {
        await expect(publicHttpsBytes('https://example.com/a', 20, signal(), { ...deps, timeoutMs: 10 })).rejects.toThrow()
      }
    } finally {
      clearTimeout(keep)
    }
  })
})
