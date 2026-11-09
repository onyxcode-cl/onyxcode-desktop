/**
 * Comparar con la confianza obligatoria del motor (lazunox.16): las copias (worktrees) que crea la propia app no pasan por ningún diálogo,
 * así que la app las declara al motor justo antes de cada llamada con esa carpeta (también al retomar una comparación tras reiniciar).
 */
import { describe, expect, it, vi } from 'vitest'
import { PERMISSION_REPLACE_BODY } from '@shared/permission-rules'
import { withTrustDeclared, type CompareEngine } from './engine'

vi.mock('../code/work-registry', () => ({ noteWork: () => undefined }))

function stub(log: string[]): CompareEngine {
  const rec = (n: string) => async (a: unknown) => {
    log.push(`motor:${n}`)
    void a
    return undefined as never
  }
  return {
    createSession: async () => (log.push('motor:createSession'), 's1'),
    prompt: rec('prompt'),
    abort: rec('abort'),
    statuses: async () => (log.push('motor:statuses'), {}),
    messages: async () => (log.push('motor:messages'), []),
    children: async () => (log.push('motor:children'), []),
    deleteSession: rec('deleteSession')
  }
}

describe('withTrustDeclared', () => {
  it('declara la carpeta ANTES de cada llamada que la usa', async () => {
    const log: string[] = []
    const e = withTrustDeclared(stub(log), async (d) => void log.push(`declara:${d}`))
    await e.createSession({ directory: '/wt/1', title: 't', agent: 'build', metadata: {} })
    await e.prompt({ sessionID: 's', directory: '/wt/1', agent: 'build', model: { providerID: 'p', modelID: 'm' }, text: 'x' })
    await e.statuses('/wt/2')
    await e.messages({ sessionID: 's', directory: '/wt/2' })
    await e.children({ sessionID: 's', directory: '/wt/2' })
    await e.abort({ sessionID: 's', directory: '/wt/1' })
    await e.deleteSession({ sessionID: 's', directory: '/wt/1' })
    expect(log).toEqual([
      'declara:/wt/1',
      'motor:createSession',
      'declara:/wt/1',
      'motor:prompt',
      'declara:/wt/2',
      'motor:statuses',
      'declara:/wt/2',
      'motor:messages',
      'declara:/wt/2',
      'motor:children',
      'declara:/wt/1',
      'motor:abort',
      'declara:/wt/1',
      'motor:deleteSession'
    ])
  })
  it('si declarar lanza, la llamada sigue (nunca rompe la comparación)', async () => {
    const log: string[] = []
    const e = withTrustDeclared(stub(log), () => Promise.reject(new Error('sin motor')))
    await expect(e.statuses('/wt/1')).resolves.toEqual({})
    expect(log).toEqual(['motor:statuses'])
  })
})

describe('Comparar: bloque del modo con replace', () => {
  it('la sesión de una comparación en modo código nace con permissionMode replace (campo del SDK con prefijo $body_)', async () => {
    const calls: Array<Record<string, unknown>> = []
    vi.resetModules()
    vi.doMock('@opencode-ai/sdk/v2/client', () => ({
      createOpencodeClient: () => ({ session: { create: async (a: Record<string, unknown>) => (calls.push(a), { data: { id: 'x' } }) } })
    }))
    const { createSdkEngine } = await import('./engine')
    await createSdkEngine({ baseUrl: 'http://x', authorization: 'a' }).createSession({
      directory: '/wt/1',
      title: 't',
      agent: 'build',
      metadata: {},
      permission: [{ permission: 'edit', pattern: '*', action: 'ask' }]
    })
    expect(calls[0]).toMatchObject({ ...PERMISSION_REPLACE_BODY, directory: '/wt/1' })
    vi.doUnmock('@opencode-ai/sdk/v2/client')
  })
})
