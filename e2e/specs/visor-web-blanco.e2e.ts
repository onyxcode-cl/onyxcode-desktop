// Verifica la regresión de ArtCraft: un drop despachado sin dibujo debe cambiar al visor clásico y preservar evidencia.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { connectTasks, makeHomeFolder, prepareFakeBin, waitIdle } from '../lib/lru'
import { storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SAMPLE = join(process.cwd(), 'src/main/documents/fixtures-review/bueno.pptx')
const FAKE_WEB = `<!doctype html><meta charset="utf-8"><style>html,body,canvas{margin:0;width:100%;height:100%;background:#fff}</style><canvas width="1200" height="800"></canvas><script>window.wasmBindings={};</script>`

describe.skipIf(!DEV)('visor web ArtCraft en blanco', () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  afterAll(() => {
    bin.cleanup()
    folder.cleanup()
  })
  const app = useApp({ env: bin.env })

  it('usa el visor clásico y guarda el .pptx y la captura tras dos verificaciones vacías', async () => {
    const a = app()
    const { page, electronApp } = a
    const userData = await electronApp.evaluate(({ app: electron }) => electron.getPath('userData'))
    const pin = JSON.parse(readFileSync(join(process.cwd(), 'resources/craft/pin.json'), 'utf8')) as {
      version: string
      web: { deckcraft: { sha256: string } }
    }
    const webDir = join(userData, 'bin', `craft-${pin.version}`, 'web', 'deckcraft')
    mkdirSync(webDir, { recursive: true })
    writeFileSync(join(webDir, 'index.html'), FAKE_WEB)
    writeFileSync(
      join(userData, 'bin', `craft-${pin.version}`, 'installed-web-deckcraft.json'),
      JSON.stringify({ sha256: pin.web.deckcraft.sha256, web: { files: 1, bytes: Buffer.byteLength(FAKE_WEB) } })
    )

    const { fake } = await connectTasks(a, folder.path)
    await fake.script({
      match: 'PRESENTACION',
      title: 'presentación lista',
      steps: [
        { type: 'text', text: 'Preparando la presentación.' },
        { type: 'delay', ms: 5000 },
        { type: 'text', text: ' Lista.' }
      ]
    })
    const file = join(folder.path, 'comite.pptx')
    await page
      .getByRole('button', { name: /^Nueva tarea/ })
      .first()
      .click()
    await page.getByPlaceholder('Describe la tarea que quieres delegar…').fill('PRESENTACION abre comite.pptx')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await page.getByText('Preparando la presentación.', { exact: false }).waitFor({ timeout: 30_000 })
    const id = (await storeState<string | null>(page, 'useTasks', 'activeTaskId')) as string
    writeFileSync(file, readFileSync(SAMPLE))
    await waitIdle(page, id, 60_000)
    await page
      .getByRole('button', { name: /Documento|comite/ })
      .first()
      .waitFor({ timeout: 20_000 })

    await expectVisible(page.getByText(/visor de respaldo/i), 20_000)
    const evidence = join(userData, 'diagnostico', 'visor-en-blanco')
    await expect
      .poll(
        () => {
          try {
            return readFileSync(join(userData, 'logs', 'problemas.log'), 'utf8').includes('casi uniforme')
          } catch {
            return false
          }
        },
        { timeout: 10_000 }
      )
      .toBe(true)
    const screenshot = join(evidence, readdirSync(evidence).find((name) => name.endsWith('.png')) ?? '')
    expect(statSync(screenshot).size).toBeGreaterThan(100)
    expect(readdirSync(evidence).some((name) => name.endsWith('.pptx'))).toBe(true)
    expect(readdirSync(evidence).some((name) => name.endsWith('.log'))).toBe(true)
  }, 120_000)
})
