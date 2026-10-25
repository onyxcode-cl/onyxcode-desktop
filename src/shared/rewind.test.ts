/**
 * Rebobinar por turno: parseadores (todo lo del motor es NO confiable), cálculos puros y las cinco rutas con `fetch` falso.
 * Contrato: sección «Rebobinar por turno» de LAZUNOX.md del motor.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  availableModes,
  fetchRewindReview,
  fetchTurnDiff,
  filesToRestore,
  listTurns,
  overwriteSelection,
  parseReview,
  parseRewindResult,
  parseTurn,
  parseTurns,
  parseUndoResult,
  postRewind,
  postUndoRewind,
  REWIND_LIMITS,
  turnHasCommandOrigin,
  turnTotals,
  type RewindReview,
  type TurnFile
} from './rewind'

const conn = { baseUrl: 'http://127.0.0.1:4999/', authorization: 'Basic abc' }
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
const file = (over: Partial<TurnFile> = {}): TurnFile => ({
  file: 'a.txt',
  status: 'modified',
  additions: 1,
  deletions: 2,
  origen: 'herramienta',
  ...over
})

const review = (over: Partial<RewindReview> = {}): RewindReview => ({
  archivos: [file({ file: 'a.txt' }), file({ file: 'b.txt' }), file({ file: '.mcp.json' })],
  conflictos: ['b.txt'],
  protegidos: ['.mcp.json'],
  comandos: false,
  commitsDespues: [],
  ayudantesActivos: [],
  mensajes: 4,
  restaurable: true,
  ...over
})

describe('parseTurn / parseTurns', () => {
  it('lee el contrato y descarta lo que no encaja', () => {
    const t = parseTurn({
      messageID: 'msg_1',
      time: 1700000000000,
      files: [
        { file: 'src/a.ts', status: 'added', additions: 10, deletions: 0, origen: 'herramienta' },
        { file: 'b.ts', status: 'raro', additions: -3, deletions: 'x', origen: 'inventado' },
        { status: 'modified' },
        'basura'
      ],
      truncated: true,
      restaurable: false,
      motivo: 'sin-git'
    })
    expect(t).toEqual({
      messageID: 'msg_1',
      time: 1700000000000,
      files: [
        { file: 'src/a.ts', status: 'added', additions: 10, deletions: 0, origen: 'herramienta' },
        { file: 'b.ts', status: 'modified', additions: 0, deletions: 0, origen: 'otro' }
      ],
      truncated: true,
      restaurable: false,
      motivo: 'sin-git'
    })
  })
  it('sin la marca explícita no se promete restaurar; un motivo desconocido se ignora', () => {
    expect(parseTurn({ messageID: 'm', files: [], motivo: 'otro-motivo' })).toMatchObject({ restaurable: false })
    expect(parseTurn({ messageID: 'm', files: [], motivo: 'otro-motivo' })).not.toHaveProperty('motivo')
  })
  it('sin messageID o no objeto: null; la lista acota los turnos y los archivos', () => {
    expect(parseTurn({})).toBeNull()
    expect(parseTurn(null)).toBeNull()
    expect(parseTurns({})).toEqual([])
    const many = Array.from({ length: REWIND_LIMITS.turns + 20 }, (_, i) => ({ messageID: `m${i}`, files: [] }))
    expect(parseTurns(many)).toHaveLength(REWIND_LIMITS.turns)
    // Se conservan los más recientes (el motor ordena del más antiguo al más nuevo).
    expect(parseTurns(many).at(-1)?.messageID).toBe(`m${many.length - 1}`)
    const files = Array.from({ length: REWIND_LIMITS.files + 50 }, (_, i) => ({
      file: `f${i}`,
      status: 'added',
      additions: 1,
      deletions: 0,
      origen: 'otro'
    }))
    expect(parseTurn({ messageID: 'm', files })?.files).toHaveLength(REWIND_LIMITS.files)
  })
  it('los nombres de archivo son texto plano: sin control ni marcas de dirección, en una línea', () => {
    const t = parseTurn({
      messageID: 'm',
      files: [{ file: 'a‮b\u0007c\nd.txt', status: 'added', additions: 0, deletions: 0, origen: 'otro' }]
    })
    expect(t?.files[0].file).toBe('abc d.txt')
  })
  it('un nombre que parece Markdown o enlace queda tal cual (la interfaz lo pinta como texto)', () => {
    const t = parseTurn({
      messageID: 'm',
      files: [{ file: '[x](https://evil.example)<img src=x>.md', status: 'added', additions: 0, deletions: 0, origen: 'otro' }]
    })
    expect(t?.files[0].file).toBe('[x](https://evil.example)<img src=x>.md')
  })
})

describe('parseReview', () => {
  it('lee la revisión completa y acota las listas', () => {
    const r = parseReview({
      archivos: [{ file: 'a', status: 'modified', additions: 1, deletions: 1, origen: 'comando' }],
      conflictos: ['b', '', 5],
      protegidos: ['.mcp.json'],
      comandos: true,
      commitsDespues: [{ hash: 'abcdef123456', asunto: 'Arregla‮ algo\n[x](http://a)' }, { asunto: 'sin hash' }],
      ayudantesActivos: [
        { tipo: 'shell', id: 'job_1', titulo: 'npm run dev' },
        { tipo: 'rara', id: 'x', titulo: 'y' }
      ],
      mensajes: 3,
      restaurable: true,
      bloqueado: 'trabajo-vivo'
    })
    expect(r).toEqual({
      archivos: [{ file: 'a', status: 'modified', additions: 1, deletions: 1, origen: 'comando' }],
      conflictos: ['b'],
      protegidos: ['.mcp.json'],
      comandos: true,
      commitsDespues: [{ hash: 'abcdef123456', asunto: 'Arregla algo [x](http://a)' }],
      ayudantesActivos: [{ tipo: 'shell', id: 'job_1', titulo: 'npm run dev' }],
      mensajes: 3,
      restaurable: true,
      bloqueado: 'trabajo-vivo'
    })
  })
  it('sin `restaurable` booleano la respuesta no es válida; motivo y bloqueo desconocidos se ignoran', () => {
    expect(parseReview({ archivos: [] })).toBeNull()
    const r = parseReview({ restaurable: false, motivo: 'sin-git', bloqueado: 'quien-sabe' })
    expect(r).toMatchObject({ restaurable: false, motivo: 'sin-git' })
    expect(r).not.toHaveProperty('bloqueado')
  })
})

describe('parseRewindResult / parseUndoResult', () => {
  it('lee el resultado y valida el modo', () => {
    expect(
      parseRewindResult({
        modo: 'codigo',
        restaurados: ['a'],
        borrados: ['b'],
        omitidos: [{ file: 'c', motivo: 'conflicto' }, { motivo: 'x' }],
        mensajesOcultos: 0,
        puedeDeshacer: true
      })
    ).toEqual({
      modo: 'codigo',
      restaurados: ['a'],
      borrados: ['b'],
      omitidos: [{ file: 'c', motivo: 'conflicto' }],
      mensajesOcultos: 0,
      puedeDeshacer: true
    })
    expect(parseRewindResult({ modo: 'otro' })).toBeNull()
  })
  it('deshacer tolera campos ausentes', () => {
    expect(parseUndoResult({})).toEqual({ restaurados: [], borrados: [], omitidos: [], conflictos: [] })
  })
})

describe('cálculos puros', () => {
  it('totales y origen por comando', () => {
    expect(turnTotals([file({ additions: 3, deletions: 1 }), file({ file: 'b', additions: 2, deletions: 4 })])).toEqual({
      files: 2,
      additions: 5,
      deletions: 5
    })
    expect(turnHasCommandOrigin([file(), file({ origen: 'comando' })])).toBe(true)
    expect(turnHasCommandOrigin([file(), file({ origen: 'otro' })])).toBe(false)
  })
  it('sin soporte de archivos solo se ofrece la conversación', () => {
    expect(availableModes({ restaurable: true })).toEqual(['todo', 'conversacion', 'codigo'])
    expect(availableModes({ restaurable: false })).toEqual(['conversacion'])
  })
  it('sobrescribir: solo lo marcado Y que de verdad es conflicto o protegido', () => {
    const r = review()
    expect(overwriteSelection(r, new Set())).toEqual([])
    expect(overwriteSelection(r, new Set(['b.txt']))).toEqual(['b.txt'])
    expect(overwriteSelection(r, new Set(['b.txt', '.mcp.json']))).toEqual(['b.txt', '.mcp.json'])
    // Una ruta marcada que no figura en la revisión (a.txt es un archivo normal; /etc/passwd no existe en ella) nunca viaja.
    expect(overwriteSelection(r, new Set(['a.txt', '/etc/passwd', '../fuera']))).toEqual([])
  })
  it('qué se restaurará: los conflictos y protegidos quedan fuera salvo que se marquen', () => {
    const r = review()
    expect(filesToRestore(r, []).map((f) => f.file)).toEqual(['a.txt'])
    expect(filesToRestore(r, ['b.txt']).map((f) => f.file)).toEqual(['a.txt', 'b.txt'])
    expect(filesToRestore(r, ['b.txt', '.mcp.json']).map((f) => f.file)).toEqual(['a.txt', 'b.txt', '.mcp.json'])
  })
})

describe('listTurns', () => {
  it('pide GET …/turnos con la autorización y la carpeta', async () => {
    const f = vi.fn(async () => json([{ messageID: 'm1', time: 1, files: [], restaurable: true }]))
    const r = await listTurns(conn, { sessionID: 'ses 1', directory: '/work/p', antesDe: 'm9', limite: 50 }, f as never)
    expect(r).toEqual({ available: true, turns: [{ messageID: 'm1', time: 1, files: [], truncated: false, restaurable: true }] })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/experimental/session/ses%201/turnos?directory=%2Fwork%2Fp&antesDe=m9&limite=50')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc')
  })
  it('404 y 405: el motor no tiene la ruta; otro error lanza', async () => {
    expect(await listTurns(conn, { sessionID: 's' }, (async () => json({}, 404)) as never)).toEqual({ available: false })
    expect(await listTurns(conn, { sessionID: 's' }, (async () => json({}, 405)) as never)).toEqual({ available: false })
    await expect(listTurns(conn, { sessionID: 's' }, (async () => json({}, 500)) as never)).rejects.toThrow('500')
  })
})

describe('fetchTurnDiff', () => {
  it('pide el parche de un archivo y lo lee', async () => {
    const f = vi.fn(async () =>
      json({
        file: 'a b.txt',
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-a\n+b\n',
        binary: false,
        truncated: false
      })
    )
    const r = await fetchTurnDiff(conn, { sessionID: 's1', messageID: 'm1', file: 'a b.txt', directory: '/d' }, f as never)
    expect(r).toMatchObject({ ok: true, diff: { file: 'a b.txt', patch: '@@ -1 +1 @@\n-a\n+b\n', binary: false } })
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://127.0.0.1:4999/experimental/session/s1/turnos/m1/diff?directory=%2Fd&file=a%20b.txt'
    )
  })
  it('409 caducado queda como conflicto con motivo; la red caída es error', async () => {
    const r = await fetchTurnDiff(conn, { sessionID: 's', messageID: 'm', file: 'a' }, (async () =>
      json({ motivo: 'caducado', message: 'caducó' }, 409)) as never)
    expect(r).toMatchObject({ ok: false, kind: 'conflict', motivo: 'caducado' })
    const e = await fetchTurnDiff(conn, { sessionID: 's', messageID: 'm', file: 'a' }, (async () => {
      throw new Error('red caída')
    }) as never)
    expect(e).toEqual({ ok: false, kind: 'error', error: 'red caída' })
  })
})

describe('fetchRewindReview', () => {
  it('lee la revisión por la ruta exacta', async () => {
    const f = vi.fn(async () =>
      json({
        archivos: [],
        conflictos: [],
        protegidos: [],
        comandos: false,
        commitsDespues: [],
        ayudantesActivos: [],
        mensajes: 2,
        restaurable: true
      })
    )
    const r = await fetchRewindReview(conn, { sessionID: 's1', messageID: 'm1', directory: '/d' }, f as never)
    expect(r).toMatchObject({ ok: true, review: { mensajes: 2, restaurable: true } })
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('http://127.0.0.1:4999/experimental/session/s1/rebobinar/m1?directory=%2Fd')
  })
  it('404 = sin soporte (vuelve el Revertir de siempre); respuesta rara = error', async () => {
    expect(await fetchRewindReview(conn, { sessionID: 's', messageID: 'm' }, (async () => json({}, 404)) as never)).toEqual({
      ok: false,
      kind: 'unavailable'
    })
    expect(await fetchRewindReview(conn, { sessionID: 's', messageID: 'm' }, (async () => json({ nada: 1 })) as never)).toMatchObject({
      ok: false,
      kind: 'error'
    })
  })
})

describe('postRewind', () => {
  const okBody = { modo: 'todo', restaurados: ['a'], borrados: [], omitidos: [], mensajesOcultos: 2, puedeDeshacer: true }
  it('manda messageID, modo y SOLO lo marcado en sobrescribir', async () => {
    const f = vi.fn(async () => json(okBody))
    const r = await postRewind(
      conn,
      { sessionID: 's1', messageID: 'm1', modo: 'todo', sobrescribir: ['b.txt'], directory: '/d' },
      f as never
    )
    expect(r).toMatchObject({ ok: true, result: { modo: 'todo', mensajesOcultos: 2, puedeDeshacer: true } })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/experimental/session/s1/rebobinar?directory=%2Fd')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ messageID: 'm1', modo: 'todo', sobrescribir: ['b.txt'] })
  })
  it('sin nada marcado no manda sobrescribir; en «solo conversación» nunca lo manda', async () => {
    const f = vi.fn(async () => json({ ...okBody, modo: 'conversacion' }))
    await postRewind(conn, { sessionID: 's', messageID: 'm', modo: 'codigo', sobrescribir: [] }, f as never)
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ messageID: 'm', modo: 'codigo' })
    await postRewind(conn, { sessionID: 's', messageID: 'm', modo: 'conversacion', sobrescribir: ['x'] }, f as never)
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      messageID: 'm',
      modo: 'conversacion'
    })
  })
  it('404, 400 y 409 se distinguen; el motivo del 409 sale del contrato', async () => {
    const run = (status: number, body: unknown) =>
      postRewind(conn, { sessionID: 's', messageID: 'm', modo: 'todo' }, (async () => json(body, status)) as never)
    expect(await run(404, {})).toEqual({ ok: false, kind: 'unavailable' })
    expect(await run(400, { message: 'no es de la persona' })).toEqual({ ok: false, kind: 'invalid', message: 'no es de la persona' })
    expect(await run(409, { motivo: 'ocupada', message: 'La sesión está ocupada' })).toEqual({
      ok: false,
      kind: 'conflict',
      motivo: 'ocupada',
      message: 'La sesión está ocupada'
    })
    // Un motivo inventado no se acepta como uno del contrato.
    expect(await run(409, { motivo: 'hackeado', message: 'x' })).toMatchObject({ kind: 'conflict', motivo: null })
    expect(await run(500, {})).toMatchObject({ ok: false, kind: 'error' })
  })
})

describe('postUndoRewind', () => {
  it('POST …/rebobinar/deshacer con cuerpo vacío por defecto', async () => {
    const f = vi.fn(async () => json({ restaurados: ['a'], borrados: [], omitidos: [], conflictos: ['b'] }))
    const r = await postUndoRewind(conn, { sessionID: 's1', directory: '/d' }, f as never)
    expect(r).toEqual({ ok: true, result: { restaurados: ['a'], borrados: [], omitidos: [], conflictos: ['b'] } })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/experimental/session/s1/rebobinar/deshacer?directory=%2Fd')
    expect(JSON.parse(init.body as string)).toEqual({})
  })
  it('409 nada-que-deshacer', async () => {
    const r = await postUndoRewind(conn, { sessionID: 's' }, (async () =>
      json({ motivo: 'nada-que-deshacer', message: 'nada' }, 409)) as never)
    expect(r).toMatchObject({ ok: false, kind: 'conflict', motivo: 'nada-que-deshacer' })
  })
})
