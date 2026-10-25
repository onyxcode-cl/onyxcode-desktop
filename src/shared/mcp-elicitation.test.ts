import { describe, expect, it, vi } from 'vitest'
import {
  ELICITATION_LIMITS,
  checkElicitation,
  initialDraft,
  listElicitations,
  parseElicitationRejected,
  parseElicitationReplied,
  parseElicitationRequest,
  plainText,
  rejectionNeedsNotice,
  replyElicitation,
  type ElicitationField
} from './mcp-elicitation'

const asked = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'eli_1',
  sessionID: 'ses_1',
  server: 'crm',
  callID: 'call_1',
  message: 'Necesito un dato',
  fields: [{ name: 'nombre', type: 'string', required: true, maxLength: 100 }],
  expiresAt: 1_900_000_000_000,
  ...over
})

describe('parseElicitationRequest: el contrato del motor, sin fiarse', () => {
  it('acepta un formulario completo con los cinco tipos de campo', () => {
    const r = parseElicitationRequest(
      asked({
        fields: [
          {
            name: 'a',
            type: 'string',
            title: 'Nombre',
            description: 'Tu nombre',
            required: true,
            minLength: 2,
            maxLength: 50,
            default: 'Ana'
          },
          { name: 'b', type: 'number', required: false, minimum: 0, maximum: 10, default: 3 },
          { name: 'c', type: 'integer', required: true },
          { name: 'd', type: 'boolean', required: false, default: true },
          { name: 'e', type: 'enum', required: true, options: [{ value: 'x', label: 'Equis' }], default: 'x' }
        ]
      })
    )
    expect(r?.fields.map((f) => f.type)).toEqual(['string', 'number', 'integer', 'boolean', 'enum'])
    expect(r?.fields[0]).toMatchObject({ title: 'Nombre', minLength: 2, maxLength: 50, default: 'Ana' })
    expect(r?.fields[4]?.options).toEqual([{ value: 'x', label: 'Equis' }])
    expect(r?.callID).toBe('call_1')
  })

  it('descarta lo que no cumple: sin id, sesión, servidor, caducidad o con campos mal formados', () => {
    for (const bad of [
      null,
      'x',
      asked({ id: '' }),
      asked({ sessionID: 5 }),
      asked({ server: '' }),
      asked({ expiresAt: 'mañana' }),
      asked({ fields: 'no' }),
      asked({ fields: [{ name: 'a', type: 'archivo', required: true }] }),
      asked({ fields: [{ name: '', type: 'string', required: true }] }),
      asked({ fields: [{ name: 'e', type: 'enum', required: true, options: [] }] })
    ])
      expect(parseElicitationRequest(bad)).toBeNull()
  })

  it('un nombre de campo repetido o más de 20 campos invalida TODO el formulario (no se muestra a medias)', () => {
    const f = (n: string): Record<string, unknown> => ({ name: n, type: 'boolean', required: false })
    expect(parseElicitationRequest(asked({ fields: [f('a'), f('a')] }))).toBeNull()
    expect(parseElicitationRequest(asked({ fields: Array.from({ length: 21 }, (_, i) => f(`c${i}`)) }))).toBeNull()
    expect(parseElicitationRequest(asked({ fields: Array.from({ length: 20 }, (_, i) => f(`c${i}`)) }))).not.toBeNull()
  })

  it('los strings siempre tienen tope: sin maxLength se aplica el máximo; uno enorme se recorta', () => {
    const r1 = parseElicitationRequest(asked({ fields: [{ name: 'a', type: 'string', required: false }] }))
    expect(r1?.fields[0]?.maxLength).toBe(ELICITATION_LIMITS.stringFallback)
    const r2 = parseElicitationRequest(asked({ fields: [{ name: 'a', type: 'string', required: false, maxLength: 999_999 }] }))
    expect(r2?.fields[0]?.maxLength).toBe(ELICITATION_LIMITS.stringFallback)
  })

  it('el valor por defecto de un enum solo vale si está entre las opciones; el de un booleano, si es booleano', () => {
    const r = parseElicitationRequest(
      asked({
        fields: [
          { name: 'e', type: 'enum', required: false, options: [{ value: 'x', label: 'X' }], default: 'otro' },
          { name: 'b', type: 'boolean', required: false, default: 'true' }
        ]
      })
    )
    expect(r?.fields[0]?.default).toBeUndefined()
    expect(r?.fields[1]?.default).toBeUndefined()
  })

  it('el texto se limpia y se acota: sin caracteres de control ni de dirección, mensaje ≤ 2000, título ≤ 120, descripción ≤ 500', () => {
    const r = parseElicitationRequest(
      asked({
        server: 'cr\u202Em',
        message: `Hola\u0000\u202E mundo ${'x'.repeat(3000)}`,
        fields: [{ name: 'a', type: 'string', required: false, maxLength: 5, title: `T${'t'.repeat(300)}`, description: 'd'.repeat(900) }]
      })
    )!
    expect(r.server).toBe('crm')
    expect(r.message.startsWith('Hola mundo')).toBe(true)
    expect(r.message.length).toBeLessThanOrEqual(ELICITATION_LIMITS.message + 1)
    expect(r.message).not.toMatch(/[\u0000\u202E]/)
    expect(r.fields[0]?.title?.length).toBeLessThanOrEqual(ELICITATION_LIMITS.title + 1)
    expect(r.fields[0]?.description?.length).toBeLessThanOrEqual(ELICITATION_LIMITS.description + 1)
  })

  it('plainText conserva los saltos de línea del mensaje y no interpreta nada', () => {
    expect(plainText('a\r\nb', 10)).toBe('a\nb')
    expect(plainText('<b>hola</b> [x](http://evil) **y**', 100)).toBe('<b>hola</b> [x](http://evil) **y**')
    expect(plainText(5, 10)).toBe('')
  })
})

describe('parseElicitationReplied / parseElicitationRejected', () => {
  it('replied exige id, sesión y una acción conocida', () => {
    expect(parseElicitationReplied({ id: 'e', sessionID: 's', action: 'accept' })).toEqual({ id: 'e', sessionID: 's', action: 'accept' })
    expect(parseElicitationReplied({ id: 'e', sessionID: 's', action: 'otra' })).toBeNull()
    expect(parseElicitationReplied({ id: 'e' })).toBeNull()
  })
  it('rejected acepta solo los seis motivos del contrato', () => {
    for (const reason of ['timeout', 'abort', 'server-cancel', 'secret', 'schema', 'ambiguous'])
      expect(parseElicitationRejected({ id: 'e', sessionID: 's', reason })?.reason).toBe(reason)
    expect(parseElicitationRejected({ id: 'e', sessionID: 's', reason: 'mal' })).toBeNull()
    expect(parseElicitationRejected({ id: 'e', sessionID: 's' })).toBeNull()
  })
  it('qué rechazos merecen un aviso: secreto, esquema y ambiguo siempre; caducar solo si había tarjeta; abortar o cancelar el servidor, nunca', () => {
    for (const r of ['secret', 'schema', 'ambiguous'] as const) {
      expect(rejectionNeedsNotice(r, false)).toBe(true)
      expect(rejectionNeedsNotice(r, true)).toBe(true)
    }
    expect(rejectionNeedsNotice('timeout', true)).toBe(true)
    expect(rejectionNeedsNotice('timeout', false)).toBe(false)
    for (const r of ['abort', 'server-cancel'] as const) {
      expect(rejectionNeedsNotice(r, true)).toBe(false)
      expect(rejectionNeedsNotice(r, false)).toBe(false)
    }
  })
})

const f = (over: Partial<ElicitationField> & Pick<ElicitationField, 'name' | 'type'>): ElicitationField => ({ required: false, ...over })

describe('initialDraft: nada se rellena salvo el default', () => {
  it('campos vacíos, casilla apagada y solo los default del esquema', () => {
    const fields = [
      f({ name: 'a', type: 'string', maxLength: 10 }),
      f({ name: 'b', type: 'string', maxLength: 10, default: 'hola' }),
      f({ name: 'c', type: 'number', default: 2.5 }),
      f({ name: 'd', type: 'boolean' }),
      f({ name: 'e', type: 'boolean', default: true }),
      f({ name: 'g', type: 'enum', options: [{ value: 'x', label: 'X' }] })
    ]
    expect(initialDraft(fields)).toEqual({ a: '', b: 'hola', c: '2.5', d: false, e: true, g: '' })
  })
})

describe('checkElicitation: la misma validación que hace el motor', () => {
  it('obligatorio vacío o solo espacios -> required; opcional vacío -> se omite', () => {
    const fields = [f({ name: 'a', type: 'string', required: true, maxLength: 10 }), f({ name: 'b', type: 'string', maxLength: 10 })]
    expect(checkElicitation(fields, { a: '   ', b: '' }).errors).toEqual({ a: { code: 'required' } })
    expect(checkElicitation(fields, { a: 'x', b: '' })).toEqual({ content: { a: 'x' }, errors: {} })
  })
  it('longitudes mínima y máxima', () => {
    const fields = [f({ name: 'a', type: 'string', minLength: 3, maxLength: 5 })]
    expect(checkElicitation(fields, { a: 'ab' }).errors.a).toEqual({ code: 'tooShort', min: 3 })
    expect(checkElicitation(fields, { a: 'abcdef' }).errors.a).toEqual({ code: 'tooLong', max: 5 })
    expect(checkElicitation(fields, { a: 'abcd' }).content).toEqual({ a: 'abcd' })
  })
  it('formatos email, uri, date y date-time', () => {
    const mk = (format: ElicitationField['format']): ElicitationField[] => [f({ name: 'x', type: 'string', maxLength: 100, format })]
    expect(checkElicitation(mk('email'), { x: 'a@b.cl' }).errors).toEqual({})
    expect(checkElicitation(mk('email'), { x: 'a@b' }).errors.x?.code).toBe('email')
    expect(checkElicitation(mk('email'), { x: 'a b@c.cl' }).errors.x?.code).toBe('email')
    expect(checkElicitation(mk('uri'), { x: 'https://ejemplo.cl/a' }).errors).toEqual({})
    expect(checkElicitation(mk('uri'), { x: 'no es url' }).errors.x?.code).toBe('uri')
    expect(checkElicitation(mk('date'), { x: '2026-10-25' }).errors).toEqual({})
    expect(checkElicitation(mk('date'), { x: '2026-02-30' }).errors.x?.code).toBe('date')
    expect(checkElicitation(mk('date'), { x: '25/10/2026' }).errors.x?.code).toBe('date')
    expect(checkElicitation(mk('date-time'), { x: '2026-10-25T10:30' }).errors).toEqual({})
    expect(checkElicitation(mk('date-time'), { x: '2026-10-25T10:30:00Z' }).errors).toEqual({})
    expect(checkElicitation(mk('date-time'), { x: '2026-10-25' }).errors.x?.code).toBe('dateTime')
  })
  it('números: enteros y decimales, rango, y nada de hexadecimal, notación científica ni texto', () => {
    const fields = [f({ name: 'n', type: 'number', minimum: 0, maximum: 10 }), f({ name: 'i', type: 'integer' })]
    expect(checkElicitation(fields, { n: '2,5', i: '7' })).toEqual({ content: { n: 2.5, i: 7 }, errors: {} })
    expect(checkElicitation(fields, { n: '11', i: '' }).errors.n).toEqual({ code: 'tooLarge', max: 10 })
    expect(checkElicitation(fields, { n: '-1', i: '' }).errors.n).toEqual({ code: 'tooSmall', min: 0 })
    for (const bad of ['0x10', '1e3', 'diez', '1.2.3', 'NaN', 'Infinity'])
      expect(checkElicitation(fields, { n: bad, i: '' }).errors.n?.code, bad).toBe('number')
    expect(checkElicitation(fields, { n: '', i: '1.5' }).errors.i?.code).toBe('integer')
  })
  it('enum: solo vale una de las opciones', () => {
    const fields = [f({ name: 'e', type: 'enum', required: true, options: [{ value: 'a', label: 'A' }] })]
    expect(checkElicitation(fields, { e: 'a' }).content).toEqual({ e: 'a' })
    expect(checkElicitation(fields, { e: 'b' }).errors.e?.code).toBe('option')
    expect(checkElicitation(fields, { e: '' }).errors.e?.code).toBe('required')
  })
  it('boolean: siempre se envía (falso incluido)', () => {
    const fields = [f({ name: 'b', type: 'boolean', required: true })]
    expect(checkElicitation(fields, { b: false }).content).toEqual({ b: false })
    expect(checkElicitation(fields, { b: true }).content).toEqual({ b: true })
  })
})

const conn = { baseUrl: 'http://127.0.0.1:4999/', authorization: 'Basic abc' }
const json = (status: number, body?: unknown): Response => new Response(body === undefined ? null : JSON.stringify(body), { status })

describe('listElicitations (GET /mcp/elicitation)', () => {
  it('pide con la autorización, la carpeta codificada y sanea la lista', async () => {
    const fetchImpl = vi.fn(async () => json(200, [asked(), { basura: true }]))
    const r = await listElicitations(conn, '/work/mi proyecto', fetchImpl as never)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/mcp/elicitation?directory=%2Fwork%2Fmi%20proyecto')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc')
    expect(r).toMatchObject({ available: true })
    expect(r.available && r.list.map((e) => e.id)).toEqual(['eli_1'])
  })
  it('404 y 405 = el motor no tiene la ruta (la app sigue como antes); un 500 lanza', async () => {
    expect(await listElicitations(conn, undefined, (async () => json(404)) as never)).toEqual({ available: false })
    expect(await listElicitations(conn, undefined, (async () => json(405)) as never)).toEqual({ available: false })
    await expect(listElicitations(conn, undefined, (async () => json(500)) as never)).rejects.toThrow('500')
  })
})

describe('replyElicitation (POST /mcp/elicitation/{id}/reply)', () => {
  it('accept manda action + content a la ruta exacta; decline y cancel mandan solo la acción', async () => {
    const fetchImpl = vi.fn(async () => json(200, true))
    await replyElicitation(conn, 'eli_1', 'accept', { a: 'x', n: 2, b: false }, '/d', fetchImpl as never)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4999/mcp/elicitation/eli_1/reply?directory=%2Fd')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ action: 'accept', content: { a: 'x', n: 2, b: false } })
    await replyElicitation(conn, 'eli_1', 'cancel', { a: 'no debe viajar' }, undefined, fetchImpl as never)
    expect(JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toEqual({ action: 'cancel' })
    await replyElicitation(conn, 'eli_1', 'decline', undefined, undefined, fetchImpl as never)
    expect(JSON.parse((fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].body as string)).toEqual({ action: 'decline' })
  })
  it('el id del formulario va codificado en la ruta (no puede escapar de ella)', async () => {
    const fetchImpl = vi.fn(async () => json(200))
    await replyElicitation(conn, '../../x?y', 'cancel', undefined, undefined, fetchImpl as never)
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('http://127.0.0.1:4999/mcp/elicitation/..%2F..%2Fx%3Fy/reply')
  })
  it('400 con errors:[{campo,motivo}] -> invalid (el formulario queda abierto); 404 -> gone; otro error -> error', async () => {
    const bad = await replyElicitation(conn, 'e', 'accept', {}, undefined, (async () =>
      json(400, { errors: [{ campo: 'edad', motivo: 'fuera de rango' }, { sin: 'campo' }] })) as never)
    expect(bad).toEqual({ ok: false, invalid: [{ campo: 'edad', motivo: 'fuera de rango' }] })
    // También si el motor envuelve el cuerpo.
    const wrapped = await replyElicitation(conn, 'e', 'accept', {}, undefined, (async () =>
      json(400, { data: { errors: [{ campo: 'a', motivo: 'm' }] } })) as never)
    expect(wrapped).toEqual({ ok: false, invalid: [{ campo: 'a', motivo: 'm' }] })
    // 400 sin detalle: igual deja abierto.
    expect(await replyElicitation(conn, 'e', 'accept', {}, undefined, (async () => json(400, { raro: 1 })) as never)).toEqual({
      ok: false,
      invalid: []
    })
    expect(await replyElicitation(conn, 'e', 'accept', {}, undefined, (async () => json(404)) as never)).toEqual({ ok: false, gone: true })
    expect(await replyElicitation(conn, 'e', 'accept', {}, undefined, (async () => json(500)) as never)).toMatchObject({
      ok: false,
      error: expect.stringContaining('500')
    })
    expect(
      await replyElicitation(conn, 'e', 'accept', {}, undefined, (async () => {
        throw new Error('sin red')
      }) as never)
    ).toEqual({ ok: false, error: 'sin red' })
  })
})
