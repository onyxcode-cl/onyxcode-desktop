// Calidad T2 (errores con salida): «Reintentar» sin duplicar el mensaje, «Editar y reintentar» y «Compactar» con el OpenCode falso.
// Capturas: CALIDAD_SHOTS_DIR=/ruta.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { shot } from '../lib/shots'
import { storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'
import { connectTasksFolder, makeGitRepo, makeHomeFolder, newChatAndSend, openCodeProject, prepareFakeBin } from '../lib/fase6'
import { IS_WIN } from '../lib/proc'

const SHOTS = process.env.CALIDAD_SHOTS_DIR

describe.skipIf(MODE === 'prod')(`calidad T2 (${MODE})`, () => {
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
  afterAll(async () => {
    // Los afterAll corren en orden inverso: se para la app antes de borrar (Windows: EBUSY si un proceso aún tiene la carpeta como cwd).
    await app().stop().catch(() => undefined)
    res.folder?.cleanup()
    res.bin?.cleanup()
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  })

  it('Chat: un 429 muestra «Reintentar» y al pulsarlo queda UN solo mensaje de usuario', async () => {
    const a = app()
    await newChatAndSend(a, 'haz algo con cuota', { steps: [{ type: 'error', statusCode: 429, message: 'Too many requests' }], match: 'haz algo con cuota' })
    const retry = a.page.getByRole('button', { name: 'Reintentar', exact: true })
    await expectVisible(retry.first(), 20_000)
    await shot(a, SHOTS, 'chat-error-reintentar')
    await retry.first().click()
    await expectVisible(a.page.getByText('Respuesta simulada: haz algo con cuota'), 30_000)
    const sid = (await storeState<string>(a.page, 'useChat', 'activeSessionId'))!
    const msgs = (await storeState<{ info: { role: string } }[]>(a.page, 'useSessions', `messages.${sid}`)) ?? []
    expect(msgs.filter((m) => m.info.role === 'user')).toHaveLength(1)
    expect(await a.page.getByText('haz algo con cuota', { exact: true }).count()).toBe(1)
  })

  it('Chat: editar un mensaje antiguo oculta los posteriores y envía el editado', async () => {
    const a = app()
    await newChatAndSend(a, 'pregunta uno')
    await expectVisible(a.page.getByText('Respuesta simulada: pregunta uno'), 30_000)
    const box = a.page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('pregunta dos')
    await box.press('Enter')
    await expectVisible(a.page.getByText('Respuesta simulada: pregunta dos'), 30_000)
    await a.page.getByText('pregunta uno', { exact: true }).hover()
    await a.page.getByRole('button', { name: 'Editar y reintentar' }).first().click()
    const editor = a.page.getByLabel('Editar el mensaje')
    await editor.fill('pregunta uno editada')
    await shot(a, SHOTS, 'chat-editar')
    await a.page.locator('textarea[aria-label="Editar el mensaje"] ~ div').getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expectVisible(a.page.getByText('Respuesta simulada: pregunta uno editada'), 30_000)
    expect(await a.page.getByText('pregunta dos').count()).toBe(0)
    expect(await a.page.getByText('Respuesta simulada: pregunta uno', { exact: true }).count()).toBe(0)
  })

  it('Chat: el error de contexto ofrece «Compactar» y resume la conversación', async () => {
    const a = app()
    await newChatAndSend(a, 'texto enorme', { steps: [{ type: 'error', name: 'ContextOverflowError', message: 'too big' }], match: 'texto enorme' })
    const compact = a.page.getByRole('button', { name: 'Compactar conversación' })
    await expectVisible(compact.first(), 20_000)
    await shot(a, SHOTS, 'chat-error-contexto')
    await compact.first().click()
    await a.fake.waitForRequest((r) => r.method === 'POST' && /\/session\/[^/]+\/summarize$/.test(r.path))
  })

  it('Code: «Editar y reintentar» reemplaza el mensaje y descarta lo posterior', async () => {
    const a = app()
    await openCodeProject(a, repo)
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('primer encargo')
    await box.press('Enter')
    await expectVisible(a.page.getByText('Respuesta simulada: primer encargo'), 30_000)
    await a.page.getByText('primer encargo', { exact: true }).hover()
    await a.page.getByRole('button', { name: 'Editar y reintentar' }).first().click()
    await a.page.getByLabel('Editar el mensaje').fill('encargo corregido')
    await shot(a, SHOTS, 'code-editar')
    await a.page.getByRole('button', { name: 'Reintentar', exact: true }).click()
    // Confirmación (deshace los cambios de archivos desde ese mensaje).
    await a.page.getByRole('alertdialog').getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expectVisible(a.page.getByText('Respuesta simulada: encargo corregido'), 30_000)
    expect(await a.page.getByText('primer encargo').count()).toBe(0)
  })

  // Windows v1: sin modo Tareas.
  it.skipIf(IS_WIN)('Tareas: el error de contexto ofrece «Compactar»', async () => {
    const a = app()
    const { fake } = await connectTasksFolder(a, res.folder.path)
    await fake.script({ steps: [{ type: 'error', name: 'ContextOverflowError', message: 'too big' }], match: 'tarea enorme' })
    const box = a.page.getByPlaceholder('Describe la tarea que quieres delegar…')
    await box.fill('tarea enorme')
    await a.page.getByRole('button', { name: 'Enviar' }).first().click()
    const compact = a.page.getByRole('button', { name: 'Compactar conversación' })
    await expectVisible(compact.first(), 30_000)
    await shot(a, SHOTS, 'tareas-error-contexto')
    await compact.first().click()
    await fake.waitForRequest((r) => r.method === 'POST' && /\/session\/[^/]+\/summarize$/.test(r.path))
  })
})
