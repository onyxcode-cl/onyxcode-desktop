import { describe, expect, it } from 'vitest'
import { findCatalogItem, MCP_CATALOG, MCP_CATALOG_VERSION, MCP_NAME_RE } from './mcp-catalog'

/** Dominio registrable que debe tener cada proveedor (el host de la URL tiene que terminar en uno de ellos). */
const DOMAINS: Record<string, string[]> = {
  context7: ['context7.com'],
  'cloudflare-docs': ['cloudflare.com'],
  github: ['githubcopilot.com', 'github.com'],
  linear: ['linear.app'],
  notion: ['notion.com'],
  sentry: ['sentry.dev', 'sentry.io'],
  atlassian: ['atlassian.com']
}

/** Documentación: el dominio del proveedor, salvo Context7, cuya documentación oficial es el README de su repositorio. */
const DOCS_EXTRA: Record<string, string[]> = { context7: ['github.com'] }

const hostOf = (url: string): string => new URL(url).hostname
const endsWithDomain = (host: string, d: string): boolean => host === d || host.endsWith(`.${d}`)

describe('catálogo MCP curado', () => {
  it('hay fichas y la versión es un entero positivo', () => {
    expect(MCP_CATALOG.length).toBeGreaterThan(0)
    expect(Number.isInteger(MCP_CATALOG_VERSION) && MCP_CATALOG_VERSION > 0).toBe(true)
  })

  it('ids y nombres únicos; el nombre cumple NAME_RE y el id el formato del esquema IPC', () => {
    expect(new Set(MCP_CATALOG.map((i) => i.id)).size).toBe(MCP_CATALOG.length)
    expect(new Set(MCP_CATALOG.map((i) => i.name)).size).toBe(MCP_CATALOG.length)
    for (const i of MCP_CATALOG) {
      expect(MCP_NAME_RE.test(i.name), i.id).toBe(true)
      expect(/^[a-z0-9-]{1,64}$/.test(i.id), i.id).toBe(true)
      expect(findCatalogItem(i.id)).toBe(i)
    }
  })

  it('solo remotas, https, sin credenciales ni query en la URL', () => {
    for (const i of MCP_CATALOG) {
      expect(i.transport, i.id).toBe('remote')
      const u = new URL(i.url)
      expect(u.protocol, i.id).toBe('https:')
      expect(u.username + u.password + u.search + u.hash, i.id).toBe('')
      expect(new URL(i.docsUrl).protocol, `${i.id} docs`).toBe('https:')
    }
  })

  it('el host coincide con el dominio del proveedor (y todas las fichas están en la tabla)', () => {
    expect(Object.keys(DOMAINS).sort()).toEqual(MCP_CATALOG.map((i) => i.id).sort())
    for (const i of MCP_CATALOG) {
      expect(
        DOMAINS[i.id].some((d) => endsWithDomain(hostOf(i.url), d)),
        `${i.id}: ${hostOf(i.url)}`
      ).toBe(true)
      expect(
        [...DOMAINS[i.id], ...(DOCS_EXTRA[i.id] ?? [])].some((d) => endsWithDomain(hostOf(i.docsUrl), d)),
        `${i.id} docs: ${hostOf(i.docsUrl)}`
      ).toBe(true)
    }
  })

  it('coherencia de autenticación: token ⇔ entradas secretas; el resto sin entradas', () => {
    for (const i of MCP_CATALOG) {
      if (i.auth === 'token') {
        expect(i.inputs.length, i.id).toBeGreaterThan(0)
        expect(
          i.inputs.every((x) => x.kind === 'secret'),
          i.id
        ).toBe(true)
      } else {
        expect(i.inputs, i.id).toEqual([])
      }
    }
  })

  it('patrones anclados, válidos, con una sola {value}, sin secretos por defecto y sin inyección de cabeceras', () => {
    const ids = new Set<string>()
    for (const i of MCP_CATALOG) {
      for (const input of i.inputs) {
        expect(ids.has(`${i.id}/${input.id}`)).toBe(false)
        ids.add(`${i.id}/${input.id}`)
        expect(input.pattern.startsWith('^') && input.pattern.endsWith('$'), `${i.id}/${input.id}`).toBe(true)
        const re = new RegExp(input.pattern)
        // El patrón nunca debe admitir CR/LF/NUL ni espacios.
        for (const bad of ['', 'a\nb', 'a\r\nX: y', 'a b', 'a\0b']) expect(re.test(bad), `${input.id} ${JSON.stringify(bad)}`).toBe(false)
        expect(input.target.template.split('{value}').length - 1, `${i.id}/${input.id}`).toBe(1)
        expect(/^[A-Za-z][A-Za-z0-9-]*$/.test(input.target.header), input.target.header).toBe(true)
        expect(input.maxLength).toBeGreaterThan(0)
        expect(input.maxLength).toBeLessThanOrEqual(4096)
        expect('default' in input || 'value' in input, `${i.id}/${input.id} sin valor por defecto`).toBe(false)
      }
      // Ninguna ficha lleva un secreto incrustado en su texto.
      expect(JSON.stringify({ ...i, inputs: [] }), i.id).not.toMatch(
        /ghp_[A-Za-z0-9]{10}|github_pat_[A-Za-z0-9_]{10}|sk-[A-Za-z0-9]{10}|Bearer\s+\S{12}/
      )
    }
  })

  it('GitHub acepta tokens clásicos y de grano fino y rechaza basura', () => {
    const re = new RegExp(findCatalogItem('github')!.inputs[0].pattern)
    expect(re.test('ghp_' + 'a'.repeat(36))).toBe(true)
    expect(re.test('github_pat_' + 'A1_'.repeat(20))).toBe(true)
    for (const bad of ['ghp_corto', 'token', 'Bearer ' + 'a'.repeat(40), 'ghp_' + 'a'.repeat(36) + '\n'])
      expect(re.test(bad), bad).toBe(false)
  })

  it('verifiedAt es una fecha real, no futura; los textos obligatorios no están vacíos', () => {
    for (const i of MCP_CATALOG) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(i.verifiedAt), i.id).toBe(true)
      const t = Date.parse(`${i.verifiedAt}T00:00:00Z`)
      expect(Number.isNaN(t), i.id).toBe(false)
      expect(new Date(t).toISOString().slice(0, 10), i.id).toBe(i.verifiedAt)
      expect(t, i.id).toBeLessThanOrEqual(Date.now() + 86_400_000)
      for (const k of ['title', 'publisher', 'description', 'dataLeaves'] as const)
        expect(i[k].trim().length, `${i.id}.${k}`).toBeGreaterThan(0)
      expect(i.capabilities.length, i.id).toBeGreaterThan(0)
      expect(typeof i.writes, i.id).toBe('boolean')
    }
  })

  it('el texto visible no nombra productos de terceros prohibidos (Claude, Anthropic, Artifact)', () => {
    for (const i of MCP_CATALOG) {
      const text = [
        i.title,
        i.publisher,
        i.description,
        i.dataLeaves,
        ...i.capabilities,
        ...i.inputs.map((x) => `${x.label} ${x.help ?? ''}`)
      ].join('\n')
      expect(text, i.id).not.toMatch(/Claude|Anthropic|Artifacts?\b/)
    }
  })
})
