// Calidad R3-B (F8-B38): axe-core (claro y oscuro) sobre la ventana Quick Entry. Informe completo: R3B_AXE_REPORT=/ruta.jsonl;
// R3B_AUDIT=1 solo cuenta (no falla); capturas con R3B_SHOTS_DIR (claro/oscuro).
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { findQuickPage, isQuickUrl, listWindows } from '../lib/instance'
import { MODE, startApp, type E2EApp } from '../lib/launch'
import { runAxe, SERIOUS, summarize, type AxeViolation } from '../lib/axe'
import { expectVisible } from '../lib/wait'

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

const apps: E2EApp[] = []
const dirs: string[] = []

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
  for (const a of apps.splice(0)) await a.stop()
})
afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function launch(): Promise<E2EApp> {
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-e2e-r3b-')))
  dirs.push(userData)
  const app = await startApp({ userData, keepUserData: true })
  apps.push(app)
  return app
}

describe.skipIf(MODE === 'prod')(`calidad R3-B: Quick Entry (${MODE})`, () => {
  it('ventana Quick Entry: axe sin violaciones', async () => {
    const app = await launch()
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
