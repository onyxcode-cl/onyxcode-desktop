import { describe, expect, it } from 'vitest'
import {
  MAX_ENTRY_CHARS,
  MAX_ENTRIES,
  type LearnedMemoryEntry,
  addEntry,
  clampEntryText,
  formatForPrompt,
  newEntryId,
  parseLearnedMemory,
  removeEntry,
  serializeLearnedMemory
} from './memory-format'

describe('clampEntryText', () => {
  it('texto corto no cambia', () => {
    expect(clampEntryText('hola mundo')).toBe('hola mundo')
  })

  it('texto de exactamente MAX_ENTRY_CHARS no cambia', () => {
    const text = 'a'.repeat(MAX_ENTRY_CHARS)
    expect(clampEntryText(text)).toBe(text)
  })

  it('texto de más de MAX_ENTRY_CHARS se recorta a MAX_ENTRY_CHARS - 1 con "…" al final', () => {
    const text = 'a'.repeat(MAX_ENTRY_CHARS + 10)
    const result = clampEntryText(text)
    expect(result.length).toBe(MAX_ENTRY_CHARS)
    expect(result.endsWith('…')).toBe(true)
    expect(result.slice(0, -1)).toBe('a'.repeat(MAX_ENTRY_CHARS - 1))
  })

  it('trimea espacios al principio y final', () => {
    expect(clampEntryText('  hola mundo  ')).toBe('hola mundo')
  })

  it('trimea y recorta si es necesario', () => {
    const text = '  ' + 'a'.repeat(MAX_ENTRY_CHARS + 10) + '  '
    const result = clampEntryText(text)
    expect(result.length).toBe(MAX_ENTRY_CHARS)
    expect(result.endsWith('…')).toBe(true)
  })
})

describe('newEntryId', () => {
  it('devuelve 8 caracteres hexadecimales', () => {
    const id = newEntryId()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('con random inyectada determinística devuelve resultado determinístico', () => {
    let counter = 0
    const deterministicRandom = () => {
      counter = (counter + 1) % 16
      return counter / 16
    }
    const id = newEntryId(deterministicRandom)
    expect(id).toBe('12345678')
  })

  it('diferentes llamadas dan ids diferentes (con Math.random)', () => {
    const id1 = newEntryId()
    const id2 = newEntryId()
    expect(id1).not.toBe(id2)
  })
})

describe('parseLearnedMemory y serializeLearnedMemory', () => {
  it('ida y vuelta: serialize → parse devuelve las mismas entradas (reordenadas por tipo y fecha)', () => {
    const original: LearnedMemoryEntry[] = [
      { id: 'aaaaaaaa', tipo: 'preferencia', texto: 'No usar callbacks', fecha: '2026-10-01' },
      { id: 'bbbbbbbb', tipo: 'decision', texto: 'Usar TypeScript en todo', fecha: '2026-10-02' },
      { id: 'cccccccc', tipo: 'convencion', texto: 'Comentar en español', fecha: '2026-10-03' }
    ]
    const serialized = serializeLearnedMemory(original, { alcance: 'usuario', titulo: 'Mi memoria' })
    const parsed = parseLearnedMemory(serialized)

    expect(parsed).toHaveLength(3)
    // El serialize reordena por tipo (preferencia, convencion, decision, solucion) y fecha desc
    // Así que esperamos ese nuevo orden
    expect(parsed[0].id).toBe('aaaaaaaa') // preferencia
    expect(parsed[1].id).toBe('cccccccc') // convencion
    expect(parsed[2].id).toBe('bbbbbbbb') // decision
    // Pero los textos y tipos deben ser iguales
    const ids = new Set(parsed.map((e) => e.id))
    expect(ids).toEqual(new Set(['aaaaaaaa', 'bbbbbbbb', 'cccccccc']))
  })

  it('línea de viñeta sin comentario de metadatos se conserva con id nuevo y fecha vacía', () => {
    const md = `## Preferencias
- Esta línea fue escrita a mano
- Otra línea <!-- m-abcdef12 · 2026-10-01 -->
`
    const parsed = parseLearnedMemory(md)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].texto).toBe('Esta línea fue escrita a mano')
    expect(parsed[0].fecha).toBe('')
    expect(parsed[0].id).toMatch(/^[0-9a-f]{8}$/)
    expect(parsed[1].texto).toBe('Otra línea')
    expect(parsed[1].fecha).toBe('2026-10-01')
  })

  it('línea que no está bajo ningún encabezado de tipo conocida se ignora', () => {
    const md = `Texto suelto sin encabezado
## Preferencias
- Hecho 1 <!-- m-aaaaaaaa · 2026-10-01 -->

Más texto suelto aquí

## TipoDesconocido
- Esto también se ignora
`
    const parsed = parseLearnedMemory(md)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].texto).toBe('Hecho 1')
  })

  it('serializeLearnedMemory agrupa por tipo en el orden correcto', () => {
    const entries: LearnedMemoryEntry[] = [
      { id: 'aa', tipo: 'solucion', texto: 'Usar Map', fecha: '2026-10-01' },
      { id: 'bb', tipo: 'preferencia', texto: 'No callbacks', fecha: '2026-10-02' },
      { id: 'cc', tipo: 'decision', texto: 'TypeScript', fecha: '2026-10-03' },
      { id: 'dd', tipo: 'convencion', texto: 'Español', fecha: '2026-10-04' }
    ]
    const serialized = serializeLearnedMemory(entries, { alcance: 'usuario', titulo: 'Prueba' })
    const sections = serialized.split('## ')
    // Después del split quedan: ['...\n# Prueba\n\n', 'Preferencias\n...', 'Convenciones\n...', 'Decisiones\n...', 'Soluciones\n...']
    expect(sections[1].startsWith('Preferencias')).toBe(true)
    expect(sections[2].startsWith('Convenciones')).toBe(true)
    expect(sections[3].startsWith('Decisiones')).toBe(true)
    expect(sections[4].startsWith('Soluciones')).toBe(true)
  })

  it('serializeLearnedMemory incluye alcance en el encabezado YAML', () => {
    const serialized = serializeLearnedMemory([], { alcance: 'proyecto', titulo: 'Test' })
    expect(serialized).toContain('alcance: proyecto')
  })

  it('serializeLearnedMemory incluye carpeta en el encabezado YAML si se pasa', () => {
    const withCarpeta = serializeLearnedMemory([], { alcance: 'proyecto', carpeta: 'apps/web', titulo: 'Test' })
    expect(withCarpeta).toContain('carpeta: apps/web')

    const withoutCarpeta = serializeLearnedMemory([], { alcance: 'usuario', titulo: 'Test' })
    expect(withoutCarpeta).not.toContain('carpeta:')
  })

  it('serializeLearnedMemory ordena dentro de cada tipo por fecha descendente', () => {
    const entries: LearnedMemoryEntry[] = [
      { id: 'aa', tipo: 'preferencia', texto: 'Vieja', fecha: '2026-10-01' },
      { id: 'bb', tipo: 'preferencia', texto: 'Nueva', fecha: '2026-10-03' },
      { id: 'cc', tipo: 'preferencia', texto: 'Intermedia', fecha: '2026-10-02' }
    ]
    const serialized = serializeLearnedMemory(entries, { alcance: 'usuario', titulo: 'Test' })
    const lines = serialized.split('\n')
    const prefsStart = lines.findIndex((l) => l === '## Preferencias')
    // Las tres líneas de viñeta después de "## Preferencias"
    const bullets = lines.slice(prefsStart + 1, prefsStart + 4)
    expect(bullets[0]).toContain('Nueva')
    expect(bullets[1]).toContain('Intermedia')
    expect(bullets[2]).toContain('Vieja')
  })
})

describe('addEntry', () => {
  it('agrega una entrada si no se ha llegado al tope', () => {
    const entries: LearnedMemoryEntry[] = [{ id: 'aa', tipo: 'preferencia', texto: 'Hecho 1', fecha: '2026-10-01' }]
    const newEntry: LearnedMemoryEntry = { id: 'bb', tipo: 'decision', texto: 'Hecho 2', fecha: '2026-10-02' }
    const { entries: result, added } = addEntry(entries, newEntry, 'usuario')

    expect(added).toBe(true)
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual(newEntry)
  })

  it('no agrega si se ha llegado al tope (40 para usuario)', () => {
    const entries: LearnedMemoryEntry[] = Array.from({ length: MAX_ENTRIES.usuario }, (_, i) => ({
      id: `id${i}`,
      tipo: 'preferencia',
      texto: `Hecho ${i}`,
      fecha: '2026-10-01'
    }))
    const newEntry: LearnedMemoryEntry = { id: 'new', tipo: 'decision', texto: 'Nuevo', fecha: '2026-10-02' }
    const { entries: result, added } = addEntry(entries, newEntry, 'usuario')

    expect(added).toBe(false)
    expect(result).toHaveLength(MAX_ENTRIES.usuario)
  })

  it('recorta el texto de la entrada si es necesario', () => {
    const entries: LearnedMemoryEntry[] = []
    const newEntry: LearnedMemoryEntry = {
      id: 'aa',
      tipo: 'preferencia',
      texto: 'a'.repeat(MAX_ENTRY_CHARS + 50),
      fecha: '2026-10-01'
    }
    const { entries: result, added } = addEntry(entries, newEntry, 'usuario')

    expect(added).toBe(true)
    expect(result[0].texto.length).toBe(MAX_ENTRY_CHARS)
    expect(result[0].texto.endsWith('…')).toBe(true)
  })

  it('respeta el tope para scope "proyecto" (60)', () => {
    const entries: LearnedMemoryEntry[] = Array.from({ length: MAX_ENTRIES.proyecto }, (_, i) => ({
      id: `id${i}`,
      tipo: 'preferencia',
      texto: `Hecho ${i}`,
      fecha: '2026-10-01'
    }))
    const newEntry: LearnedMemoryEntry = { id: 'new', tipo: 'decision', texto: 'Nuevo', fecha: '2026-10-02' }
    const { added } = addEntry(entries, newEntry, 'proyecto')

    expect(added).toBe(false)
  })

  it('no agrega un texto ya guardado con el mismo tipo (ignora mayúsculas, tildes y espacios de más)', () => {
    const entries: LearnedMemoryEntry[] = [{ id: 'aa', tipo: 'preferencia', texto: 'Usa Prettier', fecha: '2026-10-01' }]
    const { entries: result, added } = addEntry(
      entries,
      { id: 'bb', tipo: 'preferencia', texto: '  usa   prettier  ', fecha: '2026-10-02' },
      'usuario'
    )
    expect(added).toBe(false)
    expect(result).toHaveLength(1)
  })

  it('el mismo texto pero con otro tipo SÍ se agrega (no es el mismo hecho)', () => {
    const entries: LearnedMemoryEntry[] = [{ id: 'aa', tipo: 'preferencia', texto: 'Usa Prettier', fecha: '2026-10-01' }]
    const { entries: result, added } = addEntry(
      entries,
      { id: 'bb', tipo: 'convencion', texto: 'Usa Prettier', fecha: '2026-10-02' },
      'usuario'
    )
    expect(added).toBe(true)
    expect(result).toHaveLength(2)
  })
})

describe('removeEntry', () => {
  it('quita la entrada que coincide por id', () => {
    const entries: LearnedMemoryEntry[] = [
      { id: 'aa', tipo: 'preferencia', texto: 'Hecho 1', fecha: '2026-10-01' },
      { id: 'bb', tipo: 'decision', texto: 'Hecho 2', fecha: '2026-10-02' }
    ]
    const { entries: result, removed } = removeEntry(entries, 'aa')

    expect(removed).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('bb')
  })

  it('con un id que no existe, removed es false y el array queda igual', () => {
    const entries: LearnedMemoryEntry[] = [{ id: 'aa', tipo: 'preferencia', texto: 'Hecho 1', fecha: '2026-10-01' }]
    const { entries: result, removed } = removeEntry(entries, 'no-existe')

    expect(removed).toBe(false)
    expect(result).toEqual(entries)
  })

  it('puede quitar múltiples veces', () => {
    let entries: LearnedMemoryEntry[] = [
      { id: 'aa', tipo: 'preferencia', texto: 'Hecho 1', fecha: '2026-10-01' },
      { id: 'bb', tipo: 'decision', texto: 'Hecho 2', fecha: '2026-10-02' },
      { id: 'cc', tipo: 'convencion', texto: 'Hecho 3', fecha: '2026-10-03' }
    ]

    let result = removeEntry(entries, 'bb')
    expect(result.removed).toBe(true)
    entries = result.entries

    result = removeEntry(entries, 'aa')
    expect(result.removed).toBe(true)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].id).toBe('cc')
  })
})

describe('formatForPrompt', () => {
  it('con entradas de 2 tipos distintos, resultado tiene las dos secciones agrupadas', () => {
    const entries: LearnedMemoryEntry[] = [
      { id: 'aa', tipo: 'preferencia', texto: 'No usar callbacks', fecha: '2026-10-01' },
      { id: 'bb', tipo: 'decision', texto: 'Usar TypeScript', fecha: '2026-10-02' }
    ]
    const result = formatForPrompt(entries)

    expect(result).toContain('Preferencias:')
    expect(result).toContain('Decisiones:')
    expect(result).toContain('- No usar callbacks')
    expect(result).toContain('- Usar TypeScript')
  })

  it('resultado NO contiene comentarios HTML de metadatos', () => {
    const entries: LearnedMemoryEntry[] = [{ id: 'aaaaaaaa', tipo: 'preferencia', texto: 'Hecho 1', fecha: '2026-10-01' }]
    const result = formatForPrompt(entries)

    expect(result).not.toContain('<!--')
    expect(result).not.toContain('-->')
    expect(result).not.toContain('m-')
  })

  it('sin entradas, resultado es string vacío', () => {
    const result = formatForPrompt([])
    expect(result).toBe('')
  })

  it('si todas las entradas son de un solo tipo, solo aparece esa sección', () => {
    const entries: LearnedMemoryEntry[] = [
      { id: 'aa', tipo: 'preferencia', texto: 'Hecho 1', fecha: '2026-10-01' },
      { id: 'bb', tipo: 'preferencia', texto: 'Hecho 2', fecha: '2026-10-02' }
    ]
    const result = formatForPrompt(entries)

    expect(result).toContain('Preferencias:')
    expect(result).not.toContain('Decisiones:')
    expect(result).not.toContain('Convenciones:')
    expect(result).not.toContain('Soluciones:')
  })

  it('mantiene el orden de tipos: preferencia, convencion, decision, solucion', () => {
    const entries: LearnedMemoryEntry[] = [
      { id: 'dd', tipo: 'solucion', texto: 'Usar Map', fecha: '2026-10-01' },
      { id: 'bb', tipo: 'convencion', texto: 'Español', fecha: '2026-10-02' },
      { id: 'aa', tipo: 'preferencia', texto: 'No callbacks', fecha: '2026-10-03' },
      { id: 'cc', tipo: 'decision', texto: 'TypeScript', fecha: '2026-10-04' }
    ]
    const result = formatForPrompt(entries)
    const prefIdx = result.indexOf('Preferencias:')
    const convIdx = result.indexOf('Convenciones:')
    const decIdx = result.indexOf('Decisiones:')
    const solIdx = result.indexOf('Soluciones:')

    expect(prefIdx < convIdx && convIdx < decIdx && decIdx < solIdx).toBe(true)
  })
})
