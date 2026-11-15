import { describe, expect, it, vi } from 'vitest'
import {
  ReviewTracker,
  blockMessage,
  decideAuto,
  outsideDirectories,
  parseReview,
  requestReview,
  reviewUrl,
  subcommandRules,
  subcommandRuleSummary,
  type ReviewDecision
} from './auto-review'

const doubt = { verdict: 'doubt' as const, reason: 'borra archivos' }

describe('V29: respuesta del revisor (contrato §3)', () => {
  it('solo acepta allow, block o unavailable; lo demás es unavailable', () => {
    expect(parseReview({ decision: 'allow', reason: ' Lo pidió\n la persona ' })).toEqual({
      decision: 'allow',
      reason: 'Lo pidió la persona'
    })
    expect(parseReview({ decision: 'block', reason: 'no' })).toEqual({ decision: 'block', reason: 'no' })
    for (const body of [null, [], 'allow', { decision: 'yes' }, { decision: 'ALLOW', reason: 'x' }, {}])
      expect(parseReview(body)).toEqual({ decision: 'unavailable', reason: '' })
  })

  it('ruta v1 con la carpeta y ruta v2 de la sesión', () => {
    expect(reviewUrl('http://127.0.0.1:4096/', { id: 'per 1', sessionID: 's', api: 'v1', directory: '/a b' })).toBe(
      'http://127.0.0.1:4096/permission/per%201/review?directory=%2Fa%20b'
    )
    expect(reviewUrl('http://x', { id: 'p', sessionID: 'ses_1', api: 'v2' })).toBe('http://x/api/session/ses_1/permission/p/review')
  })

  it('POST con autorización; 404, 500, red caída, JSON roto o tope → unavailable', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ decision: 'block', reason: 'no' })))
    expect(
      await requestReview({ baseUrl: 'http://x', authorization: 'Basic a' }, { id: 'p', sessionID: 's', api: 'v1' }, ok as never)
    ).toEqual({
      decision: 'block',
      reason: 'no'
    })
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://x/permission/p/review')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic a')
    const unavailable = { decision: 'unavailable', reason: '' }
    for (const f of [
      async () => new Response('', { status: 404 }),
      async () => new Response('x', { status: 500 }),
      async () => new Response('{no json'),
      async () => {
        throw new Error('ECONNREFUSED')
      }
    ])
      expect(await requestReview({ baseUrl: 'http://x' }, { id: 'p', sessionID: 's', api: 'v1' }, f as never)).toEqual(unavailable)
    const slow = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('timeout'))))
    )
    expect(await requestReview({ baseUrl: 'http://x' }, { id: 'p', sessionID: 's', api: 'v1' }, slow as never, 20)).toEqual(unavailable)
  })

  it('el mensaje para la IA lleva el motivo y le pide otro camino', () => {
    expect(blockMessage('La persona no pidió borrar dist.')).toBe(
      'Revisión automática: La persona no pidió borrar dist. Hazlo de otra forma o pregúntale a la persona.'
    )
    expect(blockMessage('')).toBe('Revisión automática: no parece necesario para lo pedido. Hazlo de otra forma o pregúntale a la persona.')
  })
})

describe('V29: flujo de Automático con un revisor falso', () => {
  const reviewer = (decision: ReviewDecision['decision'], reason = 'motivo') => vi.fn(async () => ({ decision, reason }))

  it('allow → una vez sin revisor; hard → tarjeta sin revisor', async () => {
    const r = reviewer('block')
    expect(await decideAuto({ verdict: 'allow', reason: '' }, r, new ReviewTracker(), 'k')).toEqual({ action: 'once' })
    expect(await decideAuto({ verdict: 'hard', reason: 'sudo' }, r, new ReviewTracker(), 'k')).toEqual({ action: 'card' })
    expect(r).not.toHaveBeenCalled()
  })

  it('doubt: allow → una vez; block → rechazo con mensaje; unavailable o error → tarjeta', async () => {
    const t = new ReviewTracker()
    expect(await decideAuto(doubt, reviewer('allow'), t, 'k')).toEqual({ action: 'once' })
    expect(await decideAuto(doubt, reviewer('block', 'no se pidió'), t, 'k')).toEqual({
      action: 'reject',
      message: 'Revisión automática: no se pidió. Hazlo de otra forma o pregúntale a la persona.'
    })
    expect(await decideAuto(doubt, reviewer('unavailable'), t, 'k')).toEqual({ action: 'card' })
    expect(
      await decideAuto(
        doubt,
        async () => {
          throw new Error('x')
        },
        t,
        'k'
      )
    ).toEqual({ action: 'card' })
  })

  it('3 bloqueos seguidos: el cuarto es tarjeta con el motivo; la persona reinicia la racha', async () => {
    const t = new ReviewTracker()
    for (let i = 0; i < 3; i++) expect((await decideAuto(doubt, reviewer('block'), t, 'k')).action).toBe('reject')
    expect(await decideAuto(doubt, reviewer('block', 'borra sin pedirlo'), t, 'k')).toEqual({ action: 'card', note: 'borra sin pedirlo' })
    // Otra conversación no comparte el contador.
    expect((await decideAuto(doubt, reviewer('block'), t, 'otra')).action).toBe('reject')
    t.personApproved('k')
    expect((await decideAuto(doubt, reviewer('block'), t, 'k')).action).toBe('reject')
    expect(t.snapshot('k')).toEqual({ consecutive: 1, total: 4 })
  })

  it('20 en la conversación: a partir de ahí todo bloqueo es tarjeta, aunque haya aprobaciones entre medio', async () => {
    const t = new ReviewTracker()
    for (let i = 0; i < 20; i++) {
      expect((await decideAuto(doubt, reviewer('block'), t, 'k')).action).toBe('reject')
      if (i % 2) expect((await decideAuto(doubt, reviewer('allow'), t, 'k')).action).toBe('once')
    }
    expect((await decideAuto(doubt, reviewer('block'), t, 'k')).action).toBe('card')
    t.personApproved('k')
    expect((await decideAuto(doubt, reviewer('block'), t, 'k')).action).toBe('card')
    expect((await decideAuto(doubt, reviewer('allow'), t, 'k')).action).toBe('once')
  })
})

describe('V29: metadatos de la petición única (contrato §1)', () => {
  it('reglas de subcommands: sin nulas ni repetidas, máximo 5; sin el campo → null (motor viejo)', () => {
    expect(
      subcommandRules({
        subcommands: [
          { command: 'npm test', rule: 'npm test *' },
          { command: 'rm x', rule: null },
          { command: 'npm test -- -u', rule: 'npm test *' },
          { command: 'git status', rule: 'git status *' }
        ]
      })
    ).toEqual(['npm test *', 'git status *'])
    expect(subcommandRules({ subcommands: [{ command: 'rm x', rule: null }] })).toEqual([])
    expect(subcommandRules({ command: 'ls' })).toBeNull()
    expect(subcommandRules({ subcommands: Array.from({ length: 8 }, (_, i) => ({ command: `a${i}`, rule: `a${i} *` })) })).toHaveLength(5)
  })

  it('carpetas de fuera: externalDirectories (o directories del motor viejo), sin repetir', () => {
    expect(outsideDirectories({ externalDirectories: ['/tmp', '/tmp', 3, ''] })).toEqual(['/tmp'])
    expect(outsideDirectories({ directories: ['/x'] })).toEqual(['/x'])
    expect(outsideDirectories(null)).toEqual([])
  })
})

it('informa las exclusiones y el tope sin guardar borrados aunque traigan una regla', () => {
  const subcommands = [
    { command: 'Remove-Item x', rule: 'Remove-Item *' },
    { command: 'rm x', rule: null },
    ...Array.from({ length: 6 }, (_, i) => ({ command: `read${i}`, rule: `read${i} *` }))
  ]
  expect(subcommandRuleSummary({ subcommands })).toEqual({
    rules: ['read0 *', 'read1 *', 'read2 *', 'read3 *', 'read4 *'],
    excluded: ['Remove-Item x', 'rm x'],
    truncated: true
  })
})
