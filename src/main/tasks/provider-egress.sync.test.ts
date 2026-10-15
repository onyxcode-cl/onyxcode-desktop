/** `SANDBOX_PROVIDER_IDS` (shared, lo ve el renderer) debe coincidir con `PROVIDER_TARGETS` (main) + 'opencode' (modelos gratis). */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SANDBOX_PROVIDER_IDS } from '../../shared/sandbox-providers'
import { PROVIDER_TARGETS } from './provider-egress'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getAppPath: () => process.cwd(), isPackaged: false } }))

/** ids leídos del TEXTO del archivo generado (independiente de lo que exportan los módulos). */
const generatedText = readFileSync(join(process.cwd(), 'src/shared/provider-targets.generated.ts'), 'utf8')
const idsInFile = [...generatedText.matchAll(/^ {2}(?:'([^']+)'|([A-Za-z0-9_$]+)): \{/gm)].map((m) => m[1] ?? m[2])
const sharedText = readFileSync(join(process.cwd(), 'src/shared/sandbox-providers.ts'), 'utf8')

describe('SANDBOX_PROVIDER_IDS y PROVIDER_TARGETS', () => {
  it('el archivo generado tiene entradas y sin duplicados', () => {
    expect(idsInFile.length).toBeGreaterThan(50)
    expect(new Set(idsInFile).size).toBe(idsInFile.length)
  })
  it('PROVIDER_TARGETS = ids del archivo generado', () => {
    expect(Object.keys(PROVIDER_TARGETS).sort()).toEqual([...idsInFile].sort())
  })
  it('SANDBOX_PROVIDER_IDS = ids del archivo generado + "opencode"', () => {
    expect([...SANDBOX_PROVIDER_IDS].sort()).toEqual([...idsInFile, 'opencode'].sort())
    expect(new Set(SANDBOX_PROVIDER_IDS).size).toBe(SANDBOX_PROVIDER_IDS.length)
  })
  it('sandbox-providers.ts no mantiene una lista de ids a mano', () => {
    expect(sharedText).toContain('GENERATED_PROVIDER_TARGETS')
    expect(sharedText).not.toMatch(/'openai'/)
  })
  it('snapshot del mapa completo id → origin + pathPrefix (cualquier cambio sale en el diff)', () => {
    const map = Object.fromEntries(Object.entries(PROVIDER_TARGETS).map(([id, t]) => [id, `${t.origin}${t.pathPrefix}`]))
    expect(map).toMatchSnapshot()
  })
  it('cada destino es https, sin credenciales/puerto/IP, con prefijo sin barra final', () => {
    for (const [id, t] of Object.entries(PROVIDER_TARGETS)) {
      const u = new URL(t.origin)
      expect(u.protocol, id).toBe('https:')
      expect(u.origin, id).toBe(t.origin)
      expect(u.username + u.password + u.port + u.search + u.hash, id).toBe('')
      expect(u.hostname, id).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
      expect(u.hostname, id).not.toMatch(/(^|\.)(localhost|local|internal)$/)
      expect(
        t.pathPrefix === '' || (t.pathPrefix.startsWith('/') && !t.pathPrefix.endsWith('/') && !/[?#${}\\;]/.test(t.pathPrefix)),
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
