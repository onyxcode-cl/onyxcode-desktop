import { afterEach, describe, expect, it } from 'vitest'
import { DICTIONARIES, setLang } from './i18n'
import { catalogText, MCP_CATALOG } from './mcp-catalog'

afterEach(() => setLang('es'))

describe('catálogo MCP: textos por idioma', () => {
  it('en español la ficha se muestra tal cual está guardada', () => {
    for (const item of MCP_CATALOG) {
      const c = catalogText(item)
      expect(c.title, item.id).toBe(item.title)
      expect(c.description, item.id).toBe(item.description)
      expect(c.capabilities, item.id).toEqual(item.capabilities)
      expect(c.dataLeaves, item.id).toBe(item.dataLeaves)
      for (const i of item.inputs) expect(c.inputs[i.id], item.id).toEqual({ label: i.label, help: i.help })
    }
  })

  it('cada ficha tiene su traducción al inglés (no cae al español)', () => {
    for (const item of MCP_CATALOG) {
      const p = `mcp.cat.${item.id}`
      for (const key of [`${p}.title`, `${p}.description`, `${p}.leaves`, ...item.capabilities.map((_, i) => `${p}.cap${i + 1}`)])
        expect(DICTIONARIES.en[key], key).toBeTruthy()
      setLang('en')
      const c = catalogText(item)
      expect(c.description, item.id).not.toBe(item.description)
      expect(c.dataLeaves, item.id).not.toBe(item.dataLeaves)
      setLang('es')
    }
  })

  it('el inglés no usa términos prohibidos', () => {
    setLang('en')
    for (const item of MCP_CATALOG) {
      const c = catalogText(item)
      const text = [c.title, c.description, c.dataLeaves, ...c.capabilities].join(' ')
      expect(text, item.id).not.toMatch(/claude|anthropic|artifact/i)
    }
  })
})
