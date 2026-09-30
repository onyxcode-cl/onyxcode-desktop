import { describe, expect, it } from 'vitest'
import { SANDBOX_PROVIDER_NOTICE, sandboxModelNotice } from './sandbox-providers'

describe('sandboxModelNotice', () => {
  it('OpenCode Go en sandbox: sin aviso', () => {
    expect(sandboxModelNotice(true, 'opencode-go')).toBeNull()
  })
  it('otro proveedor en sandbox: aviso claro', () => {
    for (const p of ['openai', 'anthropic', 'google', 'opencode']) expect(sandboxModelNotice(true, p)).toBe(SANDBOX_PROVIDER_NOTICE)
    expect(SANDBOX_PROVIDER_NOTICE).toContain('solo está disponible OpenCode Go')
  })
  it('Control total (sin sandbox): nunca avisa', () => {
    expect(sandboxModelNotice(false, 'openai')).toBeNull()
  })
})
