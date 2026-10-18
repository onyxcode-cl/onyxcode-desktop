import { describe, expect, it } from 'vitest'
import type { McpStatus } from '@opencode-ai/sdk/v2/client'
import type { AppMcpConfig } from '@shared/ipc-extras'
import { CATALOG } from '@shared/catalogo'
import { authKey, connectorState, formatBytes, localUnsupported, skillTag, visibleGroups } from './logic'
import { matchesQuery, normalize } from './search'

const cfg = (servers: AppMcpConfig['servers']): AppMcpConfig => ({ path: '/x', servers })
const remote = (enabled?: boolean): AppMcpConfig['servers'][string] => ({
  type: 'remote',
  url: 'https://x.example/mcp',
  ...(enabled === undefined ? {} : { enabled })
})

describe('estado de un conector', () => {
  it('sin servidor: no añadido', () => {
    expect(connectorState(null, cfg({}), {})).toBe('none')
  })
  it('conectado solo si el motor lo dice', () => {
    const st = { github: { status: 'connected' } } as Record<string, McpStatus>
    expect(connectorState('github', cfg({ github: remote() }), st)).toBe('connected')
    // Añadido y encendido pero el motor aún no informó: no se afirma «conectado».
    expect(connectorState('github', cfg({ github: remote() }), {})).toBe('off')
  })
  it('falta iniciar sesión, problema y apagado', () => {
    const c = cfg({ a: remote() })
    expect(connectorState('a', c, { a: { status: 'needs_auth' } } as Record<string, McpStatus>)).toBe('needs-login')
    expect(connectorState('a', c, { a: { status: 'needs_client_registration', error: 'x' } } as Record<string, McpStatus>)).toBe(
      'needs-login'
    )
    expect(connectorState('a', c, { a: { status: 'failed', error: 'x' } } as Record<string, McpStatus>)).toBe('problem')
    expect(connectorState('a', c, { a: { status: 'disabled' } } as Record<string, McpStatus>)).toBe('off')
    expect(connectorState('a', cfg({ a: remote(false) }), {})).toBe('off')
  })
})

describe('grupos y etiquetas', () => {
  it('los grupos sin fichas se ocultan y se respeta el orden del catálogo', () => {
    const g = visibleGroups(CATALOG.groups, CATALOG.connectors)
    expect(g.map((x) => x.group.id)).toEqual(['correo-calendario', 'desarrollo', 'proyectos-notas'])
    expect(g.every((x) => x.items.length > 0)).toBe(true)
    expect(visibleGroups(CATALOG.groups, [])).toEqual([])
  })
  it('etiquetas de habilidad', () => {
    expect([skillTag('bundled'), skillTag('user'), skillTag('available')]).toEqual(['included', 'installed', 'install'])
  })
  it('qué pide cada conector', () => {
    expect(authKey({ auth: 'none' })).toBe('pers.auth.none')
    expect(authKey({ auth: 'token' })).toBe('pers.auth.token')
    expect(authKey({ auth: 'oauth' })).toBe('pers.auth.oauth')
  })
  it('tamaños', () => {
    expect(formatBytes(512, 'es-CL')).toBe('512 B')
    expect(formatBytes(2048, 'es-CL')).toMatch(/^2 KB$/)
    expect(formatBytes(3 * 1024 * 1024, 'en-US')).toBe('3 MB')
  })
})

describe('buscador', () => {
  it('ignora tildes y mayúsculas y exige todas las palabras', () => {
    expect(normalize('Planillás')).toBe('planillas')
    expect(matchesQuery('word', ['Documentos de Word'])).toBe(true)
    expect(matchesQuery('DOCUMENTÓS word', ['Documentos de Word'])).toBe(true)
    expect(matchesQuery('word excel', ['Documentos de Word'])).toBe(false)
    expect(matchesQuery('', ['x'])).toBe(true)
    expect(matchesQuery('  ', [])).toBe(true)
    expect(matchesQuery('a', [undefined])).toBe(false)
  })
})

describe('fichas locales según la plataforma', () => {
  const locales = CATALOG.connectors.filter((c) => c.transport === 'local')
  it('las de correo y calendario solo valen en Mac', () => {
    expect(locales.length).toBeGreaterThan(0)
    for (const c of locales) {
      expect(localUnsupported(c, 'darwin')).toBe(false)
      expect(localUnsupported(c, 'win32')).toBe(true)
    }
  })
})
