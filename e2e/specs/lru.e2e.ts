// Checklist manual del LRU de `messages` (docs/LRU-PLAN.md) contra la app real, con el tope forzado a 2
// (`localStorage['onyx.lru.max']='2'`, que `lruMax()` relee en cada llamada). Sin sleeps fijos: todo por condición.
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { FakeClient } from '../lib/fake'
import { hook, setMode, storeCall, storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'
import {
  connectCowork,
  emitGhostSessions,
  makeHomeFolder,
  matchesMessageList,
  messageFetches,
  messageKeys,
  newChatVia,
  newTaskVia,
  prepareFakeBin,
  scriptFor,
  serverText,
  setLocalAndReload,
  storeAssistantText,
  waitIdle,
  waitLoaded
} from '../lib/lru'

const MAX = 2
const dev = MODE === 'dev'

// ─────────────────────────────── Chat ───────────────────────────────

describe.skipIf(!dev)('LRU de messages: Chat (tope 2)', () => {
  const app = useApp({ localStorage: { 'onyx.lru.max': String(MAX) } })

  it('el tope forzado llega al renderer (localStorage) y useSessions arranca sin claves', async () => {
    const { page } = app()
    expect(await page.evaluate(() => localStorage.getItem('onyx.lru.max'))).toBe('2')
    expect(await messageKeys(page)).toEqual([])
  })

  it('4 chats, volver al primero: recarga sin vacío', async () => {
    const { page, fake } = app()
    const ids: string[] = []
    for (let n = 1; n <= 4; n++) {
      await scriptFor(fake, `LRU-Q${n}`, `LRU-R${n} respuesta final única${n}`, { title: `LRU Conv ${n}` })
      ids.push(await newChatVia(page, `LRU-Q${n}`, `LRU-R${n} respuesta final`))
    }
    for (let n = 1; n <= 4; n++) await expectVisible(page.getByRole('button', { name: `LRU Conv ${n}` }))
    const [c1, , , c4] = ids
    expect(await storeState(page, 'useChat', 'activeSessionId')).toBe(c4)

    // Solo la activa (fijada) + MAX sin fijar: la primera (la menos usada) salió.
    await expect.poll(async () => (await messageKeys(page)).includes(c1), { message: 'c1 desalojada' }).toBe(false)
    const keys = await messageKeys(page)
    expect(keys.length).toBeLessThanOrEqual(MAX + 1) // MAX + fijadas (solo la activa)
    expect(keys).toContain(c4)
    expect(await storeState(page, 'useSessions', 'loaded')).not.toHaveProperty(c1)

    // Retrasa `GET /session/*/message` para que el loader dure lo bastante como para observarlo.
    let delayed = 0
    await page.route(/\/session\/[^/]+\/message(\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        delayed++
        await new Promise((r) => setTimeout(r, 700))
      }
      await route.continue()
    })
    // Observador de DOM: cuenta instantes con la conversación c1 activa sin loader ni contenido (= vacío).
    await page.evaluate(
      ([target, finalText]) => {
        const w = window as any
        w.__lru = { blank: 0, loader: 0, content: 0, samples: 0 }
        const check = (): void => {
          if (w.__onyxE2E.useChat.getState().activeSessionId !== target) return
          const text = document.body.innerText
          w.__lru.samples++
          if (text.includes('Cargando conversación…')) w.__lru.loader++
          else if (text.includes(finalText)) w.__lru.content++
          else w.__lru.blank++
        }
        new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true })
      },
      [c1, 'LRU-R1 respuesta final única1'] as const
    )
    const before = await messageFetches(fake, c1)
    await page.getByRole('button', { name: 'LRU Conv 1' }).click()

    // Mientras dura la recarga: loader visible (no vacío).
    await expectVisible(page.getByText('Cargando conversación…'), 5_000)
    // Se vuelve a pedir el historial al servidor…
    await expect.poll(() => messageFetches(fake, c1), { message: 'session.messages de c1' }).toBe(before + 1)
    // …y el texto final es el correcto.
    await expectVisible(page.getByText('LRU-R1 respuesta final única1'), 15_000)
    await waitLoaded(page, c1)
    expect(await storeAssistantText(page, c1)).toBe('LRU-R1 respuesta final única1')
    const obs = await page.evaluate(() => (window as any).__lru as { blank: number; loader: number; content: number; samples: number })
    expect(delayed).toBeGreaterThanOrEqual(1)
    expect(obs.blank, `instantes en blanco: ${JSON.stringify(obs)}`).toBe(0)
    expect(obs.loader).toBeGreaterThan(0)
    expect(obs.content).toBeGreaterThan(0)
    await page.unroute(/\/session\/[^/]+\/message(\?.*)?$/)

    const after = await messageKeys(page)
    expect(after.length).toBeLessThanOrEqual(MAX + 1)
    expect(after).toContain(c1)
  })

  it('streaming largo, cambiar a 3 y volver: texto final completo e igual al guion', async () => {
    const { page, fake } = app()
    const words = Array.from({ length: 70 }, (_, i) => `LW${i + 1}`)
    const full = words.map((w) => `${w} `).join('') // el falso trocea por palabras con su espacio final

    // B, C, D: conversaciones cortas ya existentes.
    const others: string[] = []
    for (const n of ['B', 'C', 'D']) {
      await scriptFor(fake, `LRU-S${n}`, `RESP-S${n} corta`, { title: `LRU S${n}` })
      others.push(await newChatVia(page, `LRU-S${n}`, `RESP-S${n} corta`))
    }
    await fake.script({ match: '^LRU-LARGA$', title: 'LRU larga', steps: [{ type: 'text', text: full, chunkDelayMs: 100 }] })
    const a = await newChatVia(page, 'LRU-LARGA') // vuelve en cuanto se envía (no espera el final)
    await expectVisible(page.getByText('LW2 ', { exact: false }).first(), 20_000)
    expect(await storeState(page, 'useSessions', `status.${a}`)).toBe('busy')

    // Fase 1: cambiar a B, C, D MIENTRAS sigue el streaming y volver a A (fijada por busy: conserva messages).
    for (const id of others) {
      await hook(page, 'openChatSession', id)
      expect(await messageKeys(page)).toContain(a)
    }
    await hook(page, 'openChatSession', a)
    expect(await storeState(page, 'useSessions', `status.${a}`), 'el streaming debía seguir al volver (guion demasiado corto)').toBe('busy')
    expect(await messageKeys(page)).toContain(a)

    // Fase 2: irse otra vez y esperar a que A termine estando fuera; al pasar por otra conversación se desaloja.
    for (const id of others) await hook(page, 'openChatSession', id)
    await waitIdle(page, a, 30_000)
    await hook(page, 'openChatSession', others[0]) // touch → evictIdle con A ya sin fijar
    await expect.poll(async () => (await messageKeys(page)).includes(a), { message: 'A desalojada tras terminar' }).toBe(false)

    // Volver a A: se recarga del servidor; texto completo, idéntico al guion, sin duplicados ni huecos.
    const before = await messageFetches(fake, a)
    await hook(page, 'openChatSession', a)
    await waitLoaded(page, a)
    expect(await messageFetches(fake, a)).toBe(before + 1)
    const text = await storeAssistantText(page, a)
    expect(text).toBe(full)
    expect(await serverText(fake.conn, a)).toBe(full)
    const parts = await page.evaluate((sid) => {
      const list = ((window as any).__onyxE2E.useSessions.getState().messages[sid] ?? []) as { info: { role: string }; parts: { type: string }[] }[]
      return { assistants: list.filter((m) => m.info.role === 'assistant').length, textParts: list.filter((m) => m.info.role === 'assistant').flatMap((m) => m.parts).filter((p) => p.type === 'text').length }
    }, a)
    expect(parts).toEqual({ assistants: 1, textParts: 1 })
    await expectVisible(page.getByText('LW70', { exact: false }).first(), 15_000)
    expect(await page.getByText('LW70', { exact: false }).count()).toBe(1)
  })

  it('claves de messages ≤ N + fijadas tras una rutina simulada (eventos de sesiones ajenas)', async () => {
    const { page, fake } = app()
    const dir = await storeState<string>(page, 'useServer', 'connection.chatDirectory')
    const active = await storeState<string | null>(page, 'useChat', 'activeSessionId')
    expect(active).toBeTruthy()
    // Sonda en el renderer: pico de claves y qué sesiones ajenas llegaron a entrar (prueba que los eventos SÍ llegaron).
    await page.evaluate(() => {
      const w = window as any
      w.__ghost = { seen: new Set<string>(), peak: 0 }
      w.__ghostOff = w.__onyxE2E.useSessions.subscribe((st: { messages: Record<string, unknown[]> }) => {
        const ks = Object.keys(st.messages)
        w.__ghost.peak = Math.max(w.__ghost.peak, ks.length)
        for (const k of ks) if (k.startsWith('ses_ghost_')) w.__ghost.seen.add(k)
      })
    })
    const ghosts = [...(await emitGhostSessions(fake, dir, 8)), ...(await emitGhostSessions(fake, dir, 8, 'ses_ghost_b'))]
    await expect
      .poll(() => page.evaluate(() => (window as any).__ghost.seen.size as number), { timeout: 15_000, message: 'eventos ajenos recibidos' })
      .toBe(ghosts.length)
    // Fijadas = la conversación activa (nada está busy). Tras los microtasks el nº de claves vuelve a ≤ N + fijadas.
    await expect.poll(async () => (await messageKeys(page)).length, { message: 'claves ≤ N + fijadas' }).toBeLessThanOrEqual(MAX + 1)
    const { peak } = await page.evaluate(() => (window as any).__ghost as { peak: number })
    expect(peak).toBeLessThanOrEqual(MAX + 1 + 1) // el desalojo va en microtask: como mucho 1 clave transitoria de más
    const ghostKeys = (await messageKeys(page)).filter((k) => k.startsWith('ses_ghost_'))
    expect(ghostKeys.length).toBeLessThanOrEqual(MAX)
    expect(await messageKeys(page)).toContain(active)
    await page.evaluate(() => (window as any).__ghostOff())
  })
})

// ─────────────────────────────── Tareas ───────────────────────────────

describe.skipIf(!dev)('LRU de messages: Tareas real (tope 2)', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
  })
  const app = useApp({ localStorage: { 'onyx.lru.max': String(MAX) }, env: bin.env })
  const DUP_KEY = /two children with the same key/
  let cw: FakeClient
  let dir = ''
  const tasks: string[] = []
  const UNICO = 'zafiro-violeta-lru'

  const openTaskRow = async (n: number): Promise<void> => {
    await app().page.getByRole('button', { name: `Tarea LRU ${n}` }).first().click()
  }

  it('conecta Tareas con una carpeta temporal y crea 4 tareas', async () => {
    const { page } = app()
    const c = await connectCowork(app(), folder.path)
    cw = c.fake
    dir = c.conn.folder
    for (let n = 1; n <= 4; n++) {
      const extra = n === 1 ? ` con ${UNICO}` : ''
      await cw.script({ match: `CW-T${n}`, title: `Tarea LRU ${n}`, steps: [{ type: 'text', text: `Resultado CW-T${n}${extra} fin` }] })
      tasks.push(await newTaskVia(page, `CW-T${n} haz algo`, `Resultado CW-T${n}`))
      await expectVisible(page.getByRole('button', { name: `Tarea LRU ${n}` }).first())
    }
    expect(new Set(tasks).size).toBe(4)
    // Todas viven en el origen de Tareas (no en Chat).
    const src = await storeState<Record<string, string>>(page, 'useSessions', 'sessionSource')
    for (const id of tasks) expect(src[id]).toBe((await storeState<{ baseUrl: string }>(page, 'useCowork', 'conn')).baseUrl)
  })

  it('F7-B5: la vista de una tarea terminada no emite claves React duplicadas (CoworkWorkspace.tsx:656-657)', async () => {
    await openTaskRow(1)
    await openTaskRow(2)
    const dups = app().errors.filter((e) => DUP_KEY.test(e.text))
    expect(dups.map((e) => e.text.slice(0, 120))).toEqual([])
  })

  it('búsqueda Tareas encuentra texto de una tarea desalojada sin pedir historial', async () => {
    const { page } = app()
    const [t1] = tasks
    // Abrir T1 la deja `loaded` (solo entonces el desalojo siembra la caché de búsqueda), y luego T2..T4 la desalojan.
    await openTaskRow(1)
    await waitLoaded(page, t1)
    expect(await messageKeys(page)).toContain(t1)
    for (const n of [2, 3, 4]) await openTaskRow(n)
    await expect.poll(async () => (await messageKeys(page)).includes(t1), { message: 'T1 desalojada' }).toBe(false)
    expect((await messageKeys(page)).length).toBeLessThanOrEqual(MAX + 1)

    const before = await cw.requests({ limit: 5000, method: 'GET' })
    const fetchesBefore = before.filter((r) => matchesMessageList(r, t1)).length
    await page.getByRole('searchbox', { name: 'Buscar tareas' }).fill(UNICO)
    // El fragmento con el texto único aparece en los resultados (T1 no está activa ni en messages).
    await expectVisible(page.getByText(UNICO, { exact: false }).first(), 20_000)
    const after = (await cw.requests({ limit: 5000, method: 'GET' })).filter((r) => matchesMessageList(r, t1)).length
    expect(after, 'la búsqueda no debe pedir session.messages de la tarea desalojada').toBe(fetchesBefore)
    expect(await messageKeys(page)).not.toContain(t1) // buscar tampoco la trae de vuelta a messages
    await page.getByRole('button', { name: 'Limpiar la búsqueda' }).click()
  })

  it('permiso pendiente en Tareas no se desaloja (y al resolverlo vuelve a ser desalojable)', async () => {
    const { page } = app()
    await cw.script({ match: 'CW-PERM', title: 'Tarea LRU perm', steps: [{ type: 'text', text: 'Previo al permiso PERM-UNICO fin' }] })
    const p = await newTaskVia(page, 'CW-PERM haz algo', 'Previo al permiso PERM-UNICO')
    await expectVisible(page.getByRole('button', { name: 'Tarea LRU perm' }).first())
    // Permiso pendiente (sesión en reposo: la única razón para fijarla es el permiso, no `busy`).
    await cw.emit({
      type: 'permission.asked',
      directory: dir,
      properties: { id: 'per_lru_1', sessionID: p, permission: 'bash', patterns: ['echo lru'], metadata: {}, always: [] }
    })
    await expect.poll(() => storeState<object>(page, 'useCowork', 'permissions'), { message: 'permiso en el store' }).toHaveProperty('per_lru_1')

    for (const n of [1, 2, 3, 4]) {
      await openTaskRow(n)
      await waitLoaded(page, tasks[n - 1])
      expect(await messageKeys(page), `tras abrir T${n}`).toContain(p)
    }
    const keys = await messageKeys(page)
    // Fijadas: la activa y la del permiso; 5 tareas en total → alguna sin fijar tuvo que salir.
    expect(keys.length).toBeLessThanOrEqual(MAX + 2)
    expect(keys.length).toBeLessThan(5)
    expect(await storeAssistantText(page, p)).toContain('PERM-UNICO')

    // Resolver el permiso la libera: después de otras visitas, sale.
    await cw.emit({ type: 'permission.replied', directory: dir, properties: { sessionID: p, requestID: 'per_lru_1', reply: 'reject' } })
    await expect.poll(() => storeState<object>(page, 'useCowork', 'permissions')).not.toHaveProperty('per_lru_1')
    for (const n of [1, 2, 3, 4]) await openTaskRow(n)
    await expect.poll(async () => (await messageKeys(page)).includes(p), { message: 'sin permiso, se desaloja' }).toBe(false)
  })
})

// ─────────────────────────────── Code ───────────────────────────────

describe.skipIf(!dev)('LRU de messages: Code (tope 2)', () => {
  const proj = makeHomeFolder()
  afterAll(() => proj.cleanup())
  const app = useApp({ localStorage: { 'onyx.lru.max': String(MAX) } })
  const codeKeys = async (): Promise<string[]> => Object.keys(await storeState<Record<string, unknown>>(app().page, 'useCode', 'messages'))
  const codeText = async (id: string): Promise<string> =>
    app().page.evaluate((sid) => {
      const list = ((window as any).__onyxE2E.useCode.getState().messages[sid] ?? []) as { info: { role: string }; parts: { type: string; text?: string }[] }[]
      return list.flatMap((m) => m.parts.filter((x) => x.type === 'text').map((x) => `${m.info.role}:${x.text ?? ''}`)).join('|')
    }, id)
  const activeCode = (): Promise<string> => storeState<string>(app().page, 'useCode', 'activeSessionID')

  it('abre el proyecto en Code', async () => {
    const { page } = app()
    await setMode(page, 'code')
    await storeCall(page, 'useCode', 'openProject', proj.path)
    expect(await storeState(page, 'useCode', 'directory')).toBe(proj.path)
  })

  it('sesión encolada autoenvía (A no se desaloja con tope 2 al cambiar a B/C/D)', async () => {
    const { page, fake } = app()
    const words = Array.from({ length: 40 }, (_, i) => `CW${i + 1}`)
    await fake.script({ match: '^CODE-A1$', title: 'Code A', steps: [{ type: 'text', text: words.map((w) => `${w} `).join(''), chunkDelayMs: 100 }] })
    await fake.script({ match: '^CODE-A2$', steps: [{ type: 'text', text: 'RESP-A2 de la cola' }] })
    await storeCall(page, 'useCode', 'send', 'CODE-A1')
    const a = await activeCode()
    await expect.poll(() => storeState(page, 'useCode', `runState.${a}`)).toBe('busy')
    await storeCall(page, 'useCode', 'enqueue', a, 'CODE-A2')
    expect(await storeState<unknown[]>(page, 'useCode', `queue.${a}`)).toHaveLength(1)

    const others: string[] = []
    for (const t of ['B', 'C', 'D']) others.push((await storeCall<string>(page, 'useCode', 'newSessionAt', proj.path, `Code ${t}`)) as string)
    expect(await activeCode()).toBe(others[2])
    // A sigue con su contenido: ejecutando y con cola (fijada) aunque haya 4 sesiones y el tope sea 2.
    expect(await codeKeys()).toContain(a)
    expect((await codeKeys()).length).toBeLessThanOrEqual(MAX + 3) // activa + A fijadas + MAX libres
    expect(await codeText(a)).toContain('user:CODE-A1')

    // Al terminar A, el mensaje en cola sale hacia el servidor (y se responde).
    const req = await fake.waitForRequest(
      (r) => r.method === 'POST' && r.path === `/session/${a}/prompt_async` && JSON.stringify(r.body).includes('CODE-A2'),
      40_000
    )
    expect(req.path).toBe(`/session/${a}/prompt_async`)
    await expect.poll(() => storeState<unknown[]>(page, 'useCode', `queue.${a}`)).toHaveLength(0)
    await expect.poll(() => codeText(a), { timeout: 20_000, message: 'respuesta de la cola' }).toContain('assistant:RESP-A2 de la cola')
    await waitIdle(page, a).catch(() => undefined)
  })

  it('revert y fork tras reabrir una sesión desalojada', async () => {
    const { page, fake } = app()
    await fake.script({ match: '^CODE-R1$', steps: [{ type: 'text', text: 'RESP-R1 primera' }] })
    await fake.script({ match: '^CODE-R2$', steps: [{ type: 'text', text: 'RESP-R2 segunda' }] })
    const r = (await storeCall<string>(page, 'useCode', 'newSessionAt', proj.path, 'Code R')) as string
    await storeCall(page, 'useCode', 'send', 'CODE-R1')
    await expect.poll(() => codeText(r), { timeout: 20_000 }).toContain('assistant:RESP-R1 primera')
    await expect.poll(() => storeState(page, 'useCode', `runState.${r}`)).not.toBe('busy')
    await storeCall(page, 'useCode', 'send', 'CODE-R2')
    await expect.poll(() => codeText(r), { timeout: 20_000 }).toContain('assistant:RESP-R2 segunda')
    await expect.poll(() => storeState(page, 'useCode', `runState.${r}`)).not.toBe('busy')

    // Tres sesiones más: R (en reposo, sin cola) sale.
    for (const t of ['S1', 'S2', 'S3']) await storeCall(page, 'useCode', 'newSessionAt', proj.path, `Code ${t}`)
    await expect.poll(async () => (await codeKeys()).includes(r), { message: 'R desalojada' }).toBe(false)

    // Reabrir: recarga desde el servidor.
    const fetchesBefore = await messageFetches(fake, r)
    await storeCall(page, 'useCode', 'selectSession', r)
    await expect.poll(() => codeText(r), { timeout: 15_000 }).toContain('assistant:RESP-R2 segunda')
    expect(await messageFetches(fake, r)).toBeGreaterThan(fetchesBefore)
    const serverMsgs = (await (await fetch(`${fake.conn.baseUrl}/session/${r}/message`, { headers: { authorization: fake.conn.authorization } })).json()) as {
      info: { id: string; role: string }
    }[]
    const lastUser = serverMsgs.filter((m) => m.info.role === 'user').at(-1)!.info.id

    // Revert: apunta al último mensaje de usuario (que solo se conoce si la recarga trajo el historial).
    await storeCall(page, 'useCode', 'revertLast')
    const rev = await fake.waitForRequest((q) => q.method === 'POST' && q.path === `/session/${r}/revert`)
    expect((rev.body as { messageID: string }).messageID).toBe(lastUser)
    await expect.poll(() => storeState<string>(page, 'useCode', `sessions.${r}.revert.messageID`)).toBe(lastUser)
    await storeCall(page, 'useCode', 'unrevert')

    // Fork de la sesión reabierta: el fork trae todo el historial.
    const forked = await storeCall<string | null>(page, 'useCode', 'forkSession', r)
    expect(forked).toBeTruthy()
    await fake.waitForRequest((q) => q.method === 'POST' && q.path === `/session/${r}/fork`)
    expect(await activeCode()).toBe(forked)
    await expect.poll(() => codeText(forked as string), { timeout: 15_000 }).toContain('assistant:RESP-R1 primera')
    expect(await codeText(forked as string)).toContain('assistant:RESP-R2 segunda')
  })
})

