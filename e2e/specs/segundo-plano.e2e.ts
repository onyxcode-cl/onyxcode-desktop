// P6 (1.8.9): avisos del motor en lenguaje llano. Con el motor falso:
//  - un comando que sigue en segundo plano (metadata.running + shellId) lo dice en su paso, en Code y en Tareas;
//  - al Detener, el botón avisa que también corta ese comando.
// Capturas con P6_SHOTS_DIR.
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { makeGitRepo, openCodeProject } from '../lib/fase6'
import { connectTasks, makeHomeFolder, newTaskVia, prepareFakeBin } from '../lib/lru'
import { shot } from '../lib/shots'
import { expectVisible } from '../lib/wait'
import { IS_WIN } from '../lib/proc'

const DEV = MODE === 'dev'
const SHOTS = process.env.P6_SHOTS_DIR
// P6_ANTES=1: solo captura cómo se veía antes del cambio (sin comprobar los avisos nuevos).
const ANTES = process.env.P6_ANTES === '1'

const bgSteps = (finalText: string, delayMs = 0) => [
  {
    type: 'tool',
    tool: 'bash',
    input: { command: 'npm run dev', description: 'Servidor de pruebas' },
    output: 'Servidor listo en el puerto 5173',
    metadata: { output: 'Servidor listo en el puerto 5173', exit: null, running: true, shellId: 'sh_demo_1' }
  },
  { type: 'text', text: finalText, delayMs }
]

describe.skipIf(!DEV)('P6: comando en segundo plano en Code', () => {
  const app = useApp()
  it('el paso dice «Sigue en segundo plano» y Detener avisa', async () => {
    const a = app()
    const dir = makeGitRepo()
    await openCodeProject(a, dir)
    await a.fake.script({ match: 'servidor en segundo plano', steps: bgSteps('Dejé el servidor corriendo', 6000) })
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('servidor en segundo plano')
    await box.press('Enter')
    if (ANTES) {
      await expectVisible(a.page.getByText('npm run dev').first(), 60_000)
      await shot(a, SHOTS, 'code-segundo-plano', [1280])
      return
    }
    await expectVisible(a.page.getByText('Sigue en segundo plano'), 60_000)
    // Mientras la IA sigue trabajando, el botón Detener avisa que también corta el comando.
    const stop = a.page.locator('button[title*="también corta"]').first()
    await expectVisible(stop)
    expect(await stop.getAttribute('title')).toContain('1 comando')
    await shot(a, SHOTS, 'code-segundo-plano', [1280])
    await expectVisible(a.page.getByText('Dejé el servidor corriendo'), 60_000)
  })
})

describe.skipIf(!DEV || IS_WIN)('P6: comando en segundo plano en Tareas', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
  })
  const app = useApp({ env: bin.env })
  it('el paso de la tarea dice que sigue en segundo plano', async () => {
    const a = app()
    const { fake } = await connectTasks(a, folder.path)
    await fake.script({ match: 'servidor tarea', title: 'Servidor', steps: bgSteps('Servidor en marcha') })
    await newTaskVia(a.page, 'servidor tarea', 'Servidor en marcha')
    if (ANTES) {
      await expectVisible(a.page.getByText('Servidor en marcha'), 60_000)
      await shot(a, SHOTS, 'tareas-segundo-plano', [1280])
      return
    }
    await a.page.getByRole('button', { name: /paso/i }).first().click().catch(() => undefined)
    await expectVisible(a.page.getByText(/sigue en segundo plano/i).first())
    await shot(a, SHOTS, 'tareas-segundo-plano', [1280])
  })
})
