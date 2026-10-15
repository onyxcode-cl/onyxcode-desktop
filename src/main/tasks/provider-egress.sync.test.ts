/** `SANDBOX_PROVIDER_IDS` (shared, lo ve el renderer) debe coincidir con `PROVIDER_TARGETS` (main) + 'opencode' (modelos gratis). */
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { SANDBOX_PROVIDER_IDS } from '../../shared/sandbox-providers'
import { PROVIDER_TARGETS } from './provider-egress'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getAppPath: () => process.cwd(), isPackaged: false } }))

describe('SANDBOX_PROVIDER_IDS y PROVIDER_TARGETS', () => {
  it('son la misma lista (más "opencode")', () => {
    expect([...SANDBOX_PROVIDER_IDS].sort()).toEqual([...Object.keys(PROVIDER_TARGETS), 'opencode'].sort())
  })
  it('sin duplicados', () => {
    expect(new Set(SANDBOX_PROVIDER_IDS).size).toBe(SANDBOX_PROVIDER_IDS.length)
  })
  it('cada destino es https, sin credenciales/puerto/IP, con prefijo sin barra final', () => {
    expect(Object.keys(PROVIDER_TARGETS).length).toBeGreaterThan(50)
    for (const [id, t] of Object.entries(PROVIDER_TARGETS)) {
      const u = new URL(t.origin)
      expect(u.protocol, id).toBe('https:')
      expect(u.origin, id).toBe(t.origin)
      expect(u.username + u.password + u.port + u.search + u.hash, id).toBe('')
      expect(u.hostname, id).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
      expect(u.hostname, id).not.toMatch(/(^|\.)(localhost|local|internal)$/)
      expect(t.host, id).toBe(u.hostname)
      expect(
        t.pathPrefix === '' || (t.pathPrefix.startsWith('/') && !t.pathPrefix.endsWith('/') && !/[?#${}\\]/.test(t.pathPrefix)),
        id
      ).toBe(true)
    }
  })
  it('destinos verificados a mano', () => {
    const at = (id: string): string => PROVIDER_TARGETS[id].origin + PROVIDER_TARGETS[id].pathPrefix
    expect(at('openai')).toBe('https://api.openai.com/v1')
    expect(at('anthropic')).toBe('https://api.anthropic.com/v1')
    expect(at('google')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(at('opencode-go')).toBe('https://opencode.ai/inference/go/v1')
    expect(at('openrouter')).toBe('https://openrouter.ai/api/v1')
    expect(at('groq')).toBe('https://api.groq.com/openai/v1')
  })
  it('excluidos: gratis, OAuth y nube no están', () => {
    for (const id of [
      'opencode',
      'github-copilot',
      'gitlab',
      'sap-ai-core',
      'amazon-bedrock',
      'azure',
      'google-vertex',
      'cloudflare-workers-ai'
    ])
      expect(Object.keys(PROVIDER_TARGETS), id).not.toContain(id)
    expect(SANDBOX_PROVIDER_IDS).toContain('opencode')
  })
})
