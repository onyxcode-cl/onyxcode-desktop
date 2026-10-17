import { describe, expect, it } from 'vitest'
import { DICTIONARIES } from '@shared/i18n'
import { buildSearchIndex, highlightParts, normalize, queryWords, searchSettings, shownText } from './search-index'
import { SECTION_KEYS } from './section-keys'

const SECTIONS = [
  { id: 'general', label: 'General', prefixes: ['settings.general.'] },
  { id: 'shortcuts', label: 'Atajos', prefixes: ['settings.shortcuts.'] },
  { id: 'import', label: 'Importar', prefixes: ['import.title', 'import.source.'] }
] as const

const REAL = Object.entries(SECTION_KEYS).map(([id, prefixes]) => ({ id, label: id, prefixes }))

describe('índice de búsqueda de Ajustes', () => {
  it('se construye solo con claves i18n del prefijo de cada sección y con su texto en el idioma activo', () => {
    const es = buildSearchIndex(SECTIONS, 'es')
    expect(es.length).toBeGreaterThan(10)
    for (const e of es) {
      const sec = SECTIONS.find((s) => s.id === e.section)!
      expect(sec.prefixes.some((p) => e.key === p || e.key.startsWith(p))).toBe(true)
      const msg = DICTIONARIES.es[e.key]
      const template = typeof msg === 'string' ? msg : msg.other
      expect(template.trim()).toBe(e.text) // el texto es exactamente el del diccionario, sin plantillas
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

  it('las plantillas con parámetros quedan fuera del índice (nada de «Clave de …»)', () => {
    for (const lang of ['es', 'en'] as const) {
      const idx = buildSearchIndex(REAL, lang)
      expect(idx.some((e) => /[{}]/.test(e.text) || e.text.includes('…'))).toBe(false)
      expect(idx.some((e) => e.key === 'models.form.keyOf' || e.key === 'models.keyTest.testing')).toBe(false)
    }
  })

  it('shownText corta en límite de palabra, solo con «…» al final, y conserva la coincidencia', () => {
    const long =
      'Primera frase corta. Esta segunda oración es bastante más larga y habla de claves guardadas en un lugar protegido de tu equipo, sin compartirlas con nadie más.'
    const w = ['claves']
    const out = shownText(long, w, 80)
    expect(out.length).toBeLessThanOrEqual(81)
    expect(out.slice(0, -1)).not.toContain('…')
    expect(normalize(out)).toContain('claves')
    expect(shownText('Texto corto', ['corto'])).toBe('Texto corto')
    // Parte por oraciones, pero no en abreviaturas como «p.ej.».
    const intro = 'Cuéntale a la IA cómo quieres que te responda y qué debe saber de ti. Se envían con cada mensaje de Chat y de Code, con el modelo que tengas conectado.'
    expect(shownText(intro, ['modelo'])).toBe('Se envían con cada mensaje de Chat y de Code, con el modelo que tengas conectado.')
    expect(shownText('El costo usa los precios (p.ej. OpenCode Go) es sólo referencial.', ['costo'])).toContain('p.ej. OpenCode')
  })

  it('agrupa casi-duplicados y limita con «más»', () => {
    const dict = {
      'a.x1': 'Abre el enlace en el navegador del celular y confirma aquí en el Mac.',
      'a.x2': 'Abre el enlace en el navegador del celular y confirma aquí en este PC.',
      'a.celular': 'Celular conectado',
      'a.c2': 'Todos los celulares',
      'a.c3': 'Filtrar por celular',
      'a.c4': 'Esperando al celular',
      'a.c5': 'Celulares vinculados'
    }
    const idx = buildSearchIndex([{ id: 'a', label: 'A', prefixes: ['a.'] }], 'es', dict)
    const [g] = searchSettings([{ id: 'a', label: 'A', prefixes: ['a.'] }], idx, 'celular')
    expect(g.entries).toHaveLength(4)
    expect(g.more.length).toBe(2) // 7 coinciden: 1 casi-duplicado descartado, 4 visibles, 2 en «Ver más»
    expect(g.entries.every((e) => e.text.length < 30)).toBe(true) // etiquetas antes que ayudas
  })

  for (const lang of ['es', 'en'] as const) {
    const q = lang === 'es' ? ['clave', 'modelo', 'memoria', 'permisos', 'celular', 'idioma'] : ['key', 'model', 'memory', 'permissions', 'phone', 'language']
    it(`consultas reales (${lang}): frases completas, sin «{»/«}» ni «…» en medio, y cada resultado enlaza a una opción existente`, () => {
      const idx = buildSearchIndex(REAL, lang)
      for (const query of q) {
        const groups = searchSettings(REAL, idx, query, 50)
        expect(groups.length, query).toBeGreaterThan(0)
        for (const g of groups)
          for (const e of [...g.entries, ...g.more]) {
            expect(e.shown, e.key).not.toMatch(/[{}]/)
            expect(e.shown.slice(0, -1), e.key).not.toContain('…')
            expect(e.shown.startsWith('…'), e.key).toBe(false)
            expect(DICTIONARIES[lang][e.key], e.key).toBeDefined()
            expect(e.anchor.length, e.key).toBeGreaterThan(2)
            expect(e.text.includes(e.anchor), e.key).toBe(true)
            expect(normalize(e.shown), e.key).toContain(queryWords(query)[0])
          }
      }
    })
  }
})
