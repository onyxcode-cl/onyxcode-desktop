import { describe, expect, it } from 'vitest'
import type { ConversationEntry } from '../../lib/conversation/entries'
import { buildSession, cleanForIndex, extractDocs, fold, queryWords, SearchIndex, type SearchMode } from './search-index'

let seq = 0
function msg(
  role: 'user' | 'assistant',
  text: string,
  extra: { parentID?: string; id?: string; created?: number; parts?: unknown[] } = {}
): ConversationEntry {
  const id = extra.id ?? `m${++seq}`
  return {
    info: {
      id,
      role,
      sessionID: 's',
      time: { created: extra.created ?? seq * 1000 },
      ...(extra.parentID ? { parentID: extra.parentID } : {})
    },
    parts: extra.parts ?? [{ id: `p${id}`, type: 'text', text }]
  } as unknown as ConversationEntry
}

function session(id: string, title: string, updated: number, entries: ConversationEntry[], mode: SearchMode = 'chat') {
  return buildSession({ id, mode, directory: '/tmp/x', title, updated }, entries)
}

describe('fold', () => {
  it('quita tildes y mayúsculas conservando la longitud (las posiciones coinciden con el original)', () => {
    const text = 'Canción ÁRBOL ñandú Ünï'
    const f = fold(text)
    expect(f).toBe('cancion arbol nandu uni')
    expect(f.length).toBe(text.length)
  })

  it('un emoji ocupa lo mismo y no coincide con letras', () => {
    const t = 'hola 😀 mundo'
    expect(fold(t).length).toBe(t.length)
    expect(fold(t)).toContain('mundo')
  })
})

describe('extractDocs / cleanForIndex', () => {
  it('indexa solo texto visible del usuario y de la IA, no herramientas, razonamiento ni archivos', () => {
    const docs = extractDocs(
      [
        msg('user', 'Quiero migrar la base de datos'),
        msg('assistant', '', {
          parts: [
            { id: 'a', type: 'reasoning', text: 'pensamiento secreto interno' },
            { id: 'b', type: 'tool', tool: 'read', state: { status: 'completed', output: 'contenido del archivo .env' } },
            { id: 'c', type: 'file', url: 'file:///x', mime: 'text/plain' },
            { id: 'd', type: 'text', text: 'Ignorado', ignored: true },
            { id: 'e', type: 'text', text: 'Sintético', synthetic: true },
            { id: 'f', type: 'text', text: 'Primero respalda la base.' }
          ]
        })
      ],
      'chat'
    )
    expect(docs.map((d) => d.text)).toEqual(['Quiero migrar la base de datos', 'Primero respalda la base.'])
    expect(JSON.stringify(docs)).not.toMatch(/pensamiento|\.env|Sintético|Ignorado/)
  })

  it('tapa claves y llaves privadas antes de guardar el texto', () => {
    const begin = '-----BEGIN ' + 'PRIVATE KEY-----'
    const end = '-----END ' + 'PRIVATE KEY-----'
    const fakeKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9'
    const text = `usa api_key=${fakeKey} y ghp_${'x1'.repeat(15)}\n${begin}\nMIIEvQIBADANBgkqhkiG9w0B\n${end} listo`
    const clean = cleanForIndex(text)
    expect(clean).not.toContain(fakeKey)
    expect(clean).not.toContain('ghp_')
    expect(clean).not.toContain('MIIEvQ')
    expect(clean).toContain('listo')
    const idx = new SearchIndex()
    idx.upsert(session('s1', 'Claves', 1, [msg('user', text)]))
    expect(idx.search('MIIEvQ').groups).toEqual([])
    expect(idx.search('a1B2c3').groups).toEqual([])
  })

  it('quita el bloque de adjuntos y los bloques internos de memoria', () => {
    const raw = 'Mira esto\n\nArchivos adjuntos (ya copiados en la carpeta de la tarea):\n- secreto.pdf'
    const docs = extractDocs([msg('user', raw), msg('assistant', 'Hecho ```lazunox-memoria\n{"dato":"privado"}\n``` fin')], 'chat')
    expect(docs[0].text).toBe('Mira esto')
    expect(docs[1].text).not.toContain('privado')
    expect(docs[1].text).toContain('fin')
  })

  it('en Code las respuestas se anclan al mensaje del usuario de su turno; en Chat al propio', () => {
    const u = msg('user', 'pregunta', { id: 'u1' })
    const a = msg('assistant', 'respuesta', { id: 'a1', parentID: 'u1' })
    expect(extractDocs([u, a], 'code').map((d) => d.anchor)).toEqual(['u1', 'u1'])
    expect(extractDocs([u, a], 'chat').map((d) => d.anchor)).toEqual(['u1', 'a1'])
  })

  it('recorta mensajes enormes', () => {
    const [d] = extractDocs([msg('user', 'palabra '.repeat(10_000))], 'chat')
    expect(d.text.length).toBeLessThanOrEqual(20_000)
  })
})

describe('SearchIndex.search', () => {
  const build = (): SearchIndex => {
    const idx = new SearchIndex()
    idx.upsert(
      session('c1', 'Receta de pan', 3000, [
        msg('user', 'Necesito una receta con masa madre'),
        msg('assistant', 'Claro: la hidratación ideal es del 75% y reposo en frío durante la noche.')
      ])
    )
    idx.upsert(session('c2', 'Presupuesto', 2000, [msg('user', 'Calcula el presupuesto trimestral de marketing')]))
    idx.upsert(
      session(
        'k1',
        'Refactor del login',
        1000,
        [msg('user', 'El componente de login falla con tildes: canción'), msg('assistant', 'Revisa el normalizador')],
        'code'
      )
    )
    return idx
  }

  it('encuentra una palabra que solo está en el cuerpo de un mensaje y devuelve fragmento, fecha y rango resaltado', () => {
    const r = build().search('hidratacion')
    expect(r.groups).toHaveLength(1)
    const g = r.groups[0]
    expect(g.sessionId).toBe('c1')
    expect(g.titleMatch).toBe(false)
    const hit = g.hits[0]
    expect(hit.role).toBe('assistant')
    expect(hit.at).toBeGreaterThan(0)
    const [s, e] = hit.ranges[0]
    expect(hit.snippet.slice(s, e)).toBe('hidratación')
  })

  it('ignora mayúsculas y tildes en ambos lados', () => {
    expect(build().search('CANCION').groups[0].sessionId).toBe('k1')
    expect(build().search('canción').groups[0].hits[0].snippet).toContain('canción')
  })

  it('exige todas las palabras en el mismo mensaje', () => {
    const idx = build()
    expect(idx.search('masa madre').groups.map((g) => g.sessionId)).toEqual(['c1'])
    expect(idx.search('masa trimestral').groups).toEqual([])
  })

  it('coincide también por el nombre de la conversación y ordena por recencia', () => {
    const idx = build()
    idx.upsert(session('c3', 'Notas de pan', 5000, [msg('user', 'sin relación')]))
    const r = idx.search('pan')
    expect(r.groups.map((g) => g.sessionId)).toEqual(['c3', 'c1'])
    expect(r.groups[0].titleMatch).toBe(true)
    expect(r.groups[0].hits).toEqual([])
  })

  it('no busca con menos de 2 letras ni con espacios', () => {
    expect(build().search('a').groups).toEqual([])
    expect(build().search('   ').groups).toEqual([])
  })

  it('limita las coincidencias por conversación y cuenta el total', () => {
    const idx = new SearchIndex()
    idx.upsert(
      session(
        'm',
        'Muchos',
        1,
        Array.from({ length: 10 }, (_, i) => msg('user', `mensaje número ${i} con la palabra clave`))
      )
    )
    const g = idx.search('clave', { perGroup: 3 }).groups[0]
    expect(g.hits).toHaveLength(3)
    expect(g.total).toBe(10)
  })

  it('limita las conversaciones devueltas', () => {
    const idx = new SearchIndex()
    for (let i = 0; i < 30; i++) idx.upsert(session(`s${i}`, `T${i}`, i, [msg('user', 'tema común')]))
    expect(idx.search('común', { maxGroups: 5 }).groups).toHaveLength(5)
  })

  it('upsert reemplaza, retitle cambia el nombre sin releer, remove y clear borran', () => {
    const idx = build()
    expect(idx.updatedOf('c2')).toBe(2000)
    idx.upsert(session('c2', 'Presupuesto', 2500, [msg('user', 'texto nuevo único')]))
    expect(idx.updatedOf('c2')).toBe(2500)
    expect(idx.search('trimestral').groups).toEqual([])
    expect(idx.search('unico').groups).toHaveLength(1)
    idx.retitle('c2', 'Cuentas')
    expect(idx.search('cuentas').groups[0].titleMatch).toBe(true)
    idx.remove('c2')
    expect(idx.has('c2')).toBe(false)
    idx.clear()
    expect(idx.size).toBe(0)
    expect(idx.docCount).toBe(0)
    expect(idx.search('pan').groups).toEqual([])
  })

  it('queryWords normaliza y no repite', () => {
    expect(queryWords('Canción  CANCION  pan')).toEqual(['cancion', 'pan'])
  })

  it('con miles de mensajes busca sin releer nada y rápido', () => {
    const idx = new SearchIndex()
    const words = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'kappa', 'lambda']
    for (let s = 0; s < 300; s++) {
      const entries = Array.from({ length: 40 }, (_, i) =>
        msg(i % 2 ? 'assistant' : 'user', `${words[(s + i) % 8]} ${words[(s * 3 + i) % 8]} texto de relleno número ${s}-${i} `.repeat(6))
      )
      idx.upsert(session(`s${s}`, `Conversación ${s}`, s, entries))
    }
    idx.upsert(session('needle', 'Aguja', 1, [msg('user', 'aquí vive el zeppelin escondido')]))
    expect(idx.docCount).toBeGreaterThanOrEqual(12_000)
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) idx.search('zeppelin')
    const per = (performance.now() - t0) / 20
    expect(idx.search('zeppelin').groups[0].sessionId).toBe('needle')
    expect(per).toBeLessThan(150) // holgado a propósito: en un equipo normal son pocos ms
  })
})
