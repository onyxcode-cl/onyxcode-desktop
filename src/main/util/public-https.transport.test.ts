import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:https', () => ({ request }))
import { pinnedHttpsRequest } from './public-https'

it('TLS mantiene hostname/certificado, no usa pool, cookies ni autorización, y fija lookup en ambas formas', async () => {
  request.mockImplementation((url, options, callback) => {
    expect(url.hostname).toBe('original.example')
    expect(options.agent).toBe(false)
    expect(options.rejectUnauthorized).not.toBe(false)
    expect(options.checkServerIdentity).toBeUndefined()
    expect(options.headers).not.toHaveProperty('Cookie')
    expect(options.headers).not.toHaveProperty('Authorization')
    const single = vi.fn(),
      all = vi.fn()
    options.lookup('original.example', {}, single)
    options.lookup('original.example', { all: true }, all)
    expect(single).toHaveBeenCalledWith(null, '8.8.8.8', 4)
    expect(all).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }])
    const req = new EventEmitter() as EventEmitter & { end: () => void }
    req.end = () => callback({ statusCode: 200, headers: {}, destroy: vi.fn() })
    return req
  })
  expect((await pinnedHttpsRequest(new URL('https://original.example/a'), '8.8.8.8', new AbortController().signal)).status).toBe(200)
})
