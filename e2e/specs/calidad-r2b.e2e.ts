// R2-B: adjuntos en Chat (partes `file` con URL `data:`) y huecos de prueba de T4 (más de 200 sesiones en Code y
// Tareas, y la búsqueda ⌘K de Code). Capturas con R2B_SHOTS_DIR (claro/oscuro, 820/1280 px).
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { consumeErrors, fakeApi, makeGitRepo, openCodeProject } from '../lib/fase6'
import { connectTasks, makeHomeFolder, prepareFakeBin } from '../lib/lru'
import { shot } from '../lib/shots'
import { storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'
import { IS_WIN } from '../lib/proc'
import { rmSync } from 'node:fs'

const DEV = MODE === 'dev'
const SHOTS = process.env.R2B_SHOTS_DIR
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const N = 250

type Part = { type: string; mime?: string; filename?: string; url?: string }
/** Títulos distintos visibles (la sesión activa puede repetirse en la cabecera). */
const uniqueTitles = async (loc: import('playwright-core').Locator): Promise<number> => new Set(await loc.allTextContents()).size
const promptParts = (r: { body: unknown }): Part[] => (r.body as { parts: Part[] }).parts

describe.skipIf(MODE === 'prod')(`R2-B: adjuntos en Chat (${MODE})`, () => {
  const app = useApp()
  // El corte de red provocado a propósito aparece como error de consola del navegador.
  afterEach(() => {
    consumeErrors(app(), /ERR_EMPTY_RESPONSE|ERR_CONNECTION/)
  })

  it('una imagen sin texto sale como UNA parte file data: y se ve en el mensaje; sin file:// ni herramientas nuevas', async () => {
    const a = app()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await a.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const input = a.page.getByTestId('chat-file-input')
    await input.setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG })
    await expectVisible(a.page.locator('img[alt="captura.png"]'), 5_000)
    await shot(a, SHOTS, 'chat-adjunto-compositor')
    // Quitar y volver a adjuntar.
    await a.page.getByRole('button', { name: 'Quitar captura.png' }).click()
    expect(await a.page.locator('img[alt="captura.png"]').count()).toBe(0)
    await input.setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG })
    await expectVisible(a.page.locator('img[alt="captura.png"]'), 5_000)
    await a.page.getByRole('button', { name: 'Enviar' }).click()
    const req = await a.fake.waitForRequest((r) => r.method === 'POST' && /\/session\/[^/]+\/prompt_async$/.test(r.path))
    const parts = promptParts(req)
    expect(parts.map((p) => p.type)).toEqual(['file'])
    expect(parts[0].mime).toBe('image/png')
    expect(parts[0].url).toMatch(/^data:image\/png;base64,/)
    // Un único `img` (el del mensaje): el compositor se vació.
    await expect.poll(() => a.page.locator('img[alt="captura.png"]').count(), { timeout: 15_000 }).toBe(1)
    await shot(a, SHOTS, 'chat-adjunto-mensaje')
  })

  it('archivo no admitido o demasiado grande: aviso y no se adjunta', async () => {
    const a = app()
    await a.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const input = a.page.getByTestId('chat-file-input')
    await input.setInputFiles({ name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') })
    await expectVisible(a.page.getByRole('alert').filter({ hasText: 'virus.exe' }), 5_000)
    await input.setInputFiles({ name: 'enorme.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 10) })
    await expectVisible(a.page.getByRole('alert').filter({ hasText: 'enorme.png' }), 5_000)
    expect(await a.page.locator('img[alt="enorme.png"]').count()).toBe(0)
    await shot(a, SHOTS, 'chat-adjunto-rechazado')
  })

  it('red caída: el texto y el adjunto vuelven al compositor; con la red de vuelta se envía y queda un solo mensaje', async () => {
    const a = app()
    await a.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const box = a.page.getByPlaceholder('Escribe un mensaje…')
    await a.fake.set({ failPrompt: -1 })
    await box.fill('qué es esto')
    await a.page.getByTestId('chat-file-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG })
    await a.page.getByRole('button', { name: 'Enviar' }).click()
    await expect.poll(() => box.inputValue(), { timeout: 4_000 }).toBe('qué es esto')
    await expectVisible(a.page.locator('img[alt="foto.png"]'), 4_000)
    await a.fake.set({ failPrompt: 0 })
    await a.page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(a.page.getByText('Respuesta simulada: qué es esto'), 30_000)
    const sid = (await storeState<string>(a.page, 'useChat', 'activeSessionId'))!
    const users = await storeState<{ info: { role: string } }[]>(a.page, 'useSessions', `messages.${sid}`)
    expect(users.filter((m) => m.info.role === 'user')).toHaveLength(1)
  })
})

async function ghostSessions(post: (title: string) => Promise<unknown>, prefix: string): Promise<void> {
  for (let i = 0; i < N; i += 25)
    await Promise.all(Array.from({ length: 25 }, (_, k) => post(`${prefix}-${String(i + k).padStart(3, '0')}`)))
}

describe.skipIf(!DEV)('R2-B: más de 200 sesiones en Code', () => {
  const app = useApp()
  let dir = ''
  afterAll(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('«Cargar más» muestra todas y ⌘K encuentra las de más allá de 200', async () => {
    const a = app()
    dir = makeGitRepo()
    await ghostSessions((title) => fakeApi(a, 'POST', '/session', dir, { title }), 'code-fantasma')
    await openCodeProject(a, dir)
    const rows = a.page.getByText(/^code-fantasma-\d{3}$/)
    await expect.poll(() => uniqueTitles(rows), { timeout: 20_000 }).toBe(200)
    const more = a.page.getByRole('button', { name: 'Cargar más' })
    await expectVisible(more)
    await more.scrollIntoViewIfNeeded()
    await shot(a, SHOTS, 'code-cargar-mas')
    await more.click()
    await expect.poll(() => uniqueTitles(rows), { timeout: 20_000 }).toBe(N)
    expect(await more.count()).toBe(0)
  })

  it('la búsqueda ⌘K carga todas por sí sola', async () => {
    const a = app()
    await a.page.reload()
    await openCodeProject(a, dir)
    const rows = a.page.getByText(/^code-fantasma-\d{3}$/)
    await expect.poll(() => uniqueTitles(rows), { timeout: 20_000 }).toBe(200)
    expect(await a.page.getByText('code-fantasma-000', { exact: true }).count()).toBe(0)
    await a.page.keyboard.press('Control+k')
    const dialog = a.page.getByRole('dialog', { name: 'Cambiar de sesión' })
    await expectVisible(dialog)
    await dialog.getByPlaceholder('Buscar sesión por título…').fill('fantasma-000')
    await expectVisible(dialog.getByText('code-fantasma-000', { exact: true }), 20_000)
    await shot(a, SHOTS, 'code-quickswitcher-busqueda')
  })
})

// Windows v1: sin modo Tareas.
describe.skipIf(!DEV || IS_WIN)('R2-B: más de 200 tareas', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
  })
  const app = useApp({ env: bin.env })

  it('«Cargar más» muestra todas y el filtro encuentra las de más allá de 200', async () => {
    const a = app()
    const { conn } = await connectTasks(a, folder.path)
    const post = async (title: string): Promise<unknown> => {
      const res = await fetch(`${conn.baseUrl}/session?directory=${encodeURIComponent(folder.path)}`, {
        method: 'POST',
        headers: { authorization: conn.authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ title })
      })
      return res.json().catch(() => null)
    }
    await ghostSessions(post, 'tarea-fantasma')
    await a.page.reload()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Tareas' }).click()
    const rows = a.page.getByText(/^tarea-fantasma-\d{3}$/)
    await expect.poll(() => uniqueTitles(rows), { timeout: 30_000 }).toBe(200)
    const more = a.page.getByRole('button', { name: 'Cargar más' })
    await expectVisible(more)
    await more.scrollIntoViewIfNeeded()
    await shot(a, SHOTS, 'tareas-cargar-mas')
    await more.click()
    await expect.poll(() => uniqueTitles(rows), { timeout: 30_000 }).toBe(N)
    expect(await more.count()).toBe(0)
  })

  it('el filtro de Tareas carga todas por sí solo', async () => {
    const a = app()
    await a.page.reload()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Tareas' }).click()
    const rows = a.page.getByText(/^tarea-fantasma-\d{3}$/)
    await expect.poll(() => uniqueTitles(rows), { timeout: 30_000 }).toBe(200)
    expect(await a.page.getByText('tarea-fantasma-000', { exact: true }).count()).toBe(0)
    await a.page.getByRole('searchbox', { name: 'Buscar tareas' }).fill('fantasma-000')
    await expectVisible(a.page.getByText('tarea-fantasma-000', { exact: true }), 30_000)
  })
})
