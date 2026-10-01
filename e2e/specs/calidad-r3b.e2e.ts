// Calidad R3-B (F8-B38): axe-core (claro y oscuro) sobre la pantalla de acceso, Ajustes › Cuenta (con el servidor de cuentas
// FALSO de e2e/fake-auth: ni red ni Google ni correo reales) y la ventana Quick Entry. Informe completo: R3B_AXE_REPORT=/ruta.jsonl;
// R3B_AUDIT=1 solo cuenta (no falla); capturas con R3B_SHOTS_DIR (claro/oscuro).
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startFakeAuth, type FakeAuth } from '../lib/fake-auth'
import { findQuickPage, isQuickUrl, listWindows } from '../lib/instance'
import { MODE, startApp, type E2EApp } from '../lib/launch'
import { runAxe, SERIOUS, summarize, type AxeViolation } from '../lib/axe'
import { expectCount, expectVisible } from '../lib/wait'

const SHOTS = process.env.R3B_SHOTS_DIR
const REPORT = process.env.R3B_AXE_REPORT
const AUDIT = process.env.R3B_AUDIT === '1'

async function clean(page: Page, view: string, scope = 'body'): Promise<void> {
  const v: Record<'light' | 'dark', AxeViolation[]> = await runAxe(page, scope)
  if (REPORT) appendFileSync(REPORT, JSON.stringify({ view, violations: v }) + '\n')
  const bad = [...v.light, ...v.dark].filter((x) => x.impact && SERIOUS.has(x.impact))
  if (AUDIT) console.log(`AUDIT ${view}: ${bad.length} serias/moderadas; total ${v.light.length}/${v.dark.length}\n${summarize(v)}`)
  else expect(bad, `${view}\n${summarize(v)}`).toEqual([])
}

async function shots(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: null })
}

let fake: FakeAuth
const apps: E2EApp[] = []
const dirs: string[] = []

beforeAll(async () => {
  fake = await startFakeAuth()
})
beforeEach(async () => {
  await fake.reset()
})
afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
  for (const a of apps.splice(0)) await a.stop()
})
afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  await fake.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function launch(signedIn: boolean): Promise<E2EApp> {
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-r3b-')))
  dirs.push(userData)
  const app = await startApp({ userData, keepUserData: true, account: { fake, signedIn } })
  apps.push(app)
  return app
}

const gate = (p: Page): ReturnType<Page['getByTestId']> => p.getByTestId('account-gate')

describe.skipIf(MODE === 'prod')(`calidad R3-B: cuenta y Quick Entry (${MODE})`, () => {
  it('pantalla de acceso (inicio, correo y código): axe sin violaciones', async () => {
    const { page } = await launch(false)
    await expectVisible(gate(page))
    await clean(page, 'acceso:inicio')
    await shots(page, 'acceso-inicio')
    await page.getByTestId('account-terms').check()
    await page.getByTestId('account-email-open').click()
    await page.getByTestId('account-email-input').fill('ana@ejemplo.test')
    await clean(page, 'acceso:correo')
    await page.getByTestId('account-email-send').click()
    await expectVisible(page.getByTestId('account-code-input'))
    await clean(page, 'acceso:codigo')
    await page.getByTestId('account-code-input').fill('000000')
    await expectVisible(page.getByTestId('account-error'))
    await clean(page, 'acceso:codigo-error')
    await shots(page, 'acceso-codigo-error')
  })

  it('Ajustes › Cuenta y el diálogo de borrar cuenta: axe sin violaciones', async () => {
    const { page } = await launch(true)
    await expectVisible(page.locator('nav[aria-label="Modo"]'))
    await page.keyboard.press('Meta+,')
    const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
    await expectVisible(nav)
    await nav.getByRole('button', { name: 'Cuenta', exact: true }).click()
    await expectVisible(page.getByTestId('account-section'))
    await clean(page, 'ajustes:cuenta')
    await shots(page, 'ajustes-cuenta')
    await page.getByRole('button', { name: 'Borrar mi cuenta' }).click()
    const dlg = page.getByRole('alertdialog')
    await expectVisible(dlg.getByText('¿Borrar tu cuenta?'))
    await clean(page, 'ajustes:cuenta-borrar')
    await page.keyboard.press('Escape')
    await expectCount(dlg, 0)
  })

  it('ventana Quick Entry: axe sin violaciones', async () => {
    const app = await launch(true)
    await expectVisible(app.page.locator('nav[aria-label="Modo"]'))
    await app.page.evaluate(() =>
      (window as unknown as { api: { extras: { invoke: (c: string) => Promise<unknown> } } }).api.extras.invoke('extras:quickToggle')
    )
    await expect
      .poll(async () => (await listWindows(app.electronApp)).some((w) => isQuickUrl(w.url) && w.visible), { timeout: 15_000 })
      .toBe(true)
    const quick = findQuickPage(app.electronApp)!
    await quick.waitForLoadState('domcontentloaded')
    await quick.waitForTimeout(500)
    await clean(quick, 'quick:vacia')
    await shots(quick, 'quick-vacia')
    const box = quick.locator('input').first()
    await box.fill('Resume mi día')
    await clean(quick, 'quick:con-texto')
    await shots(quick, 'quick-con-texto')
  })
})
