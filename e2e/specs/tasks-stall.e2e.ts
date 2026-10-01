// Aviso «Sin actividad desde hace N min» (F8-B30): una tarea atascada (el falso espera sin emitir nada) muestra el
// aviso al cumplirse el umbral (1 min, el mínimo configurable) y NO se detiene sola; al terminar el aviso desaparece.
// Capturas con C6_SHOTS_DIR.
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { connectTasks, makeHomeFolder, prepareFakeBin, waitIdle } from '../lib/lru'
import { shot } from '../lib/shots'
import { storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.C6_SHOTS_DIR

describe.skipIf(!DEV)('Tareas: aviso de inactividad', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
  })
  const app = useApp({ env: bin.env })

  it('avisa al cumplirse el umbral sin detener la tarea, y el aviso se va al terminar', async () => {
    const a = app()
    const { page } = a
    const { fake } = await connectTasks(a, folder.path)
    await page.evaluate(() => (window as any).api.tasks.invoke('tasks:prefs:set', { stallWarnMinutes: 1 }))
    await fake.script({
      match: 'ATASCADA',
      title: 'Tarea atascada',
      steps: [
        { type: 'text', text: 'Empiezo la tarea.' },
        { type: 'delay', ms: 85_000 },
        { type: 'text', text: ' Fin.' }
      ]
    })
    await page
      .getByRole('button', { name: /^Nueva tarea/ })
      .first()
      .click()
    await page.getByPlaceholder('Describe la tarea que quieres delegar…').fill('ATASCADA haz algo')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(page.getByText('Empiezo la tarea.', { exact: false }).first(), 30_000)
    const id = (await storeState<string | null>(page, 'useTasks', 'activeTaskId')) as string

    // Antes del umbral no hay aviso.
    await page.waitForTimeout(8_000)
    expect(await page.getByText(/Sin actividad desde hace/).count()).toBe(0)

    const notice = page.getByRole('status').filter({ hasText: /Sin actividad desde hace \d+ min/ })
    await expectVisible(notice, 75_000)
    // Sigue en curso: el aviso no cortó nada.
    expect(await page.evaluate((sid) => (window as any).__onyxE2E.useSessions.getState().status[sid] ?? 'idle', id)).not.toBe('idle')
    await expectVisible(page.getByText('La tarea sigue en curso', { exact: false }))
    await shot(a, SHOTS, 'stall-notice')

    // Al terminar, el aviso desaparece.
    await waitIdle(page, id, 60_000)
    await expect.poll(() => notice.count(), { timeout: 15_000, message: 'el aviso desaparece' }).toBe(0)
  }, 200_000)
})
