// Idioma: arranque en inglés (modos, secciones de Ajustes y asistente en inglés), cambio a Español y de vuelta en vivo
// (sin reiniciar), persistencia en settings.json y <html lang>. Capturas con I18N_SHOTS_DIR en los dos idiomas
// (claro/oscuro, 820 y 1280 px): General, Modelos, MCP, Diagnóstico, asistente y Chat vacío; y, en inglés, Code, Tareas,
// Rutinas y navegador integrado (T4b, `I18N_SHOTS_DIR/en/`).
// La bandeja se prueba en `main/extras/tray.i18n.test.ts` (Electron no deja leer el menú de un Tray).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { translate } from '../../src/shared/i18n'
import { useApp } from '../lib/harness'
import { MODE, startApp, type E2EApp } from '../lib/launch'
import { fakeOutsideUserData, makeTasksDir } from '../lib/lotes'
import { shot } from '../lib/shots'
import { setMode, storeCall } from '../lib/stores'
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

describe.skipIf(!DEV)('Idioma: Code, Tareas, Rutinas y navegador en inglés (T4b)', () => {
  const fakeBin = fakeOutsideUserData()
  const project = makeTasksDir()
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-i18n-t4b-')))
  const routine = (id: string, name: string, enabled: boolean, schedule: Record<string, unknown>): Record<string, unknown> => ({
    id,
    name,
    prompt: 'do nothing',
    mode: 'chat',
    folder: null,
    model: { providerID: 'fake', modelID: 'fake-model' },
    schedule,
    enabled,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  writeFileSync(
    join(userData, 'routines.json'),
    JSON.stringify({
      routines: [
        routine('r1', 'Morning summary', true, { kind: 'daily', time: '09:00' }),
        routine('r2', 'Weekly review', false, { kind: 'weekly', day: 1, time: '17:30' })
      ],
      history: []
    })
  )
  afterAll(() => {
    fakeBin.dispose()
    project.dispose()
    rmSync(userData, { recursive: true, force: true })
  })
  const app = useApp({
    userData,
    env: { OPENCODE_BIN: fakeBin.bin },
    settings: { language: 'en', routinesTermsAcknowledged: true }
  })
  const modes = (page: Page) => page.locator(`nav[aria-label="${tr('en', 'app.sidebar.mode')}"]`)

  it('(5) Tareas en inglés: guía de inicio y pantalla de inicio', async () => {
    const { page } = app()
    await modes(page).getByRole('button', { name: 'Tasks', exact: true }).click()
    await expectVisible(page.getByText(tr('en', 'tasksComputer.onb.title'), { exact: true }))
    await expectCount(page.getByText('Así funcionan las tareas'), 0)
    await shot(app(), sub('en'), 'tareas-guia')
    await page.getByRole('button', { name: tr('en', 'tasksComputer.onb.gotIt') }).click()
    await expectVisible(page.getByText(tr('en', 'tasks.home.title'), { exact: true }))
    await expectCount(page.getByText('¿En qué trabajamos hoy?'), 0)
    await shot(app(), sub('en'), 'tareas-inicio')
  })

  it('(6) Rutinas en inglés: lista y editor, con horarios en inglés', async () => {
    const { page } = app()
    await modes(page).getByRole('button', { name: 'Routines', exact: true }).click()
    await expectVisible(page.getByText(tr('en', 'routines.view.title'), { exact: true }).first())
    await expectVisible(page.getByText('Morning summary').first())
    await expectCount(page.getByText(/Cada día|Todos los días|lunes/i), 0)
    await shot(app(), sub('en'), 'rutinas')
    await page
      .getByRole('button', { name: tr('en', 'routines.view.new') })
      .first()
      .click()
    await expectVisible(page.getByText(tr('en', 'routines.editor.new'), { exact: true }).first())
    await shot(app(), sub('en'), 'rutinas-editor')
    await page.keyboard.press('Escape')
  })

  it('(7) Code y navegador integrado en inglés', async () => {
    const a = app()
    const { page } = a
    await setMode(page, 'code')
    await storeCall(page, 'useCode', 'trustFolder', project.dir)
    await storeCall(page, 'useCode', 'openProject', project.dir)
    await storeCall(page, 'useCode', 'newSessionAt', project.dir)
    await expectVisible(page.getByText(/What are we building in/))
    await expectCount(page.getByText(/¿Qué construimos en/), 0)
    await shot(a, sub('en'), 'code')
    await page.keyboard.press('Meta+4')
    await expectVisible(page.getByText(tr('en', 'browser.empty.title'), { exact: true }))
    await expectCount(page.getByText('Sin pestañas abiertas'), 0)
    await shot(a, sub('en'), 'navegador')
  })

  it('(8) cambiar a Español en vivo repinta Tareas y Rutinas', async () => {
    const { page } = app()
    await setMode(page, 'routines')
    await storeCall(page, 'useSettings', 'update', { language: 'es' })
    await expectVisible(page.getByText(tr('es', 'routines.view.title'), { exact: true }).first())
    await page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Tareas', exact: true }).click()
    await expectVisible(page.getByText(tr('es', 'tasks.home.title'), { exact: true }))
  })
})
