import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { FakeClient } from '../lib/fake'
import { connection, hook, storeState, waitForHooks } from '../lib/stores'
import { expectAttr, expectCount, expectVisible } from '../lib/wait'
import { spyNotifications } from '../lib/notifications'
import { assistantInfo, chatDirectory, consumeErrors, countIpc, makeGitRepo, openCodeProject, connectCoworkFolder, makeHomeFolder, prepareFakeBin, type CoworkConn, fakeApi, newChatAndSend, sessionInfo } from '../lib/fase6'

describe.skipIf(MODE === 'prod')(`fase 6 (${MODE})`, () => {
  const app = useApp()
  let orphanBusy: string[] = []
  let projectDir = ''
  afterAll(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true })
  })

  it('1. evento con directorio ajeno no aparece en la lista de Chat', async () => {
    const a = app()
    await waitForHooks(a.page)
    const chatDir = await chatDirectory(a)
    const foreign = '/tmp/onyx-e2e-directorio-ajeno'
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await a.fake.emit({
      events: [
        { type: 'session.created', directory: foreign, properties: { sessionID: 'ses_ajena', info: sessionInfo('ses_ajena', foreign, 'Sesion ajena xyz') } },
        { type: 'message.updated', directory: foreign, properties: { sessionID: 'ses_ajena', info: assistantInfo('msg_ajeno', 'ses_ajena', foreign) } },
        { type: 'session.created', directory: chatDir, properties: { sessionID: 'ses_chat', info: sessionInfo('ses_chat', chatDir, 'Sesion de chat xyz') } },
        { type: 'message.updated', directory: chatDir, properties: { sessionID: 'ses_chat', info: assistantInfo('msg_chat', 'ses_chat', chatDir) } }
      ]
    })
    await expectVisible(a.page.getByText('Sesion de chat xyz'))
    const sessions = await storeState<Record<string, unknown>>(a.page, 'useSessions', 'sessions')
    const messages = await storeState<Record<string, unknown>>(a.page, 'useSessions', 'messages')
    expect(Object.keys(sessions)).toContain('ses_chat')
    expect(Object.keys(sessions)).not.toContain('ses_ajena')
    expect(Object.keys(messages)).toContain('ses_chat')
    expect(Object.keys(messages)).not.toContain('ses_ajena')
    await expectCount(a.page.getByText('Sesion ajena xyz'), 0)
  })

  it('9. resaltado de código: el bloque ```ts genera .hljs y clases de token', async () => {
    const a = app()
    await newChatAndSend(a, 'dame codigo', { steps: [{ type: 'text', text: 'Aqui:\n\n```ts\nconst x: number = 1\nfunction f() { return x }\n```\n' }], match: 'dame codigo' })
    const code = a.page.locator('pre code.hljs')
    await expectVisible(code, 30_000)
    await expectVisible(a.page.locator('pre code .hljs-keyword'))
    expect(await a.page.locator('pre code .hljs-keyword').first().innerText()).toMatch(/const|function|return/)
    expect(await code.first().getAttribute('class')).toContain('language-ts')
  })

  it('10. Enter con IME (F6-B7): isComposing / keyCode 229 no envía; Enter normal sí', async () => {
    const a = app()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await a.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const box = a.page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('mensaje ime')
    const before = (await a.fake.requests({ limit: 0, path: '/session', method: 'POST' })).filter((r) => r.path.endsWith('/prompt_async')).length
    // Precondición: este Chromium respeta keyCode en el constructor (si no, el caso 229 no probaría nada).
    expect(await a.page.evaluate(() => new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 }).keyCode)).toBe(229)
    const fire = (init: { isComposing?: boolean; keyCode?: number }): Promise<boolean> =>
      a.page.evaluate((i) => {
        const ta = document.querySelector('textarea') as HTMLTextAreaElement
        ta.focus()
        const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...i })
        return ta.dispatchEvent(ev) // false si alguien llamó preventDefault (o sea, si se tomó como envío)
      }, init)
    // isComposing:true y keyCode 229 (Enter que confirma la composición): no se cancela ni se envía.
    expect(await fire({ isComposing: true })).toBe(true)
    expect(await fire({ keyCode: 229 })).toBe(true)
    // Espera acotada (negativa): dar tiempo a que un envío indebido llegue al falso.
    await a.page.waitForTimeout(700)
    const promptCount = async (): Promise<number> =>
      (await a.fake.requests({ limit: 0, method: 'POST' })).filter((r) => /\/prompt_async$/.test(r.path)).length
    expect(await promptCount()).toBe(before)
    expect(await box.inputValue()).toBe('mensaje ime')
    // Enter normal sí envía.
    await box.press('Enter')
    await expect.poll(promptCount, { timeout: 15_000 }).toBe(before + 1)
    const req = (await a.fake.requests({ limit: 0, method: 'POST' })).filter((r) => /\/prompt_async$/.test(r.path)).pop()!
    expect(JSON.stringify(req.body)).toContain('mensaje ime')
    await expectVisible(a.page.getByText('Respuesta simulada: mensaje ime'), 30_000)
  })

  it('2. busy pegado (F6-B5): tras perder el evento de fin y reconectar el SSE, el spinner desaparece', async () => {
    const a = app()
    const chatDir = await chatDirectory(a)
    const sid = await newChatAndSend(a, 'respuesta larga', { steps: [{ type: 'text', text: 'parcial' }, { type: 'delay', ms: 60_000 }], match: 'respuesta larga' })
    const status = (): Promise<string | undefined> => storeState<string | undefined>(a.page, 'useSessions', `status.${sid}`)
    await expect.poll(status, { timeout: 15_000 }).toBe('busy')
    const stop = a.page.getByRole('button', { name: 'Detener' })
    await expectVisible(stop)
    // Se pierde el evento de fin: se cortan los SSE y se bloquean los nuevos; con el stream caído se aborta la ejecución
    // en el falso (emite session.status idle a nadie). La sesión queda idle en el servidor y busy en la UI.
    await a.fake.dropSse(3_000)
    await expect.poll(() => storeState<boolean>(a.page, 'useServer', 'streaming'), { timeout: 10_000 }).toBe(false)
    await fakeApi(a, 'POST', `/session/${sid}/abort`, chatDir)
    await expect.poll(async () => ((await a.fake.status()).sessions as { id: string; status: string }[]).find((s) => s.id === sid)?.status, { timeout: 10_000 }).toBe('idle')
    expect(await status()).toBe('busy') // busy pegado: la UI no se enteró
    expect(await stop.isVisible()).toBe(true)
    // El SSE vuelve (backoff de la app) → onStreamReconnect → syncChatRunStatus → idle.
    await expect.poll(status, { timeout: 30_000 }).toBe('idle')
    await expectCount(a.page.getByRole('button', { name: 'Detener' }), 0)
    await expectVisible(a.page.getByRole('button', { name: 'Enviar' }))
    // Cortar el SSE a propósito deja errores de red en consola (esperados): se consumen solo esos.
    expect(consumeErrors(a, /\/global\/event/)).toBeGreaterThan(0)
  })

  it('7. ErrorBoundary (F6-B13): throwIn muestra el fallback; Reintentar con la causa limpia recupera la vista', async () => {
    const a = app()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await hook(a.page, 'throwIn', 'chat')
    const alert = a.page.locator('[role="alert"]')
    await expectVisible(alert.getByRole('heading', { name: /Algo salió mal/ }))
    await expectVisible(alert.getByRole('button', { name: 'Reintentar' }))
    await expectVisible(alert.getByRole('button', { name: 'Copiar detalle' }))
    // Reintentar con la causa aún activa vuelve a caer en el fallback.
    await alert.getByRole('button', { name: 'Reintentar' }).click()
    await expectVisible(alert.getByRole('button', { name: 'Reintentar' }))
    await hook(a.page, 'throwIn', null)
    await alert.getByRole('button', { name: 'Reintentar' }).click()
    await expectCount(a.page.locator('[role="alert"]'), 0)
    await expectVisible(a.page.getByPlaceholder('Escribe un mensaje…'))
    // El error fue intencional (console.error del ErrorBoundary + pageerror de React): se consume para el afterEach.
    expect(a.unexpectedErrors().length).toBeGreaterThan(0)
    a.errors.length = 0
  })

  it('8. toggle de Rutinas (F6-B8): persiste en routines.json y el clic no abre el editor ni selecciona la tarjeta', async () => {
    const a = app()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Rutinas' }).click()
    await a.page.getByRole('button', { name: /Empezar desde cero|Nueva rutina/ }).first().click()
    const editor = a.page.getByRole('dialog', { name: 'Nueva rutina' })
    await expectVisible(editor)
    await editor.getByLabel('Nombre').fill('Rutina e2e toggle')
    await editor.getByLabel('Instrucción').fill('no hacer nada')
    await editor.getByRole('button', { name: 'Crear rutina' }).click()
    await expectCount(a.page.getByRole('dialog', { name: 'Nueva rutina' }), 0)

    const card = a.page.getByRole('button', { name: /Rutina e2e toggle/ }).first()
    await expectVisible(card)
    const sw = card.getByRole('switch')
    const file = join(a.userData, 'routines.json')
    const persisted = (): boolean | undefined => {
      try {
        return (JSON.parse(readFileSync(file, 'utf8')).routines as { name: string; enabled: boolean }[]).find((r) => r.name === 'Rutina e2e toggle')?.enabled
      } catch {
        return undefined
      }
    }
    await expect.poll(persisted, { timeout: 10_000 }).toBeDefined()
    const initial = persisted()!
    expect(await sw.getAttribute('aria-checked')).toBe(String(initial))
    // Al crearla la tarjeta queda seleccionada (panel de detalle abierto): se cierra para que el aserto de selección sea útil.
    if ((await card.getAttribute('aria-pressed')) === 'true') await a.page.getByRole('button', { name: 'Cerrar detalle' }).click()
    await expect.poll(() => card.getAttribute('aria-pressed')).toBe('false')

    for (const want of [!initial, initial]) {
      await sw.click()
      await expect.poll(() => sw.getAttribute('aria-checked'), { timeout: 10_000 }).toBe(String(want))
      await expect.poll(persisted, { timeout: 10_000 }).toBe(want)
      // stopPropagation: el clic del interruptor no selecciona la tarjeta ni abre el editor.
      expect(await card.getAttribute('aria-pressed')).toBe('false')
      await expectCount(a.page.getByRole('dialog'), 0)
    }
  })

  it('4. Code terminó estando en otro modo: notificación nativa "Code terminó" con el título de la sesión', async () => {
    const a = app()
    const spy = await spyNotifications(a.electronApp)
    // La ventana headless nunca tiene el foco del sistema (y `sendNotification`/`notifyCode` callan si lo tiene):
    // se fija de forma explícita para no depender de la máquina.
    await a.page.evaluate(() => {
      document.hasFocus = () => false
    })
    projectDir = makeGitRepo()
    await openCodeProject(a, projectDir)
    await a.fake.script({ steps: [{ type: 'text', text: 'listo en Code', delayMs: 4_000 }], match: 'tarea de code' })
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('tarea de code')
    await box.press('Enter')
    const sid = await (async () => {
      await expect.poll(() => storeState<string | null>(a.page, 'useCode', 'activeSessionID'), { timeout: 15_000 }).toBeTruthy()
      return (await storeState<string>(a.page, 'useCode', 'activeSessionID'))!
    })()
    await expect.poll(() => storeState<string>(a.page, 'useCode', `runState.${sid}`), { timeout: 15_000 }).toBe('busy')
    // A Chat mientras Code sigue trabajando (la suscripción de Code vive a nivel de App: D3).
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    expect(await storeState(a.page, 'useUi', 'mode')).toBe('chat')
    expect(await storeState<string>(a.page, 'useCode', `runState.${sid}`)).toBe('busy') // aún no terminó (margen de 4 s)
    expect(await spy.shown()).toEqual([])
    await expect.poll(() => storeState<string>(a.page, 'useCode', `runState.${sid}`), { timeout: 30_000 }).toBe('idle')
    await expect.poll(async () => (await spy.shown()).map((n) => n.title), { timeout: 15_000 }).toContain('Code terminó')
    const n = (await spy.shown()).find((x) => x.title === 'Code terminó')!
    expect(n.body).toBe(await storeState<string>(a.page, 'useCode', `sessions.${sid}.title`))
    expect(await storeState<boolean>(a.page, 'useCode', `unread.${sid}`)).toBe(true)
  })

  it('6. Cambios (Pf1): 300 file.watcher.updated en ~1 s → ≤ 2 llamadas a git:status; otro directorio → 0', async () => {
    const a = app()
    if (!projectDir) projectDir = makeGitRepo() // autosuficiente si se corre solo (normalmente lo abrió el caso 4)
    await openCodeProject(a, projectDir)
    const changes = a.page.getByRole('button', { name: 'Cambios', exact: true })
    await expectVisible(changes)
    if ((await changes.first().getAttribute('aria-pressed')) !== 'true') await changes.first().click()
    await expectAttr(changes, 'aria-pressed', 'true')
    const git = await countIpc(a.electronApp, 'git:status')
    // Estabilizar: esperar a que no lleguen más git:status por el estado previo (fin de la ejecución del caso 4, etc.).
    let last = -1
    await expect
      .poll(async () => {
        const c = await git.count()
        const same = c === last
        last = c
        return same
      }, { timeout: 15_000, interval: 1_200 })
      .toBe(true)
    await git.reset()
    const v0 = await storeState<number>(a.page, 'useCode', 'fsVersion')

    // 300 eventos del proyecto en ~1 s (6 lotes de 50 cada ~180 ms).
    const burst = (dir: string, n: number): Promise<unknown> =>
      a.fake.emit({ events: Array.from({ length: n }, (_, i) => ({ type: 'file.watcher.updated', directory: dir, properties: { file: `${dir}/f${i}.txt`, event: 'change' } })) })
    const t0 = Date.now()
    for (let i = 0; i < 6; i++) {
      await burst(projectDir, 50)
      await new Promise((r) => setTimeout(r, 180))
    }
    const spanMs = Date.now() - t0
    // Espera acotada (documentada): debounce de 400 ms tras el último evento + margen; a los 3 s ya debe estar todo.
    await new Promise((r) => setTimeout(r, 3_000))
    const calls = await git.count()
    const bumps = (await storeState<number>(a.page, 'useCode', 'fsVersion')) - v0
    console.info(`[fase6/6] 300 eventos en ${spanMs} ms → git:status=${calls}, fsVersion+${bumps}`)
    expect(spanMs).toBeLessThan(2_500)
    expect(bumps).toBeGreaterThanOrEqual(1) // la tubería funciona (si no, el ≤2 sería trivial)
    expect(bumps).toBeLessThanOrEqual(2)
    expect(calls).toBeGreaterThanOrEqual(1)
    expect(calls).toBeLessThanOrEqual(2)

    // Otro directorio: ni sube fsVersion ni se llama a git:status.
    await git.reset()
    const v1 = await storeState<number>(a.page, 'useCode', 'fsVersion')
    for (let i = 0; i < 6; i++) await burst('/tmp/onyx-e2e-otro-proyecto', 50)
    await new Promise((r) => setTimeout(r, 1_500)) // espera acotada (negativa): > debounce (400 ms) + margen
    expect(await git.count()).toBe(0)
    expect(await storeState<number>(a.page, 'useCode', 'fsVersion')).toBe(v1)
  })

  it('6b. Cambios (Pf1 parte 3): con el documento oculto (simulado) no hay git:status; al volver se pone al día', async () => {
    const a = app()
    if (!projectDir) projectDir = makeGitRepo()
    await openCodeProject(a, projectDir)
    const changes = a.page.getByRole('button', { name: 'Cambios', exact: true })
    if ((await changes.first().getAttribute('aria-pressed')) !== 'true') await changes.first().click()
    await expectAttr(changes, 'aria-pressed', 'true')
    const git = await countIpc(a.electronApp, 'git:status')
    await new Promise((r) => setTimeout(r, 1_500)) // asentar cargas pendientes (acotada)
    // Ocultar de verdad la ventana (hide/minimize) no cambia `document.visibilityState` en headless (ver el it.skip de
    // más abajo): se simula el estado del documento, que es lo que el hook lee, con el evento real `visibilitychange`.
    const setWindow = (hide: boolean): Promise<void> =>
      a.page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') })
        document.dispatchEvent(new Event('visibilitychange'))
      }, hide)
    const visibility = (): Promise<string> => a.page.evaluate(() => document.visibilityState)
    await setWindow(true)
    try {
      await expect.poll(visibility, { timeout: 5_000 }).toBe('hidden')
      await git.reset()
      const v0 = await storeState<number>(a.page, 'useCode', 'fsVersion')
      for (let i = 0; i < 3; i++) {
        await a.fake.emit({ events: Array.from({ length: 20 }, (_, n) => ({ type: 'file.watcher.updated', directory: projectDir, properties: { file: `${projectDir}/h${i}_${n}.txt`, event: 'change' } })) })
        await new Promise((r) => setTimeout(r, 700)) // > debounce (400 ms): cada lote sube fsVersion
      }
      await new Promise((r) => setTimeout(r, 1_000)) // espera acotada (negativa)
      expect(await storeState<number>(a.page, 'useCode', 'fsVersion')).toBeGreaterThan(v0) // el store sigue contando…
      expect(await git.count()).toBe(0) // …pero los paneles no refrescan lo oculto
    } finally {
      await setWindow(false)
    }
    await expect.poll(visibility, { timeout: 5_000 }).toBe('visible')
    await expect.poll(() => git.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1) // al volver se pone al día
  })

  it.skip('6c. ocultar/minimizar la ventana real no genera git:status (BrowserWindow.hide/minimize no cambia document.visibilityState en headless; checklist humana en docs/VERIFICACION.md)', () => undefined)

  it('3. reiniciar el sidecar desde Ajustes durante un busy limpia el estado y los mensajes nuevos funcionan', async () => {
    const a = app()
    // Aislamiento: los casos previos dejan la app en modo Code con una sesión activa que no existirá en el sidecar reiniciado
    // (su recarga daría un 404 legítimo en consola): se vuelve a Chat y se suelta la sesión de Code.
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await a.page.evaluate(() => (window as any).__onyxE2E.useCode.setState({ activeSessionID: null }))
    const sid = await newChatAndSend(a, 'trabajo largo', { steps: [{ type: 'text', text: 'parcial' }, { type: 'delay', ms: 60_000 }], match: 'trabajo largo' })
    const status = (id: string): Promise<string | undefined> => storeState<string | undefined>(a.page, 'useSessions', `status.${id}`)
    await expect.poll(() => status(sid), { timeout: 15_000 }).toBe('busy')
    const oldUrl = await storeState<string>(a.page, 'useServer', 'connection.baseUrl')
    const oldPid = (await a.fake.status()).pid as number

    await a.page.keyboard.press('Meta+,')
    const settingsNav = a.page.locator('nav[aria-label="Secciones de ajustes"]')
    await expectVisible(settingsNav)
    await settingsNav.getByRole('button', { name: 'General', exact: true }).click()
    await a.page.getByRole('button', { name: 'Reiniciar', exact: true }).click()

    // Conexión nueva (otro puerto/credenciales) y nuevo proceso del falso.
    await expect.poll(() => storeState<string>(a.page, 'useServer', 'connection.baseUrl'), { timeout: 60_000 }).not.toBe(oldUrl)
    const fake2 = new FakeClient(await connection(a.page))
    expect(((await fake2.status()).pid as number)).not.toBe(oldPid)
    // La sesión no existe en el sidecar nuevo: la lista se vacía y la vista de Chat vuelve a estado libre.
    await expect.poll(() => storeState<string[]>(a.page, 'useSessions', 'sessions').then((x) => Object.keys(x)), { timeout: 30_000 }).not.toContain(sid)
    await a.page.keyboard.press('Escape')
    await expectCount(a.page.locator('nav[aria-label="Secciones de ajustes"]'), 0)
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await expectCount(a.page.getByRole('button', { name: 'Detener' }), 0)
    await expectVisible(a.page.getByRole('button', { name: 'Enviar' }))
    expect(await storeState(a.page, 'useChat', 'activeSessionId')).toBeNull()
    // Efecto residual observado (ver 3b): `status[sid]` sigue 'busy' para una sesión que ya no existe.
    orphanBusy = Object.entries(await storeState<Record<string, string>>(a.page, 'useSessions', 'status'))
      .filter(([, v]) => v !== 'idle')
      .map(([k]) => k)
    // El único aviso de red esperado es el corte del SSE por el reinicio.
    consumeErrors(a, /\/global\/event/)

    // Mensajes nuevos funcionan contra el sidecar nuevo. El falso numera ids de forma determinista (ses_e2e_0001,
    // evt_0001…) y el proceso nuevo reinicia los contadores: el store conserva `loaded`/`messages`/`seen` de la sesión vieja
    // y descartaría como duplicados los eventos nuevos. Se adelantan ambos contadores del falso nuevo (con el OpenCode real
    // los ids son únicos; no es un bug de la app).
    const fakeConn = { ...a, fake: fake2 } as typeof a
    const dir = await chatDirectory(a)
    for (let i = 0; i < 3; i++) await fakeApi(fakeConn, 'POST', '/session', dir, {})
    await fake2.emit({ events: Array.from({ length: 60 }, () => ({ type: 'e2e.relleno', properties: {} })) })
    await a.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const box = a.page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('despues del reinicio')
    await a.page.getByRole('button', { name: 'Enviar' }).click()
    const req = await fake2.waitForRequest((r) => r.method === 'POST' && /prompt_async$/.test(r.path))
    expect(JSON.stringify(req.body)).toContain('despues del reinicio')
    await expectVisible(a.page.getByText('Respuesta simulada: despues del reinicio'), 30_000)
  })

  // F7-B10: antes `syncChatRunStatus` calculaba su ámbito desde `useSessions.sessions`, que `loadChatSessions` ya vació (el
  // sidecar nuevo no conoce la sesión), y `status[sid]` quedaba 'busy' para siempre. Ahora el ámbito incluye las entradas de
  // `status` sin sesión y se encadena la lista antes del estado.
  it('3b. tras el reinicio no quedan entradas busy huérfanas en useSessions.status', () => {
    expect(orphanBusy).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Caso 5 (Cowork real): sidecar sandboxeado de Cowork + sidecar principal, ambos con el OpenCode falso.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(MODE === 'prod')(`fase 6: Cowork y Code en la misma carpeta (${MODE})`, () => {
  // Recursos creados en beforeAll (no en la fase de colección) para no dejar carpetas si el describe se filtra u omite.
  const res = {} as { bin: ReturnType<typeof prepareFakeBin>; folder: ReturnType<typeof makeHomeFolder> }
  const env: Record<string, string> = {}
  beforeAll(() => {
    res.bin = prepareFakeBin()
    res.folder = makeHomeFolder()
    Object.assign(env, res.bin.env)
  })
  const app = useApp({ env }) // `env` se lee en su beforeAll, registrado después del anterior
  afterAll(() => {
    res.folder?.cleanup()
    res.bin?.cleanup()
  })
  const folder = { get path() { return res.folder.path } }

  const accessRadios = (a: ReturnType<typeof app>) => a.page.getByRole('radiogroup', { name: 'Modo de acceso' }).getByRole('radio')

  it('5. una sesión de Code ocupada en la misma carpeta NO marca ocupado a Cowork (F6-B1); una de Cowork sí', async () => {
    const a = app()
    const { conn } = await connectCoworkFolder(a, folder.path)
    expect(conn.baseUrl).not.toBe(a.fake.conn.baseUrl) // dos sidecars distintos
    // Con la carpeta lista y nada ocupado, el selector de acceso está habilitado.
    await expect.poll(() => accessRadios(a).first().isDisabled(), { timeout: 15_000 }).toBe(false)

    // Code, misma carpeta, ejecución larga en el sidecar principal.
    await a.fake.script({ steps: [{ type: 'text', text: 'trabajando', delayMs: 60_000 }], match: 'ocupa la carpeta' })
    await openCodeProject(a, folder.path)
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('ocupa la carpeta')
    await box.press('Enter')
    await expect.poll(() => storeState<string | null>(a.page, 'useCode', 'activeSessionID'), { timeout: 15_000 }).toBeTruthy()
    const codeSid = (await storeState<string>(a.page, 'useCode', 'activeSessionID'))!
    await expect.poll(() => storeState<string>(a.page, 'useCode', `runState.${codeSid}`), { timeout: 15_000 }).toBe('busy')
    // El sidecar principal también la ve ocupada en esa carpeta.
    const codeDirs = ((await a.fake.status()).sessions as { id: string; directory: string; status: string }[]).filter((x) => x.directory === folder.path)
    expect(codeDirs.map((x) => x.status)).toContain('busy')

    // Con el enrutado por directorio (default) la sesión de Code ni siquiera entra en useSessions.
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Cowork' }).click()
    expect(Object.keys(await storeState<Record<string, unknown>>(a.page, 'useSessions', 'sessions'))).not.toContain(codeSid)
    await new Promise((r) => setTimeout(r, 500)) // espera acotada (negativa): que el estado de Cowork se repinte
    expect(await accessRadios(a).first().isDisabled()).toBe(false)
    expect(await accessRadios(a).last().isDisabled()).toBe(false)

    // Escenario del bug original (F6-B1 sin enrutado): la sesión de Code SÍ está en useSessions con el origen principal
    // (`sessionSource` sin fijar). El filtro por origen de folderBusy debe ignorarla.
    const busySession = { id: 'ses_code_en_useSessions', directory: folder.path, title: 'Code en useSessions', time: { created: Date.now(), updated: Date.now() } }
    await a.page.evaluate((sess) => {
      const st = (window as any).__onyxE2E.useSessions
      st.setState({ sessions: { ...st.getState().sessions, [sess.id]: sess }, status: { ...st.getState().status, [sess.id]: 'busy' } })
    }, busySession)
    await new Promise((r) => setTimeout(r, 500)) // espera acotada (negativa)
    expect(await accessRadios(a).first().isDisabled()).toBe(false)

    // Control positivo: la misma sesión atribuida al origen de Cowork sí marca ocupada la carpeta.
    await a.page.evaluate(([id, baseUrl]) => {
      const st = (window as any).__onyxE2E.useSessions
      st.setState({ sessionSource: { ...st.getState().sessionSource, [id as string]: baseUrl } })
    }, [busySession.id, conn.baseUrl])
    await expect.poll(() => accessRadios(a).first().isDisabled(), { timeout: 10_000 }).toBe(true)
    // Y al quedar idle vuelve a habilitarse.
    await a.page.evaluate((id) => {
      const st = (window as any).__onyxE2E.useSessions
      st.setState({ status: { ...st.getState().status, [id]: 'idle' } })
    }, busySession.id)
    await expect.poll(() => accessRadios(a).first().isDisabled(), { timeout: 10_000 }).toBe(false)

    // Limpieza: soltar la ejecución larga de Code.
    await fakeApi(a, 'POST', `/session/${codeSid}/abort`, folder.path)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// No automatizable: pasan a la checklist humana de docs/VERIFICACION.md.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('fase 6: checklist humana (no automatizable)', () => {
  it.skip('busy pegado con `kill -STOP` real al sidecar en Chat: el supervisor de salud de main puede reiniciar el proceso y SIGSTOP no permite que el falso quede idle sin un tercero; el caso 2 cubre el mismo defecto (evento de fin perdido + reconexión) con drop-sse + abort', () => {})
  it.skip('`npm install`/build reales en un proyecto con el panel Cambios visible (una sola actualización por ráfaga, cada ≤ 2 s): depende del watcher real de OpenCode y de git; el caso 6 cubre el debounce con eventos sintéticos', () => {})
  it.skip('IME real (teclado japonés/chino): el orden de eventos compositionend/keydown depende del sistema de entrada; el caso 10 cubre isComposing y keyCode 229 con eventos sintéticos', () => {})
  it.skip('Copiar detalle del ErrorBoundary: escribe en el portapapeles del sistema (permiso y foco no disponibles en la ventana headless)', () => {})
  it.skip('aspecto del knob del Toggle de Rutinas (desplazamiento de 2 px): verificación visual, sin snapshot', () => {})
  it.skip('clic en la notificación nativa (restaura/enfoca la ventana y abre la sesión) y respeto del ajuste Sonido: requiere el centro de notificaciones de macOS', () => {})
  it.skip('modo prod (`E2E_MODE=prod`): sin ganchos `__onyxE2E`, los casos de esta fase se omiten; solo aplica humo', () => {})
})
