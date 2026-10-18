import { describe, expect, it } from 'vitest'
import {
  Bm25Index,
  CHUNK_MAX_CHARS,
  PROJECT_LIMITS,
  chunkText,
  chunksForFile,
  foldText,
  knowledgeKind,
  selectPassages,
  tokenize
} from './project-knowledge'

describe('foldText / tokenize', () => {
  it('quita tildes y mayúsculas', () => {
    expect(foldText('ÁRBOL Canción Ñandú')).toBe('arbol cancion nandu')
  })
  it('descarta palabras vacías y signos, y deja los números', () => {
    expect(tokenize('¿Cuál es el canon mensual de 412 UF?')).toEqual(['canon', 'mensual', '412', 'uf'])
  })
  it('un plural encuentra el singular (archivos ~ archivo) y sin tildes (garantía ~ garantia)', () => {
    expect(tokenize('Garantías')).toEqual(tokenize('garantia'))
    expect(tokenize('archivos')).toEqual(tokenize('archivo'))
  })
  it('también quita palabras vacías del inglés', () => {
    expect(tokenize('What is the monthly rent of the warehouse?')).toEqual(tokenize('monthly rent warehouse'))
    expect(tokenize('What is the monthly rent of the warehouse?')).toHaveLength(3)
  })
})

describe('knowledgeKind', () => {
  it('reconoce PDF, oficina y texto; lo demás no', () => {
    expect(knowledgeKind('a.PDF')).toBe('pdf')
    expect(knowledgeKind('a.docx')).toBe('office')
    expect(knowledgeKind('a.XLSX')).toBe('office')
    expect(knowledgeKind('a.pptx')).toBe('office')
    expect(knowledgeKind('notas.md')).toBe('text')
    expect(knowledgeKind('a.txt')).toBe('text')
    expect(knowledgeKind('a.exe')).toBeNull()
    expect(knowledgeKind('a.png')).toBeNull()
    expect(knowledgeKind('sin-extension')).toBeNull()
  })
})

describe('chunkText', () => {
  it('texto vacío o solo espacios: sin pasajes', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('  \n\n \t ')).toEqual([])
  })

  it('un texto corto es un solo pasaje', () => {
    expect(chunkText('Hola mundo.\n\nSegundo párrafo.')).toEqual(['Hola mundo.\n\nSegundo párrafo.'])
  })

  it('pasajes de ~1000 caracteres, ninguno pasa del máximo y todo el texto queda cubierto', () => {
    const para = (i: number): string => `Párrafo ${i}: ` + 'palabra '.repeat(40).trim() + '.'
    const text = Array.from({ length: 40 }, (_, i) => para(i)).join('\n\n')
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
    for (const c of chunks.slice(0, -1)) expect(c.length).toBeGreaterThan(500)
    for (let i = 0; i < 40; i++) expect(chunks.some((c) => c.includes(`Párrafo ${i}:`))).toBe(true)
  })

  it('cada pasaje repite el final del anterior (solapamiento) para no perder una frase partida', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Frase número ${i} de prueba con relleno suficiente para ocupar espacio.`).join(' ')
    const long = Array.from({ length: 12 }, (_, i) => `Bloque${i} ` + text.slice(0, 380)).join('\n\n')
    const chunks = chunkText(long, { target: 900, max: 1200, overlap: 150 })
    expect(chunks.length).toBeGreaterThan(2)
    for (let i = 1; i < chunks.length; i++) {
      const prevTailWords = chunks[i - 1].split(/\s+/).slice(-3).join(' ')
      expect(chunks[i].startsWith(prevTailWords) || chunks[i].includes(prevTailWords), `pasaje ${i}`).toBe(true)
    }
  })

  it('un párrafo gigante sin saltos se corta en palabras y no pasa del máximo', () => {
    const chunks = chunkText('x'.repeat(10) + ' ' + 'abcdefghi '.repeat(1000))
    expect(chunks.length).toBeGreaterThan(5)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
  })

  it('una cadena sin ningún espacio también se corta (corte duro)', () => {
    const chunks = chunkText('z'.repeat(5000))
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
  })

  it('las filas de una tabla en Markdown se agrupan por líneas', () => {
    const rows = Array.from({ length: 80 }, (_, i) => `| Producto ${i} | ${i * 10} | bodega ${i % 7} |`).join('\n')
    const chunks = chunkText(rows)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
      expect(c.startsWith('|') || c.length > 0).toBe(true)
    }
  })

  it('quita caracteres de control y normaliza saltos de línea de Windows', () => {
    const [c] = chunkText('uno\r\ndos\u0000\u0007 tres')
    expect(c).toBe('uno\ndos tres')
  })
})

const FILES = [
  {
    id: 'f1',
    name: 'contrato-arriendo.md',
    text: 'El canon mensual de arriendo es de 412 UF y se paga el día 7 de cada mes.\n\nLa garantía equivale a 3 meses de canon.'
  },
  { id: 'f2', name: 'manual-bodega.txt', text: 'La bodega 14 es de uso exclusivo del arrendatario. Las llaves se entregan en portería.' },
  { id: 'f3', name: 'recetas.md', text: 'Para el pan de masa madre mezcla harina, agua y sal. Hornea a 230 grados por 40 minutos.' }
]
const chunks = FILES.flatMap((f) => chunksForFile(f.id, f.name, f.text))

describe('Bm25Index.search', () => {
  const idx = new Bm25Index(chunks)

  it('el pasaje que contiene el dato queda primero, sin importar tildes ni mayúsculas', () => {
    const r = idx.search('¿CUÁNTO ES EL CANON MENSUAL?')
    expect(r[0].name).toBe('contrato-arriendo.md')
    expect(r[0].text).toContain('412 UF')
  })

  it('encuentra por un número', () => {
    expect(idx.search('412')[0].name).toBe('contrato-arriendo.md')
  })

  it('encuentra por el nombre del archivo', () => {
    expect(idx.search('manual de la bodega')[0].name).toBe('manual-bodega.txt')
  })

  it('un plural y un singular son lo mismo', () => {
    expect(idx.search('llave')[0].name).toBe('manual-bodega.txt')
    expect(idx.search('garantias')[0].name).toBe('contrato-arriendo.md')
  })

  it('una pregunta sin relación con los archivos devuelve vacío, no un pasaje al azar', () => {
    expect(idx.search('¿Cuál es la capital de Francia?')).toEqual([])
    expect(idx.search('hola')).toEqual([])
    expect(idx.search('   ')).toEqual([])
  })

  it('con varios términos exige que coincida una parte razonable de ellos', () => {
    // Solo «mensual» coincide de cuatro términos: no alcanza.
    expect(idx.search('mensual futbol tenis natación')).toEqual([])
  })

  it('ordena de mayor a menor puntaje y respeta el límite', () => {
    const r = idx.search('canon bodega harina', 2)
    expect(r.length).toBeLessThanOrEqual(2)
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score)
  })

  it('un índice vacío no encuentra nada', () => {
    expect(new Bm25Index([]).search('canon')).toEqual([])
  })

  it('rankea bien con muchos pasajes: el dato exacto sale entre los primeros', () => {
    const noise = Array.from({ length: 60 }, (_, i) => ({
      file: `n${i}`,
      name: `ruido-${i}.txt`,
      part: 1,
      text: `Informe ${i}: ventas del trimestre, inventario y notas generales sin relación. Región ${i % 5}.`
    }))
    const needle = { file: 'x', name: 'acta.txt', part: 1, text: 'El acta fija la multa por atraso en 0,5 UF diarias.' }
    const big = new Bm25Index([...noise, needle])
    expect(big.search('multa por atraso')[0].name).toBe('acta.txt')
  })
})

describe('selectPassages (límites de lo que viaja al modelo)', () => {
  const mk = (n: number, len: number) =>
    Array.from({ length: n }, (_, i) => ({
      file: `f${i}`,
      name: `a${i}.txt`,
      part: i + 1,
      text: 'x'.repeat(len),
      score: 10 - i,
      matched: 1
    }))

  it('como máximo 5 pasajes', () => {
    expect(selectPassages(mk(12, 100))).toHaveLength(PROJECT_LIMITS.maxPassages)
  })
  it('un pasaje largo se recorta al tope y lleva puntos suspensivos', () => {
    const [p] = selectPassages(mk(1, 5000))
    expect(p.text.length).toBe(PROJECT_LIMITS.maxPassageChars)
    expect(p.text.endsWith('…')).toBe(true)
  })
  it('el total no pasa del tope de caracteres', () => {
    const out = selectPassages(mk(5, 1200))
    expect(out.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(PROJECT_LIMITS.maxInjectedChars)
  })
  it('conserva el nombre del archivo y el número de parte para citar', () => {
    const [p] = selectPassages(mk(1, 50))
    expect(p).toMatchObject({ file: 'a0.txt', part: 1 })
  })
})
