// Calidad T1 (no perder lo que escribe el usuario), una prueba por modo con el OpenCode falso y la red «caída»
// (`/__e2e/set { failPrompt: -1 }` corta la conexión de prompt_async; Chromium reintenta una vez sobre un socket reutilizado, así que se corta siempre hasta `failPrompt: 0`). Capturas: CALIDAD_SHOTS_DIR=/ruta.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { shot } from '../lib/shots'
import { storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'
import { connectTasksFolder, consumeErrors, makeGitRepo, makeHomeFolder, openCodeProject, prepareFakeBin } from '../lib/fase6'

const SHOTS = process.env.CALIDAD_SHOTS_DIR
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

describe.skipIf(MODE === 'prod')(`calidad T1 (${MODE})`, () => {
  const res = {} as { bin: ReturnType<typeof prepareFakeBin>; folder: ReturnType<typeof makeHomeFolder> }
  const env: Record<string, string> = {}
  let repo = ''
  beforeAll(() => {
    res.bin = prepareFakeBin()
    res.folder = makeHomeFolder()
    repo = makeGitRepo()
    Object.assign(env, res.bin.env)
  })
  const app = useApp({ env })
  // Los cortes de red provocados a propósito aparecen como errores de consola del navegador.
  afterEach(() => {
    consumeErrors(app(), /ERR_EMPTY_RESPONSE|ERR_CONNECTION/)
  })
  afterAll(() => {
    res.folder?.cleanup()
    res.bin?.cleanup()
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  it('Chat: con la red caída el texto sigue en el compositor, el botón vuelve a «Enviar» y se puede reintentar', async () => {
    const a = app()
    await a.fake.set({ failPrompt: -1 })
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await a.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const box = a.page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('hola con red caída')
    await a.page.getByRole('button', { name: 'Enviar' }).click()
    // H3: el borrador vuelve y H4: la sesión no queda ocupada (botón «Enviar», no «Detener»).
    await expect.poll(() => box.inputValue(), { timeout: 3_000 }).toBe('hola con red caída')
    await expectVisible(a.page.getByRole('button', { name: 'Enviar' }), 1_500)
    expect(await a.page.getByRole('button', { name: 'Detener' }).count()).toBe(0)
    const sid = await storeState<string | null>(a.page, 'useChat', 'activeSessionId')
    if (sid) expect(await storeState(a.page, 'useSessions', `status.${sid}`)).toBe('idle')
    await shot(a, SHOTS, 'chat-red-caida')
    // Reintento con la red de vuelta.
    await a.fake.set({ failPrompt: 0 })
    await a.page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(a.page.getByText('Respuesta simulada: hola con red caída'), 30_000)
    expect(await box.inputValue()).toBe('')
  })

  it('Chat: Esc detiene la respuesta en curso', async () => {
    const a = app()
    await a.fake.script({ steps: [{ type: 'text', text: 'larga', delayMs: 60_000 }], match: 'respuesta larga' })
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await a.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const box = a.page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('respuesta larga')
    await box.press('Enter')
    await expectVisible(a.page.getByRole('button', { name: 'Detener' }), 15_000)
    await box.press('Escape')
    await expectVisible(a.page.getByRole('button', { name: 'Enviar' }), 15_000)
  })

  it('Code: una imagen sin texto se envía como mensaje de usuario con la imagen; con la red caída el borrador vuelve', async () => {
    const a = app()
    await openCodeProject(a, repo)
    const input = a.page.locator('input[type="file"]').first()
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)

    // Red caída: texto y adjunto siguen en el compositor.
    await a.fake.set({ failPrompt: -1 })
    await box.fill('revisa esta captura')
    await input.setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG })
    await expectVisible(a.page.locator('img[alt="captura.png"]'), 5_000)
    await box.press('Enter')
    await expect.poll(() => box.inputValue(), { timeout: 3_000 }).toBe('revisa esta captura')
    await expectVisible(a.page.locator('img[alt="captura.png"]'), 3_000)
    const sid = (await storeState<string>(a.page, 'useCode', 'activeSessionID'))!
    await expect.poll(() => storeState<string>(a.page, 'useCode', `runState.${sid}`), { timeout: 3_000 }).toBe('idle')
    await shot(a, SHOTS, 'code-red-caida')

    // Solo imagen, sin texto (red de vuelta).
    await a.fake.set({ failPrompt: 0 })
    await box.fill('')
    await box.press('Enter')
    const req = await a.fake.waitForRequest(
      (r) =>
        r.method === 'POST' &&
        /\/session\/[^/]+\/prompt_async$/.test(r.path) &&
        JSON.stringify(r.body).includes('captura.png') &&
        !JSON.stringify(r.body).includes('revisa esta captura')
    )
    const parts = (req.body as { parts: { type: string; mime?: string }[] }).parts
    expect(parts.map((p) => p.type)).toEqual(['file'])
    // El adjunto sale del compositor y queda UNA imagen: la del mensaje de usuario.
    await expect.poll(() => a.page.locator('img[alt="captura.png"]').count(), { timeout: 15_000 }).toBe(1)
    await shot(a, SHOTS, 'code-imagen-sin-texto')
  })

  it('Tareas: con la red caída el borrador sigue en el compositor', async () => {
    const a = app()
    const { fake } = await connectTasksFolder(a, res.folder.path)
    await fake.set({ failPrompt: -1 })
    const box = a.page.getByPlaceholder('Describe la tarea que quieres delegar…')
    await box.fill('tarea con red caída')
    await a.page.getByRole('button', { name: 'Enviar' }).first().click()
    await expect.poll(() => box.inputValue(), { timeout: 5_000 }).toBe('tarea con red caída')
    await expectVisible(a.page.getByRole('button', { name: 'Enviar' }).first(), 3_000)
    await shot(a, SHOTS, 'tareas-red-caida')
    await fake.set({ failPrompt: 0 })
  })
})
