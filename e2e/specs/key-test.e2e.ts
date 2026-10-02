// «Probar clave» contra la app real, el OpenCode falso y un «proveedor» local (lib/probe-server.ts, vía
// ONYXCODE_E2E_KEY_PROBE_BASE): guardar una clave la prueba sola; el botón «Probar» muestra cada resultado (válida,
// inválida, límite, proveedor caído, sin contacto); «Cambiar clave» sustituye la clave; el proveedor recibió la clave y
// ni el DOM ni la salida de Electron la contienen. Capturas con DIAG_SHOTS_DIR.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { receivedKey, startProbeServer } from '../lib/probe-server'
import { shot } from '../lib/shots'
import { expectCount, expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.DIAG_SHOTS_DIR
const KEYS = {
  valid: 'sk-e2e-valid-0123456789abcdef',
  invalid: 'sk-e2e-invalid-0123456789abcdef',
  limit: 'sk-e2e-limit-0123456789abcdef',
  down: 'sk-e2e-down-0123456789abcdef',
  renewed: 'sk-e2e-valid-renovada-9876543210'
}

const probe = await startProbeServer()
afterAll(() => probe.close().catch(() => undefined))

async function openModels(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,')
  const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
  await expectVisible(nav)
  await nav.getByRole('button', { name: 'Modelos', exact: true }).click()
  await expectVisible(page.getByRole('heading', { name: 'Modelos' }))
}

/** Estado (`data-key-test`) del primer aviso de resultado visible. */
const noticeStatus = (page: Page): Promise<string | null> => page.locator('[data-key-test]').first().getAttribute('data-key-test')

describe.skipIf(!DEV)('Probar clave', () => {
  const app = useApp({ env: { ONYXCODE_E2E_KEY_PROBE_BASE: probe.base } })
  const output: string[] = []
  const authFile = (): string => join(app().userData, 'opencode-data', 'opencode', 'auth.json')

  /** Cambia la clave guardada de OpenAI directamente en auth.json (main la lee en cada prueba). */
  const seedKey = (key: string): void => {
    const cur = JSON.parse(readFileSync(authFile(), 'utf8')) as Record<string, unknown>
    cur.openai = { type: 'api', key }
    writeFileSync(authFile(), JSON.stringify(cur), { mode: 0o600 })
  }
  /** Lleva la lista de proveedores al borde superior para que la captura la enseñe. */
  const showProviders = (): Promise<void> =>
    app()
      .page.locator('#settings-providers')
      .evaluate((el) => el.scrollIntoView({ block: 'start' }))
  const probar = async (): Promise<void> => {
    await app().page.getByRole('button', { name: 'Probar la clave de OpenAI' }).click()
  }

  it('(1) guardar una clave de OpenAI la prueba sola y el proveedor la recibe', async () => {
    const { page, electronApp } = app()
    for (const s of [electronApp.process().stdout, electronApp.process().stderr]) s?.on('data', (d: Buffer) => output.push(d.toString()))
    await openModels(page)
    await page.getByLabel('Proveedor').selectOption('openai')
    await page.getByLabel('API key').fill(KEYS.valid)
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => noticeStatus(page), { timeout: 20_000 }).toBe('ok')
    await expectVisible(page.getByText(/Funciona · \d+ ms/))
    const hit = probe.hits.find((h) => receivedKey(h) === KEYS.valid)
    expect(hit, 'el proveedor recibió la clave').toBeTruthy()
    expect(hit!.method).toBe('GET')
    expect(hit!.path).toBe('/v1/models')
    await showProviders()
    await shot(app(), SHOTS, 'modelos-probar-ok')
  })

  it('(2) «Probar» distingue clave inválida, límite y proveedor caído', async () => {
    const { page } = app()
    seedKey(KEYS.invalid)
    await probar()
    await expect.poll(() => noticeStatus(page), { timeout: 20_000 }).toBe('invalid')
    await expectVisible(page.getByText('Clave no válida'))
    await expectVisible(page.getByRole('button', { name: 'Cambiar clave' }))
    await showProviders()
    await shot(app(), SHOTS, 'modelos-probar-invalida')

    seedKey(KEYS.limit)
    await probar()
    await expect.poll(() => noticeStatus(page), { timeout: 20_000 }).toBe('rate-limited')
    await expectVisible(page.getByText('Límite de uso alcanzado'))

    seedKey(KEYS.down)
    await probar()
    await expect.poll(() => noticeStatus(page), { timeout: 20_000 }).toBe('provider-down')
    await expectVisible(page.getByText('El proveedor tiene problemas'))
    await showProviders()
    await shot(app(), SHOTS, 'modelos-probar-proveedor-caido')
  })

  it('(3) «Cambiar clave» sustituye la clave inválida y la prueba sola', async () => {
    const { page } = app()
    seedKey(KEYS.invalid)
    await probar()
    await expect.poll(() => noticeStatus(page), { timeout: 20_000 }).toBe('invalid')
    await page.getByRole('button', { name: 'Cambiar clave' }).click()
    await page.getByLabel('Nueva clave de OpenAI').fill(KEYS.renewed)
    await page
      .locator('form', { has: page.getByLabel('Nueva clave de OpenAI') })
      .getByRole('button', { name: 'Guardar' })
      .click()
    await expect.poll(() => noticeStatus(page), { timeout: 20_000 }).toBe('ok')
    expect((JSON.parse(readFileSync(authFile(), 'utf8')) as { openai: { key: string } }).openai.key).toBe(KEYS.renewed)
    expect(probe.hits.some((h) => receivedKey(h) === KEYS.renewed)).toBe(true)
  })

  it('(4) sin contacto con el proveedor (puerto cerrado): «No se pudo contactar»', async () => {
    const { page, electronApp } = app()
    await probe.close()
    await probar()
    const online = await electronApp.evaluate(({ net }) => net.isOnline())
    await expect.poll(() => noticeStatus(page), { timeout: 20_000 }).toBe(online ? 'unreachable' : 'offline')
    await expectVisible(page.getByText(online ? 'No se pudo contactar' : 'Sin conexión a internet'))
  })

  it('(5) ni el DOM ni la salida de Electron contienen ninguna clave', async () => {
    const { page } = app()
    const dom = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input,textarea')].map((i) => (i as HTMLInputElement).value).join('\n')
      return `${document.documentElement.outerHTML}\n${inputs}\n${JSON.stringify(localStorage)}`
    })
    const main = output.join('')
    for (const key of Object.values(KEYS)) {
      expect(dom, `DOM con ${key}`).not.toContain(key)
      expect(main, `salida de Electron con ${key}`).not.toContain(key)
    }
    await expectCount(page.getByText(/sk-e2e-/), 0)
  })
})
