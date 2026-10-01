import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { findCatalogItem, MCP_CATALOG } from '@shared/mcp-catalog'

const userData = mkdtempSync(join(tmpdir(), 'onyx-mcpcat-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { buildCatalogEntry, catalogState, CatalogProvenanceStore, computeInstalled, installFromCatalog } from './mcp-catalog-install'
import { appOpencodeConfigPath, mcpAsksEachUse, readAppMcpConfig, removeMcpServer, saveMcpServer } from './mcp-config'

afterAll(() => rmSync(userData, { recursive: true, force: true }))

const TOKEN = 'ghp_' + 'a1B2c3D4e5'.repeat(4)
const store = new CatalogProvenanceStore(join(userData, 'mcp-catalog-installs.json'))
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(appOpencodeConfigPath(), 'utf8'))
const github = findCatalogItem('github')!
const context7 = findCatalogItem('context7')!
const linear = findCatalogItem('linear')!

beforeEach(() => {
  rmSync(join(userData, 'opencode'), { recursive: true, force: true })
  rmSync(join(userData, 'mcp-catalog-installs.json'), { force: true })
})

describe('buildCatalogEntry', () => {
  it('sin credencial: URL del catálogo y oauth:false; con enable:false queda desactivado', () => {
    expect(buildCatalogEntry(context7, {})).toEqual({ type: 'remote', url: context7.url, enabled: true, oauth: false })
    expect(buildCatalogEntry(context7, {}, false).enabled).toBe(false)
  })

  it('OAuth deja la autodetección (sin clave oauth) y sin cabeceras', () => {
    expect(buildCatalogEntry(linear, {})).toEqual({ type: 'remote', url: linear.url, enabled: true })
  })

  it('token: cabecera Authorization con la plantilla y oauth:false', () => {
    expect(buildCatalogEntry(github, { token: TOKEN })).toEqual({
      type: 'remote',
      url: github.url,
      enabled: true,
      headers: { Authorization: `Bearer ${TOKEN}` },
      oauth: false
    })
  })

  it('rechaza CR/LF, patrón, longitud, falta y datos desconocidos', () => {
    expect(() => buildCatalogEntry(github, { token: TOKEN + '\r\nX-Evil: 1' })).toThrow(/saltos de línea/)
    expect(() => buildCatalogEntry(github, { token: TOKEN + '\n' })).toThrow()
    expect(() => buildCatalogEntry(github, { token: 'no-es-un-token' })).toThrow(/formato/)
    expect(() => buildCatalogEntry(github, { token: 'ghp_' + 'a'.repeat(500) })).toThrow(/largo/)
    expect(() => buildCatalogEntry(github, {})).toThrow(/Falta/)
    expect(() => buildCatalogEntry(github, { token: '' })).toThrow(/Falta/)
    expect(() => buildCatalogEntry(github, { token: TOKEN, extra: 'x' })).toThrow(/desconocido/)
    expect(() => buildCatalogEntry(context7, { token: TOKEN })).toThrow(/desconocido/)
  })

  it('el mensaje de error nunca incluye el valor', () => {
    for (const v of ['mal-token-secreto-123', TOKEN + '\n']) {
      try {
        buildCatalogEntry(github, { token: v })
      } catch (e) {
        expect(String(e)).not.toContain(v.trim())
      }
    }
  })

  it('construye una entrada válida para cada ficha (con valores de ejemplo que cumplen su patrón)', () => {
    for (const i of MCP_CATALOG) {
      const inputs = Object.fromEntries(i.inputs.map((x) => [x.id, x.id === 'token' ? TOKEN : 'x']))
      const e = buildCatalogEntry(i, inputs)
      expect(e.url).toBe(i.url)
    }
  })
})

describe('installFromCatalog', () => {
  const base = { id: 'github', name: 'github', inputs: { token: TOKEN }, enable: true, askEachUse: true }

  it('escribe la entrada y «Preguntar antes de cada uso», con opencode.json en 0600 y procedencia en 0600', () => {
    installFromCatalog(store, base)
    const cfg = raw()
    expect((cfg.mcp as Record<string, unknown>).github).toEqual({
      type: 'remote',
      url: github.url,
      enabled: true,
      headers: { Authorization: `Bearer ${TOKEN}` },
      oauth: false
    })
    expect(cfg.permission).toEqual({ 'github_*': 'ask' })
    expect(Object.keys(cfg).sort()).toEqual(['$schema', 'mcp', 'permission'])
    expect(statSync(appOpencodeConfigPath()).mode & 0o777).toBe(0o600)
    const provPath = join(userData, 'mcp-catalog-installs.json')
    expect(statSync(provPath).mode & 0o777).toBe(0o600)
    const prov = JSON.parse(readFileSync(provPath, 'utf8'))
    expect(prov.github).toMatchObject({ catalogId: 'github', version: 1, url: github.url })
    // La procedencia no guarda el secreto.
    expect(readFileSync(provPath, 'utf8')).not.toContain(TOKEN)
    expect(mcpAsksEachUse('github')).toBe(true)
  })

  it('sin «Preguntar antes de cada uso» no escribe permission', () => {
    installFromCatalog(store, { ...base, askEachUse: false })
    expect(raw().permission).toBeUndefined()
    expect(mcpAsksEachUse('github')).toBe(false)
  })

  it('id desconocido, nombre inválido y valor inválido no escriben nada', () => {
    expect(() => installFromCatalog(store, { ...base, id: 'no-existe' })).toThrow(/catálogo/)
    expect(() => installFromCatalog(store, { ...base, name: '../x' })).toThrow(/Nombre/)
    expect(() => installFromCatalog(store, { ...base, inputs: { token: 'mal' } })).toThrow()
    expect(existsSync(join(userData, 'mcp-catalog-installs.json'))).toBe(false)
    expect(Object.keys(readAppMcpConfig().servers)).toEqual([])
  })

  it('colisión de nombre: error y no se pisa lo existente (ni su permiso)', () => {
    saveMcpServer('github', { type: 'remote', url: 'https://ejemplo.test/mcp', enabled: true })
    expect(() => installFromCatalog(store, base)).toThrow(/Ya existe/)
    expect(readAppMcpConfig().servers.github).toMatchObject({ url: 'https://ejemplo.test/mcp' })
    expect(store.read()).toEqual({})
    expect(raw().permission).toBeUndefined()
  })

  it('un permission global en cadena se conserva como {"*": valor} al añadir la regla', () => {
    saveMcpServer('otro', { type: 'remote', url: 'https://ejemplo.test/mcp' })
    const p = appOpencodeConfigPath()
    writeFileSync(p, JSON.stringify({ ...raw(), permission: 'allow', extra: { x: 1 } }))
    installFromCatalog(store, base)
    expect(raw().permission).toEqual({ '*': 'allow', 'github_*': 'ask' })
    expect(raw().extra).toEqual({ x: 1 })
  })

  it('si la procedencia no se puede guardar, se deshace el servidor y el permiso', () => {
    const bad = new CatalogProvenanceStore(join(userData, 'mcp-catalog-installs.json', 'no', 'cabe'))
    writeFileSync(join(userData, 'mcp-catalog-installs.json'), '{}') // un archivo donde debería haber carpeta
    expect(() => installFromCatalog(bad, base)).toThrow()
    expect(readAppMcpConfig().servers.github).toBeUndefined()
    expect(raw().permission).toBeUndefined()
  })
})

describe('desvío y limpieza', () => {
  it('sin cambios no hay desvío; editar URL, cabeceras u oauth lo marca como modificado', () => {
    const req = { id: 'github', name: 'github', inputs: { token: TOKEN }, enable: true, askEachUse: true }
    installFromCatalog(store, req)
    const drift = (): boolean | undefined => catalogState(store.read(), readAppMcpConfig()).installed.github?.drift
    expect(drift()).toBe(false)
    // activar/desactivar y cambiar el valor del token no es desvío
    saveMcpServer('github', { ...buildCatalogEntry(github, { token: 'ghp_' + 'z'.repeat(30) }), enabled: false }, 'github')
    expect(drift()).toBe(false)
    saveMcpServer(
      'github',
      { type: 'remote', url: 'https://otro.test/mcp', headers: { Authorization: 'Bearer x' }, oauth: false },
      'github'
    )
    expect(drift()).toBe(true)
    saveMcpServer(
      'github',
      { ...buildCatalogEntry(github, { token: TOKEN }), headers: { Authorization: 'Bearer x', 'X-Extra': '1' } },
      'github'
    )
    expect(drift()).toBe(true)
    saveMcpServer('github', { type: 'remote', url: github.url, headers: { Authorization: 'Bearer x' } }, 'github')
    expect(drift()).toBe(true) // oauth autodetectado donde el catálogo pone token
    saveMcpServer('github', { type: 'local', command: ['echo'] }, 'github')
    expect(drift()).toBe(true)
  })

  it('procedencia de una ficha que ya no existe cuenta como modificada; si el servidor desapareció, se ignora', () => {
    saveMcpServer('viejo', { type: 'remote', url: 'https://x.test/mcp' })
    writeFileSync(
      join(userData, 'mcp-catalog-installs.json'),
      JSON.stringify({
        viejo: { catalogId: 'ya-no-esta', version: 0, installedAt: 1, url: 'https://x.test/mcp' },
        fantasma: { catalogId: 'github', version: 1, installedAt: 1, url: github.url }
      })
    )
    expect(computeInstalled(store.read(), readAppMcpConfig())).toEqual({ viejo: { catalogId: 'ya-no-esta', drift: true } })
  })

  it('eliminar limpia la entrada, su permiso «ask» y la procedencia; una regla propia distinta se respeta', () => {
    installFromCatalog(store, { id: 'github', name: 'github', inputs: { token: TOKEN }, enable: true, askEachUse: true })
    installFromCatalog(store, { id: 'context7', name: 'context7', inputs: {}, enable: true, askEachUse: false })
    const p = appOpencodeConfigPath()
    writeFileSync(p, JSON.stringify({ ...raw(), permission: { ...(raw().permission as object), 'context7_*': 'allow' } }))
    removeMcpServer('github')
    store.forget('github')
    expect(raw().permission).toEqual({ 'context7_*': 'allow' })
    expect(Object.keys(store.read())).toEqual(['context7'])
    removeMcpServer('context7')
    expect(raw().permission).toEqual({ 'context7_*': 'allow' }) // no era «ask»: no se toca
    // Al quedar vacío, desaparece la clave `permission`.
    installFromCatalog(store, { id: 'github', name: 'github', inputs: { token: TOKEN }, enable: true, askEachUse: true })
    writeFileSync(p, JSON.stringify({ ...raw(), permission: { 'github_*': 'ask' } }))
    removeMcpServer('github')
    expect('permission' in raw()).toBe(false)
  })

  it('renombrar mueve la procedencia', () => {
    installFromCatalog(store, { id: 'context7', name: 'context7', inputs: {}, enable: true, askEachUse: false })
    store.rename('context7', 'docs')
    expect(Object.keys(store.read())).toEqual(['docs'])
  })

  it('un archivo de procedencia corrupto se trata como vacío', () => {
    writeFileSync(join(userData, 'mcp-catalog-installs.json'), '{no json')
    expect(store.read()).toEqual({})
    writeFileSync(join(userData, 'mcp-catalog-installs.json'), JSON.stringify({ a: { catalogId: 5 }, b: 'x' }))
    expect(store.read()).toEqual({})
  })
})
