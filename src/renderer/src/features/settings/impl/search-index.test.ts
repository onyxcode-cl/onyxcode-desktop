import { describe, expect, it } from 'vitest'
import { DICTIONARIES } from '@shared/i18n'
import { buildSearchIndex, highlightParts, normalize, queryWords, searchSettings } from './search-index'

const SECTIONS = [
  { id: 'general', label: 'General', prefixes: ['settings.general.'] },
  { id: 'shortcuts', label: 'Atajos', prefixes: ['settings.shortcuts.'] },
  { id: 'import', label: 'Importar', prefixes: ['import.title', 'import.source.'] }
] as const

describe('índice de búsqueda de Ajustes', () => {
  it('se construye solo con claves i18n del prefijo de cada sección y con su texto en el idioma activo', () => {
    const es = buildSearchIndex(SECTIONS, 'es')
    expect(es.length).toBeGreaterThan(10)
    for (const e of es) {
      const sec = SECTIONS.find((s) => s.id === e.section)!
      expect(sec.prefixes.some((p) => e.key === p || e.key.startsWith(p))).toBe(true)
      const msg = DICTIONARIES.es[e.key]
      const template = typeof msg === 'string' ? msg : msg.other
      expect(template.replace(/\{[^}]*\}/g, '…').trim()).toBe(e.text) // el texto es exactamente el del diccionario
    }
    const en = buildSearchIndex(SECTIONS, 'en')
    expect(en.map((e) => e.key)).toEqual(expect.arrayContaining(es.slice(0, 3).map((e) => e.key)))
    expect(en.find((e) => e.key === 'import.title')?.text).toBe('Import from other tools')
  })

  it('no incluye errores ni etiquetas de accesibilidad', () => {
    const idx = buildSearchIndex(SECTIONS, 'es')
    expect(idx.some((e) => /(error|fail|aria)/i.test(e.key.slice(e.key.lastIndexOf('.') + 1)))).toBe(false)
  })

  it('una clave solo pertenece a la primera sección que la reclama', () => {
    const idx = buildSearchIndex(
      [
        { id: 'a', label: 'A', prefixes: ['import.title'] },
        { id: 'b', label: 'B', prefixes: ['import.title'] }
      ],
      'es'
    )
    expect(idx.map((e) => e.section)).toEqual(['a'])
  })

  it('normaliza tildes y mayúsculas, y exige todas las palabras', () => {
    expect(normalize('Conexión')).toBe('conexion')
    expect(queryWords('  Tema   OSCURO ')).toEqual(['tema', 'oscuro'])
    const idx = buildSearchIndex(SECTIONS, 'es')
    const hits = searchSettings(SECTIONS, idx, 'IMPORTAR')
    expect(hits[0].section).toBe('import')
    expect(hits[0].titleMatch).toBe(true)
  })

  it('agrupa por sección, limita las opciones y devuelve vacío sin consulta o sin coincidencias', () => {
    const idx = buildSearchIndex(SECTIONS, 'es')
    expect(searchSettings(SECTIONS, idx, '')).toEqual([])
    expect(searchSettings(SECTIONS, idx, 'zzzxxyy')).toEqual([])
    const groups = searchSettings(SECTIONS, idx, 'a', 3)
    for (const g of groups) expect(g.entries.length).toBeLessThanOrEqual(3)
    expect(new Set(groups.map((g) => g.section)).size).toBe(groups.length)
  })

  it('resalta las coincidencias sin tildes y conserva el texto original', () => {
    const parts = highlightParts('Conexión de red', 'conexion')
    expect(parts.map((p) => p.text).join('')).toBe('Conexión de red')
    expect(parts.find((p) => p.hit)?.text).toBe('Conexión')
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', hit: false }])
  })
})
