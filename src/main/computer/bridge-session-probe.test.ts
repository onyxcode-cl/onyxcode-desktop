import { describe, expect, it } from 'vitest'
import { createBridgeSessionProbe } from './bridge-session-probe'

const REF = { baseUrl: 'http://127.0.0.1:4000/', authorization: 'Basic abc', directory: '/Users/ana/p a' }
const mk = (status: number | Error, ref: typeof REF | null = REF) => {
  const urls: string[] = []
  const probe = createBridgeSessionProbe({
    server: () => ref,
    fetchImpl: (async (u: string, init: RequestInit) => {
      urls.push(`${u}|${(init.headers as Record<string, string>).authorization}`)
      if (status instanceof Error) throw status
      return new Response(null, { status })
    }) as unknown as typeof fetch
  })
  return { probe, urls }
}

describe('createBridgeSessionProbe', () => {
  it('200 ⇒ live, con credenciales internas y carpeta', async () => {
    const { probe, urls } = mk(200)
    expect(await probe('/k', 'ses_abc')).toBe('live')
    expect(urls[0]).toBe('http://127.0.0.1:4000/session/ses_abc?directory=%2FUsers%2Fana%2Fp%20a|Basic abc')
  })
  it('404 ⇒ dead; 500, error de red o servidor desconocido ⇒ unknown', async () => {
    expect(await mk(404).probe('/k', 'ses_abc')).toBe('dead')
    expect(await mk(500).probe('/k', 'ses_abc')).toBe('unknown')
    expect(await mk(new Error('ECONNREFUSED')).probe('/k', 'ses_abc')).toBe('unknown')
    expect(await mk(200, null).probe('/k', 'ses_abc')).toBe('unknown')
    expect(await mk(200).probe('/k', '../x')).toBe('unknown')
  })
})
