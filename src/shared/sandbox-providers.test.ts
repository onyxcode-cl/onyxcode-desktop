import { describe, expect, it } from 'vitest'
import { sandboxProviderNotice, sandboxProviderPendingNotice, sandboxModelNotice, sandboxSendBlocked } from './sandbox-providers'

describe('sandboxModelNotice', () => {
  it('OpenCode Go en sandbox: sin aviso', () => {
    for (const p of ['opencode-go', 'openai', 'anthropic', 'google']) expect(sandboxModelNotice(true, p)).toBeNull()
  })
  it('otro proveedor en sandbox: aviso claro', () => {
    for (const p of ['github-copilot', 'amazon-bedrock', 'azure', 'google-vertex'])
      expect(sandboxModelNotice(true, p)).toBe(sandboxProviderNotice())
    expect(sandboxProviderNotice()).toContain('clave')
    expect(sandboxProviderNotice()).not.toContain('solo está disponible OpenCode Go')
  })
  it('los modelos gratuitos de OpenCode no llevan aviso', () => {
    expect(sandboxModelNotice(true, 'opencode')).toBeNull()
  })
  it('Control total (sin sandbox): nunca avisa', () => {
    expect(sandboxModelNotice(false, 'openai')).toBeNull()
  })
})

describe('sandboxSendBlocked', () => {
  it('bloquea solo si el servidor sandboxeado no tiene el proveedor', () => {
    expect(sandboxSendBlocked(['opencode-go', 'opencode'], 'amazon-bedrock')).toBe(sandboxProviderNotice())
    expect(sandboxSendBlocked(['opencode-go', 'opencode'], 'opencode-go')).toBeNull()
  })
  it('distingue «OpenCode Go aún no llegó» de «proveedor no admitido»', () => {
    expect(sandboxSendBlocked(['opencode'], 'opencode-go')).toBe(sandboxProviderPendingNotice())
    expect(sandboxProviderPendingNotice()).toContain('aún no llegó')
    expect(sandboxProviderPendingNotice()).not.toBe(sandboxProviderNotice())
    expect(sandboxSendBlocked(['opencode'], 'github-copilot')).toBe(sandboxProviderNotice())
    expect(sandboxSendBlocked(['opencode'], 'openai')).toBe(sandboxProviderPendingNotice())
  })
  it('sin lista (consulta fallida) no bloquea', () => {
    expect(sandboxSendBlocked(null, 'openai')).toBeNull()
  })
})
