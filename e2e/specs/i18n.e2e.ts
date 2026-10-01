// Idioma: arranque en inglés (modos, secciones de Ajustes y asistente en inglés), cambio a Español y de vuelta en vivo
// (sin reiniciar), persistencia en settings.json y <html lang>. Capturas con I18N_SHOTS_DIR en los dos idiomas
// (claro/oscuro, 820 y 1280 px): General, Modelos, MCP, Diagnóstico, asistente y Chat vacío.
// La bandeja se prueba en `main/extras/tray.i18n.test.ts` (Electron no deja leer el menú de un Tray).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { translate } from '../../src/shared/i18n'
import { useApp } from '../lib/harness'
import { MODE, startApp, type E2EApp } from '../lib/launch'
import { fakeOutsideUserData } from '../lib/lotes'
import { shot } from '../lib/shots'
import { expectAttr, expectCount, expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.I18N_SHOTS_DIR
const tr = (lang: 'es' | 'en', key: string): string => translate(lang, key)
const sub = (lang: 'es' | 'en'): string | undefined => (SHOTS ? join(SHOTS, lang) : undefined)

const navLabel = (lang: 'es' | 'en') => (page: Page) => page.locator(`nav[aria-label="${tr(lang, 'settings.navAria')}"]`)

async function openSettings(page: Page, lang: 'es' | 'en'): Promise<void> {
  if (!(await navLabel(lang)(page).isVisible())) await page.keyboard.press('Meta+,')
  await expectVisible(navLabel(lang)(page))
}

async function goto(page: Page, lang: 'es' | 'en', key: string): Promise<void> {
  const label = tr(lang, key)
  const button = navLabel(lang)(page).getByRole('button', { name: label, exact: true })
  await button.click()
  await expectAttr(button, 'aria-current', 'page')
  await page.waitForTimeout(250)
}

describe.skipIf(!DEV)('Idioma (en/es)', () => {
  const app = useApp({ settings: { language: 'en' } })
  const settingsFile = (): Record<string, unknown> =>
    JSON.parse(readFileSync(join(app().userData, 'settings.json'), 'utf8')) as Record<string, unknown>

  it('(1) arranca en inglés: modos, <html lang> y Chat vacío', async () => {
    const { page } = app()
    const modes = page.locator(`nav[aria-label="${tr('en', 'app.sidebar.mode')}"]`)
    await expectVisible(modes)
    for (const m of ['Chat', 'Code', 'Tasks', 'Routines']) await expectVisible(modes.getByRole('button', { name: m, exact: true }))
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
    await expectVisible(page.getByText(tr('en', 'chat.empty.prompt'), { exact: true }))
    await expectCount(page.getByText('Tareas', { exact: true }), 0)
    await shot(app(), sub('en'), 'chat-vacio')
  })

  it('(2) Ajustes en inglés: secciones, General y capturas', async () => {
    const { page } = app()
    await openSettings(page, 'en')
    const nav = navLabel('en')(page)
    for (const k of ['general', 'models', 'mcp', 'browser', 'usage', 'shortcuts', 'diagnostics', 'about'])
      await expectVisible(nav.getByRole('button', { name: tr('en', `settings.nav.${k}`), exact: true }))
    await goto(page, 'en', 'settings.nav.general')
    await expectVisible(page.getByRole('combobox', { name: tr('en', 'settings.general.language') }))
    await shot(app(), sub('en'), 'general')
    await goto(page, 'en', 'settings.nav.models')
    await shot(app(), sub('en'), 'modelos')
    await goto(page, 'en', 'settings.nav.mcp')
    await shot(app(), sub('en'), 'mcp')
    await goto(page, 'en', 'settings.nav.diagnostics')
    await shot(app(), sub('en'), 'diagnostico')
  })

  it('(3) cambiar a Español en vivo: interfaz, <html lang> y settings.json', async () => {
    const { page } = app()
    await goto(page, 'en', 'settings.nav.general')
    await page.getByRole('combobox', { name: tr('en', 'settings.general.language') }).selectOption('es')
    await expectVisible(navLabel('es')(page))
    await expectVisible(page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Tareas', exact: true }))
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('es')
    await expect.poll(() => settingsFile().language).toBe('es')
    await shot(app(), sub('es'), 'general')
    await goto(page, 'es', 'settings.nav.models')
    await shot(app(), sub('es'), 'modelos')
    await goto(page, 'es', 'settings.nav.mcp')
    await shot(app(), sub('es'), 'mcp')
    await goto(page, 'es', 'settings.nav.diagnostics')
    await shot(app(), sub('es'), 'diagnostico')
    await page.keyboard.press('Escape')
    await expectVisible(page.getByText(tr('es', 'chat.empty.prompt'), { exact: true }))
    await shot(app(), sub('es'), 'chat-vacio')
  })

  it('(4) volver a English en vivo y a «Sistema»', async () => {
    const { page } = app()
    await openSettings(page, 'es')
    await goto(page, 'es', 'settings.nav.general')
    const select = page.getByRole('combobox', { name: tr('es', 'settings.general.language') })
    await select.selectOption('en')
    await expectVisible(navLabel('en')(page))
    await expect.poll(() => settingsFile().language).toBe('en')
    await page.getByRole('combobox', { name: tr('en', 'settings.general.language') }).selectOption('system')
    await expect.poll(() => settingsFile().language).toBe('system')
    await page.getByRole('combobox', { name: /Language|Idioma/ }).selectOption('en')
    await expect.poll(() => settingsFile().language).toBe('en')
  })
})

describe.skipIf(!DEV)('Idioma: asistente de primer uso', () => {
  const dirs: string[] = []
  const fakeBin = fakeOutsideUserData()
  afterAll(() => {
    fakeBin.dispose()
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  it.each([
    ['en', /Step 1 of 5/, 'Paso 1 de 5'],
    ['es', /Paso 1 de 5/, 'Step 1 of 5']
  ] as const)('el asistente se ve en %s y no mezcla el otro idioma', async (lang, step, other) => {
    const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-i18n-')))
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-i18n-home-')))
    dirs.push(userData, home)
    mkdirSync(join(home, '.opencode', 'bin'), { recursive: true })
    const env = { OPENCODE_BIN: join(home, 'no-existe', 'opencode'), HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }
    const app: E2EApp = await startApp({
      userData,
      keepUserData: true,
      noServer: true,
      env,
      settings: { onboarded: false, language: lang }
    })
    try {
      const d = app.page.getByRole('dialog')
      await expectVisible(d.getByRole('heading', { name: tr(lang, 'wizard.stepTitle.install') }))
      await expectVisible(d.getByText(step))
      await expectCount(d.getByText(other), 0)
      await shot(app, sub(lang), 'asistente')
    } finally {
      await app.stop()
    }
  })
})
