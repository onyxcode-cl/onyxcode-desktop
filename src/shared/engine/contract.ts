/**
 * Contrato compartido de `EngineClient` (docs/PLAN-ENGINE-CLIENT.md §4).
 *
 * `runEngineContract(make)` registra una suite de vitest que ejercita sesiones, permisos,
 * preguntas y eventos contra CUALQUIER adaptador. Hoy se aplica a `Engine1Adapter` + el
 * OpenCode falso de E2E; cuando exista el motor 2 se aplica el mismo contrato a `Engine2Adapter`
 * sin cambiar una línea. Lo que depende de cómo se provoca una situación en el servidor de
 * pruebas (un permiso pendiente, cortar el stream) entra por ganchos OPCIONALES del `harness`;
 * sin el gancho, esos casos se saltan en vez de fallar.
 *
 * No es un archivo de test (no termina en `.test.ts`): lo importa el test de cada adaptador.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EngineClient } from './client'
import { EngineError } from './errors'
import type { EngineEvent, EngineEventOf, EngineEventType } from './events'

/** Lo que cada adaptador de prueba entrega al contrato. */
export interface EngineContractHarness {
  client: EngineClient
  /** Carpeta de trabajo de las sesiones de prueba. */
  directory: string
  /** Otra carpeta, para comprobar que el ámbito (`Scope`) aísla. */
  otherDirectory?: string
  /** Detiene el servidor de pruebas. */
  close(): void | Promise<void>
  /** Prepara el servidor para que el PRÓXIMO mensaje pida un permiso de `bash` y espere respuesta. */
  armPermission?(): Promise<void>
  /** Prepara el servidor para que el PRÓXIMO mensaje haga una pregunta al usuario. */
  armQuestion?(): Promise<void>
  /** Corta los streams SSE abiertos (para probar la reconexión). */
  dropStream?(): Promise<void>
}

const WAIT_MS = 4_000
const TEST_MS = 10_000

/** Espera (con sondeo) a que `fn` devuelva un valor no vacío. */
async function waitFor<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, ms = WAIT_MS): Promise<T> {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v !== undefined && v !== null && v !== false) return v
    if (Date.now() - t0 > ms) throw new Error(`Tiempo agotado esperando: ${label}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** Suscripción que guarda los eventos recibidos. */
interface Recorder {
  events: EngineEvent[]
  errors: EngineError[]
  opens: () => number
  stop: () => void
  /** Primer evento de ese tipo (y que cumpla `pred`), o `undefined` si aún no llegó. */
  of<T extends EngineEventType>(type: T, pred?: (e: EngineEventOf<T>) => boolean): EngineEventOf<T> | undefined
}

function record(client: EngineClient): Recorder {
  const events: EngineEvent[] = []
  const errors: EngineError[] = []
  let opens = 0
  const stop = client.events.subscribe((e) => events.push(e), { onOpen: () => opens++, onError: (e) => errors.push(e) })
  function of<T extends EngineEventType>(type: T, pred?: (e: EngineEventOf<T>) => boolean): EngineEventOf<T> | undefined {
    for (const e of events) {
      if (e.type !== type) continue
      const typed = e as EngineEventOf<T>
      if (!pred || pred(typed)) return typed
    }
    return undefined
  }
  return { events, errors, opens: () => opens, stop, of }
}

/** Texto de un mensaje de usuario con partes (el envío mínimo). */
const text = (t: string): { type: 'text'; text: string }[] => [{ type: 'text', text: t }]

export function runEngineContract(make: () => Promise<EngineContractHarness>, label = 'EngineClient'): void {
  describe(`contrato ${label}`, () => {
    let h: EngineContractHarness
    const dir = (): { directory: string } => ({ directory: h.directory })

    beforeAll(async () => {
      h = await make()
    })
    afterAll(async () => {
      await h.close()
    })

    /** Crea una sesión y espera a que su primer turno termine (`session.idle`). */
    async function turn(c: EngineClient, id: string, t: string): Promise<void> {
      const rec = record(c)
      try {
        await waitFor('stream abierto', () => (rec.opens() > 0 ? true : undefined))
        await c.sessions.send(id, { parts: text(t) }, dir())
        await waitFor('session.idle', () => rec.of('session.idle', (e) => e.sessionID === id))
      } finally {
        rec.stop()
      }
    }

    describe('sesiones', () => {
      it(
        'crea, obtiene y lista por carpeta',
        async () => {
          const s = await h.client.sessions.create({ ...dir(), title: 'contrato-lista' })
          expect(s.id).toBeTruthy()
          expect(s.title).toBe('contrato-lista')
          expect((await h.client.sessions.get(s.id, dir())).id).toBe(s.id)
          const list = await h.client.sessions.list({ ...dir(), roots: true })
          expect(list.map((x) => x.id)).toContain(s.id)
          if (h.otherDirectory) {
            const other = await h.client.sessions.list({ directory: h.otherDirectory })
            expect(other.map((x) => x.id)).not.toContain(s.id)
          }
        },
        TEST_MS
      )

      it(
        'renombra, archiva y desarchiva',
        async () => {
          const s = await h.client.sessions.create({ ...dir(), title: 'antes' })
          expect((await h.client.sessions.update(s.id, { title: 'despues' }, dir())).title).toBe('despues')
          const archived = await h.client.sessions.update(s.id, { archived: Date.now() }, dir())
          expect(archived.time.archived).toBeTruthy()
          const back = await h.client.sessions.update(s.id, { archived: 0 }, dir())
          expect(back.time.archived).toBeFalsy()
        },
        TEST_MS
      )

      it(
        'una sesión inexistente es notFound',
        async () => {
          const err = await h.client.sessions.get('ses_no_existe', dir()).catch((e: unknown) => e)
          expect(err).toBeInstanceOf(EngineError)
          expect((err as EngineError).kind).toBe('notFound')
          expect((err as EngineError).status).toBe(404)
        },
        TEST_MS
      )

      it(
        'borra una sesión y la deja de encontrar',
        async () => {
          const s = await h.client.sessions.create({ ...dir(), title: 'borrar' })
          await h.client.sessions.remove(s.id, dir())
          const err = await h.client.sessions.get(s.id, dir()).catch((e: unknown) => e)
          expect((err as EngineError).kind).toBe('notFound')
        },
        TEST_MS
      )

      it(
        'lista los hijos y el estado (inactiva = ausente)',
        async () => {
          const parent = await h.client.sessions.create({ ...dir(), title: 'padre' })
          const child = await h.client.sessions.create({ ...dir(), title: 'hijo', parentID: parent.id })
          expect((await h.client.sessions.children(parent.id, dir())).map((x) => x.id)).toEqual([child.id])
          expect(await h.client.sessions.status(dir())).not.toHaveProperty(parent.id)
          expect(await h.client.sessions.todos(parent.id, dir())).toEqual([])
        },
        TEST_MS
      )

      it(
        'envía un mensaje y recibe usuario + asistente con partes',
        async () => {
          const s = await h.client.sessions.create({ ...dir(), title: 'mensajes' })
          await turn(h.client, s.id, 'hola contrato')
          const msgs = await h.client.sessions.messages(s.id, dir())
          const roles = msgs.map((m) => m.info.role)
          expect(roles[0]).toBe('user')
          expect(roles).toContain('assistant')
          const user = msgs[0]
          expect(user.parts.some((p) => p.type === 'text' && p.text === 'hola contrato')).toBe(true)
          const one = await h.client.sessions.message(s.id, user.info.id, dir())
          expect(one.info.id).toBe(user.info.id)
          const last = await h.client.sessions.messages(s.id, { ...dir(), limit: 1 })
          expect(last).toHaveLength(1)
        },
        TEST_MS
      )

      it(
        'abortar una sesión inactiva no falla',
        async () => {
          const s = await h.client.sessions.create({ ...dir(), title: 'abortar' })
          await expect(h.client.sessions.abort(s.id, dir())).resolves.toBeUndefined()
        },
        TEST_MS
      )

      it(
        'hace fork y revert/unrevert',
        async () => {
          const s = await h.client.sessions.create({ ...dir(), title: 'origen' })
          await turn(h.client, s.id, 'para forkear')
          const [first] = await h.client.sessions.messages(s.id, dir())
          const copy = await h.client.sessions.fork(s.id, dir())
          expect(copy.id).not.toBe(s.id)
          const reverted = await h.client.sessions.revert(s.id, first.info.id, dir())
          expect(reverted.revert?.messageID).toBe(first.info.id)
          const restored = await h.client.sessions.unrevert(s.id, dir())
          expect(restored.revert).toBeUndefined()
        },
        TEST_MS
      )
    })

    describe('permisos', () => {
      for (const reply of ['once', 'always', 'reject'] as const) {
        it(
          `pide un permiso y se responde «${reply}»`,
          async (ctx) => {
            if (!h.armPermission) return ctx.skip()
            const s = await h.client.sessions.create({ ...dir(), title: `permiso-${reply}` })
            const rec = record(h.client)
            try {
              await waitFor('stream abierto', () => (rec.opens() > 0 ? true : undefined))
              await h.armPermission()
              await h.client.sessions.send(s.id, { parts: text('necesito permiso') }, dir())
              const asked = await waitFor('permission.asked', () => rec.of('permission.asked', (e) => e.request.sessionID === s.id))
              const pending = await h.client.permissions.list(dir())
              expect(pending.map((p) => p.id)).toContain(asked.request.id)
              await h.client.permissions.reply(asked.request.id, reply, { ...dir(), sessionID: s.id })
              const replied = await waitFor('permission.replied', () =>
                rec.of('permission.replied', (e) => e.requestID === asked.request.id)
              )
              expect(replied.reply).toBe(reply)
              expect((await h.client.permissions.list(dir())).map((p) => p.id)).not.toContain(asked.request.id)
            } finally {
              rec.stop()
              await h.client.sessions.abort(s.id, dir()).catch(() => undefined)
            }
          },
          TEST_MS
        )
      }

      it(
        'responder un permiso inexistente es notFound',
        async () => {
          const err = await h.client.permissions.reply('per_no_existe', 'once', dir()).catch((e: unknown) => e)
          expect(err).toBeInstanceOf(EngineError)
          expect((err as EngineError).kind).toBe('notFound')
        },
        TEST_MS
      )
    })

    describe('preguntas', () => {
      for (const action of ['reply', 'reject'] as const) {
        it(
          `hace una pregunta y se ${action === 'reply' ? 'responde' : 'rechaza'}`,
          async (ctx) => {
            if (!h.armQuestion) return ctx.skip()
            const s = await h.client.sessions.create({ ...dir(), title: `pregunta-${action}` })
            const rec = record(h.client)
            try {
              await waitFor('stream abierto', () => (rec.opens() > 0 ? true : undefined))
              await h.armQuestion()
              await h.client.sessions.send(s.id, { parts: text('pregunta algo') }, dir())
              const asked = await waitFor('question.asked', () => rec.of('question.asked', (e) => e.request.sessionID === s.id))
              expect((await h.client.questions.list(dir())).map((q) => q.id)).toContain(asked.request.id)
              if (action === 'reply') {
                await h.client.questions.reply(asked.request.id, [['Sí']], dir())
                const done = await waitFor('question.replied', () => rec.of('question.replied', (e) => e.requestID === asked.request.id))
                expect(done.answers).toEqual([['Sí']])
              } else {
                await h.client.questions.reject(asked.request.id, dir())
                await waitFor('question.rejected', () => rec.of('question.rejected', (e) => e.requestID === asked.request.id))
              }
            } finally {
              rec.stop()
              await h.client.sessions.abort(s.id, dir()).catch(() => undefined)
            }
          },
          TEST_MS
        )
      }
    })

    describe('eventos', () => {
      it(
        'abre el stream, anuncia «connected» y entrega sesiones y partes normalizadas',
        async () => {
          const rec = record(h.client)
          try {
            await waitFor('connected', () => rec.of('connected'))
            expect(rec.opens()).toBeGreaterThan(0)
            const s = await h.client.sessions.create({ ...dir(), title: 'eventos' })
            const created = await waitFor('session.created', () => rec.of('session.created', (e) => e.session.id === s.id))
            expect(created.directory).toBe(h.directory)
            await h.client.sessions.send(s.id, { parts: text('eventos') }, dir())
            await waitFor('part.updated', () => rec.of('part.updated', (e) => e.sessionID === s.id))
            await waitFor('message.updated', () => rec.of('message.updated', (e) => e.sessionID === s.id))
            await waitFor('session.status', () => rec.of('session.status', (e) => e.sessionID === s.id))
            await waitFor('session.idle', () => rec.of('session.idle', (e) => e.sessionID === s.id))
            await h.client.sessions.update(s.id, { title: 'eventos2' }, dir())
            await waitFor('session.updated', () => rec.of('session.updated', (e) => e.session.title === 'eventos2'))
            await h.client.sessions.remove(s.id, dir())
            await waitFor('session.deleted', () => rec.of('session.deleted', (e) => e.session.id === s.id))
          } finally {
            rec.stop()
          }
        },
        TEST_MS
      )

      it(
        'la función devuelta cierra la suscripción',
        async () => {
          const rec = record(h.client)
          await waitFor('connected', () => rec.of('connected'))
          rec.stop()
          const before = rec.events.length
          await h.client.sessions.create({ ...dir(), title: 'tras-cerrar' })
          await new Promise((r) => setTimeout(r, 150))
          expect(rec.events.length).toBe(before)
        },
        TEST_MS
      )

      it(
        'un handler que lanza no corta el stream y se informa por onError',
        async () => {
          const got: EngineEvent[] = []
          const errors: EngineError[] = []
          let boom = true
          const stop = h.client.events.subscribe(
            (e) => {
              if (boom && e.type === 'session.created') {
                boom = false
                throw new Error('fallo del consumidor')
              }
              got.push(e)
            },
            { onError: (e) => errors.push(e) }
          )
          try {
            await waitFor('connected', () => got.find((e) => e.type === 'connected'))
            await h.client.sessions.create({ ...dir(), title: 'handler-1' })
            await waitFor('error informado', () => errors[0])
            const second = await h.client.sessions.create({ ...dir(), title: 'handler-2' })
            await waitFor('evento posterior', () => got.find((e) => e.type === 'session.created' && e.session.id === second.id))
          } finally {
            stop()
          }
        },
        TEST_MS
      )

      it('se reconecta tras cortarse el stream', async (ctx) => {
        if (!h.dropStream) return ctx.skip()
        const rec = record(h.client)
        try {
          await waitFor('primera apertura', () => (rec.opens() >= 1 ? true : undefined))
          await h.dropStream()
          await waitFor('segunda apertura', () => (rec.opens() >= 2 ? true : undefined), 6_000)
          const s = await h.client.sessions.create({ ...dir(), title: 'tras-reconexion' })
          await waitFor('evento tras reconectar', () => rec.of('session.created', (e) => e.session.id === s.id))
        } finally {
          rec.stop()
        }
      }, 15_000)
    })

    describe('salud', () => {
      it(
        'responde ok con versión',
        async () => {
          const r = await h.client.health()
          expect(r.ok).toBe(true)
          expect(r.version).toBeTruthy()
        },
        TEST_MS
      )
    })
  })
}
