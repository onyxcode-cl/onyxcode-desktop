import { describe, expect, it } from 'vitest'
import { sandboxProviderNotice, sandboxModelNotice, sandboxSendBlocked } from './sandbox-providers'

describe('sandboxModelNotice', () => {
  it('OpenCode Go en sandbox: sin aviso', () => {
    expect(sandboxModelNotice(true, 'opencode-go')).toBeNull()
  })
  it('otro proveedor en sandbox: aviso claro', () => {
    for (const p of ['openai', 'anthropic', 'google']) expect(sandboxModelNotice(true, p)).toBe(sandboxProviderNotice())
    expect(sandboxProviderNotice()).toContain('solo está disponible OpenCode Go')
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
    expect(sandboxSendBlocked(['opencode-go', 'opencode'], 'openai')).toBe(sandboxProviderNotice())
    expect(sandboxSendBlocked(['opencode-go', 'opencode'], 'opencode-go')).toBeNull()
  })
  it('sin lista (consulta fallida) no bloquea', () => {
    expect(sandboxSendBlocked(null, 'openai')).toBeNull()
  })
})
