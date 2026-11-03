// El visor abre solo el entregable principal al terminar el turno aunque el documento no saliera de `write`/`edit`
// (F8-B242: `documentos_crear` o scripts por `bash`). El falso no escribe archivos: el spec deja un .docx real en la carpeta
// de la tarea mientras el turno sigue en curso (como haría `documentos_crear`) y comprueba que, al terminar, el visor lo muestra.
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { connectTasks, makeHomeFolder, prepareFakeBin, waitIdle } from '../lib/lru'
import { shot } from '../lib/shots'
import { storeState } from '../lib/stores'

const DEV = MODE === 'dev'
const SHOTS = process.env.C6_SHOTS_DIR
const SAMPLE = process.env.LAZUNOX_E2E_SAMPLE_DOCX

describe.skipIf(!DEV || !SAMPLE)('Tareas: el visor abre solo el entregable al terminar', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
  })
  const app = useApp({ env: bin.env })

  it('un .docx que no vino de write/edit se abre en el visor al terminar el turno', async () => {
    const a = app()
    const { page } = a
    const { fake } = await connectTasks(a, folder.path)
    await fake.script({
      match: 'DOCUMENTO',
      title: 'Documento listo',
      steps: [
        { type: 'text', text: 'Creo el informe.' },
        { type: 'delay', ms: 6_000 },
        { type: 'text', text: ' Listo.' }
      ]
    })
    await page
      .getByRole('button', { name: /^Nueva tarea/ })
      .first()
      .click()
    await page.getByPlaceholder('Describe la tarea que quieres delegar…').fill('DOCUMENTO haz un informe')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await page.getByText('Creo el informe.', { exact: false }).first().waitFor({ timeout: 30_000 })
    const id = (await storeState<string | null>(page, 'useTasks', 'activeTaskId')) as string
    // Como `documentos_crear`: el archivo aparece en la carpeta durante el turno, sin un evento write/edit con ruta.
    copyFileSync(SAMPLE!, join(folder.path, 'informe.docx'))
    expect(await storeState(page, 'useTasks', 'viewerRequest')).toBeNull()

    await waitIdle(page, id, 60_000)
    await expect
      .poll(async () => ((await storeState(page, 'useTasks', 'viewerRequest')) as { path?: string; auto?: boolean } | null)?.path ?? '', {
        timeout: 15_000,
        message: 'el visor se pide solo'
      })
      .toMatch(/informe\.docx$/)
    expect(((await storeState(page, 'useTasks', 'viewerRequest')) as { auto?: boolean }).auto).toBe(true)
    await page
      .getByRole('button', { name: /Documento|Document/ })
      .first()
      .waitFor({ timeout: 10_000 })
    await shot(a, SHOTS, 'visor-auto-abre')
  }, 120_000)
})
