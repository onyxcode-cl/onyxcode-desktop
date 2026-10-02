// Calidad T5 (F8-B33): accesibilidad. axe-core sin violaciones serias en Chat, Code y Tareas con datos falsos, y la región
// `role="log"` acotada (solo «Respuesta terminada» y errores). Informe completo con T5_AXE_REPORT=/ruta.json; capturas con T5_SHOTS_DIR.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendFileSync, rmSync } from 'node:fs'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { scriptFor } from '../lib/lru'
import { shot } from '../lib/shots'
import { expectVisible } from '../lib/wait'
import { runAxe, SERIOUS, summarize, type AxeViolation } from '../lib/axe'
import { connectTasksFolder, makeGitRepo, makeHomeFolder, newChatAndSend, openCodeProject, prepareFakeBin } from '../lib/fase6'
import { IS_WIN } from '../lib/proc'

const SHOTS = process.env.T5_SHOTS_DIR
const REPORT = process.env.T5_AXE_REPORT

function report(view: string, v: Record<'light' | 'dark', AxeViolation[]>): void {
  if (REPORT) appendFileSync(REPORT, JSON.stringify({ view, violations: v }) + '\n')
}

describe.skipIf(MODE === 'prod')(`calidad T5 (${MODE})`, () => {
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
  afterAll(() => {
    res.folder?.cleanup()
    res.bin?.cleanup()
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  async function expectClean(view: string): Promise<void> {
    const v = await runAxe(app().page)
    report(view, v)
    const serious = [...v.light, ...v.dark].filter((x) => x.impact && SERIOUS.has(x.impact))
    expect(serious, summarize(v)).toEqual([])
  }

  it('Chat: respuesta terminada se anuncia una vez, sin deltas, y axe no ve violaciones serias', async () => {
    const a = app()
    await newChatAndSend(a, 'hola accesible')
    await expectVisible(a.page.getByText('Respuesta simulada: hola accesible'), 30_000)
    const log = a.page.getByRole('log', { name: 'Avisos de la conversación' })
    await expect.poll(() => log.textContent(), { timeout: 10_000 }).toBe('Respuesta terminada')
    // La transcripción no es una región viva: solo `role="log"` (acotado) y el «Pensando» puntual.
    expect(await a.page.locator('[aria-live]:not([role="status"]):not([role="log"])').count()).toBe(0)
    await shot(a, SHOTS, 'chat-a11y')
    await expectClean('chat')
  })

  it('Chat: un 429 se anuncia como error y axe sigue limpio', async () => {
    const a = app()
    await newChatAndSend(a, 'falla con cuota', {
      steps: [{ type: 'error', statusCode: 429, message: 'Too many requests' }],
      match: 'falla con cuota'
    })
    await expectVisible(a.page.getByRole('button', { name: 'Reintentar', exact: true }).first(), 20_000)
    const log = a.page.getByRole('log', { name: 'Avisos de la conversación' })
    await expect.poll(() => log.textContent(), { timeout: 10_000 }).toMatch(/^Error: /)
    await shot(a, SHOTS, 'chat-error-a11y')
    await expectClean('chat-error')
  })

  it('Code: compositor como combobox y axe sin violaciones serias', async () => {
    const a = app()
    await openCodeProject(a, repo)
    const box = a.page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    expect(await box.getAttribute('aria-expanded')).toBe('false')
    await box.fill('/')
    const opt = a.page.getByRole('option').first()
    await expectVisible(opt, 15_000)
    expect(await box.getAttribute('aria-expanded')).toBe('true')
    const active = await box.getAttribute('aria-activedescendant')
    expect(active).toMatch(/^code-composer-opt-\d+$/)
    expect(await a.page.locator(`#${active}`).getAttribute('aria-selected')).toBe('true')
    await box.fill('')
    await box.fill('pregunta de code')
    await box.press('Enter')
    await expectVisible(a.page.getByText('Respuesta simulada: pregunta de code'), 30_000)
    await expect
      .poll(() => a.page.getByRole('log', { name: 'Avisos de la conversación' }).textContent(), { timeout: 10_000 })
      .toBe('Respuesta terminada')
    await a.page.getByText('pregunta de code', { exact: true }).hover()
    // Botones solo-icono con nombre accesible.
    for (const name of ['Copiar', 'Editar y reintentar']) await expectVisible(a.page.getByRole('button', { name }).first())
    expect(await a.page.getByRole('button', { name: /Bifurcar la sesión/ }).count()).toBeGreaterThan(0)
    await shot(a, SHOTS, 'code-a11y')
    await expectClean('code')
  })

  // Windows v1: sin modo Tareas.
  it.skipIf(IS_WIN)('Tareas: axe sin violaciones serias con una tarea falsa', async () => {
    const a = app()
    const { fake } = await connectTasksFolder(a, res.folder.path)
    await scriptFor(fake, 'tarea accesible', 'Respuesta simulada: tarea accesible')
    const box = a.page.getByPlaceholder('Describe la tarea que quieres delegar…')
    await box.fill('tarea accesible')
    await a.page.getByRole('button', { name: 'Enviar' }).first().click()
    await expectVisible(a.page.getByText('Respuesta simulada: tarea accesible'), 30_000)
    await expect
      .poll(() => a.page.getByRole('log', { name: 'Avisos de la conversación' }).textContent(), { timeout: 10_000 })
      .toBe('Respuesta terminada')
    await shot(a, SHOTS, 'tareas-a11y')
    await expectClean('tareas')
  })
})
