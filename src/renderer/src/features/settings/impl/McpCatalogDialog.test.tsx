import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { findCatalogItem, MCP_CATALOG } from '@shared/mcp-catalog'
import { McpCatalogDialog, previewJson, suggestName, verifiedText } from './McpCatalogDialog'

describe('McpCatalogDialog', () => {
  it('suggestName propone -2, -3… si el nombre ya existe', () => {
    expect(suggestName('github', [])).toBe('github')
    expect(suggestName('github', ['github'])).toBe('github-2')
    expect(suggestName('github', ['github', 'github-2'])).toBe('github-3')
  })

  it('la vista previa enmascara el secreto y describe exactamente lo que se guarda', () => {
    const gh = findCatalogItem('github')!
    const json = previewJson(gh, 'github', true, true)
    expect(json).toContain('Bearer ••••')
    expect(JSON.parse(json)).toEqual({
      mcp: { github: { type: 'remote', url: gh.url, enabled: true, headers: { Authorization: 'Bearer ••••' }, oauth: false } },
      permission: { 'github_*': 'ask' }
    })
    expect(JSON.parse(previewJson(gh, 'github', true, false)).permission).toBeUndefined()
    const lin = findCatalogItem('linear')!
    expect(JSON.parse(previewJson(lin, 'linear', true, false))).toEqual({
      mcp: { linear: { type: 'remote', url: lin.url, enabled: true } }
    })
  })

  it('la fecha de verificación sale en español', () => {
    expect(verifiedText('2026-10-01')).toBe('1 de octubre de 2026')
  })

  it('cada ficha se muestra con host en negrita, URL completa, JSON, Cancelar y «Añadir y conectar»', () => {
    for (const item of MCP_CATALOG) {
      const html = renderToStaticMarkup(
        createElement(McpCatalogDialog, { item, existingNames: [], onCancel: () => undefined, onInstall: async () => undefined })
      )
      expect(html, item.id).toContain(`<strong>${new URL(item.url).host}</strong>`)
      expect(html, item.id).toContain(item.url)
      expect(html, item.id).toContain('Cancelar')
      expect(html, item.id).toContain('Añadir y conectar')
      expect(html, item.id).toContain('Preguntar antes de cada uso')
      expect(html, item.id).toContain('Verificado el')
      expect(html, item.id).toContain('Disponible en Tareas')
      expect(html, item.id).toMatch(/aria-label="Disponible en Tareas"[^>]*disabled|disabled=""[^>]*aria-label="Disponible en Tareas"/)
      if (item.auth === 'token') expect(html, item.id).toContain('type="password"')
    }
  })
})
