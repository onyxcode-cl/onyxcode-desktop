// Idioma T4c: lo que construye main y las ventanas con preload propio, con la interfaz en inglés.
//  (1) error del asistente «no se encontró el binario» y error del código de acceso (pantalla de acceso) en inglés;
//  (2) motivo de una carpeta de confianza (check.reason) en inglés y con es el texto de siempre;
//  (3) Quick Entry, píldora (plan, toma de control) y globo de guía leen `?lang=` sin tocar sus preloads;
//      cambiar el idioma recrea Quick Entry en el otro idioma.
// Capturas con I18N_T4C_SHOTS_DIR (claro/oscuro en las páginas del renderer principal).
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startFakeAuth, type FakeAuth } from '../lib/fake-auth'
import { useApp } from '../lib/harness'
import { isQuickUrl, listWindows } from '../lib/instance'
import { MODE, startApp, type E2EApp } from '../lib/launch'
import { expectCount, expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.I18N_T4C_SHOTS_DIR

async function shotPage(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: null })
}

describe.skipIf(!DEV)('T4c: error del asistente y de acceso en inglés', () => {
  const dirs: string[] = []
  let fake: FakeAuth
  beforeAll(async () => {
    fake = await startFakeAuth()
  })
  afterAll(async () => {
    await fake.close()
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  it('«No se encontró el binario opencode» sale en inglés (y en español con es)', async () => {
    for (const [lang, expected, other] of [
      ['en', 'Couldn’t find the `opencode` binary', 'No se encontró el binario'],
      ['es', 'No se encontró el binario', 'Couldn’t find the']
    ] as const) {
      const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-t4c-')))
      const home = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-t4c-home-')))
      dirs.push(userData, home)
      mkdirSync(join(home, '.opencode', 'bin'), { recursive: true })
      const env = { OPENCODE_BIN: join(home, 'no-existe', 'opencode'), HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }
      const app = await startApp({ userData, keepUserData: true, noServer: true, env, settings: { onboarded: false, language: lang } })
      try {
        const alert = app.page.getByRole('dialog').getByRole('alert').filter({ hasText: expected })
        await expectVisible(alert)
        await expectCount(app.page.getByRole('dialog').getByRole('alert').filter({ hasText: other }), 0)
        await shotPage(app.page, `asistente-error-${lang}`)
      } finally {
        await app.stop()
      }
    }
  })

  it('pantalla de acceso: el código incorrecto sale en inglés', async () => {
    await fake.reset()
    const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-t4c-acc-')))
    dirs.push(userData)
    const app = await startApp({ userData, keepUserData: true, settings: { language: 'en' }, account: { fake, signedIn: false } })
    try {
      const p = app.page
      await expectVisible(p.getByTestId('account-gate'))
      await p.getByTestId('account-terms').check()
      await p.getByTestId('account-email-open').click()
      await p.getByTestId('account-email-input').fill('ana@ejemplo.test')
      await p.getByTestId('account-email-send').click()
      await expectVisible(p.getByTestId('account-code-input'))
      await expect.poll(() => fake.lastCode('ana@ejemplo.test'), { timeout: 10_000 }).not.toBeNull()
      const real = (await fake.lastCode('ana@ejemplo.test')) as string
      await p.getByTestId('account-code-input').fill(real === '000000' ? '111111' : '000000')
      await expectVisible(p.getByTestId('account-error'))
      const text = await p.getByTestId('account-error').innerText()
      expect(text).toContain('The code is wrong or has expired. Request a new one.')
      expect(text).not.toContain('incorrecto')
      await shotPage(p, 'acceso-codigo-error-en')
    } finally {
      await app.stop()
    }
  })
})

describe.skipIf(!DEV)('T4c: motivo de carpeta y ventanas propias en inglés', () => {
  const app = useApp({ settings: { language: 'en' } })

  const invokeMain = (page: Page, channel: string, req: unknown): Promise<unknown> =>
    page.evaluate(
      ([c, r]) => (window as unknown as { api: { invoke: (c: string, r?: unknown) => Promise<unknown> } }).api.invoke(c as string, r),
      [channel, req]
    )

  it('(1) check.reason de una carpeta de confianza sale en inglés y vuelve a español al cambiar', async () => {
    const { page } = app()
    const check = async (): Promise<string> => {
      const r = (await page.evaluate(() =>
        (
          window as unknown as {
            api: { tasks: { invoke: (c: string, r: unknown) => Promise<{ ok: boolean; data?: { ok: boolean; reason?: string } }> } }
          }
        ).api.tasks.invoke('tasks:folders:check', { path: '/' })
      )) as { ok: boolean; data?: { ok: boolean; reason?: string } }
      expect(r.ok).toBe(true)
      expect(r.data?.ok).toBe(false)
      return r.data?.reason ?? ''
    }
    expect(await check()).toMatch(/^You can’t use the disk root or your entire home folder\./)
    await invokeMain(page, 'settings:set', { language: 'es' })
    await expect.poll(check).toMatch(/^No se puede usar la raíz del disco/)
    await invokeMain(page, 'settings:set', { language: 'en' })
    await expect.poll(check).toMatch(/^You can’t use the disk root/)
  })

  let opened = 0
  const openPage = async (url: string): Promise<Page> => {
    const { electronApp } = app()
    // `n` distingue esta ventana de las ya destruidas que Playwright aún tiene en su lista.
    const nonce = `n=${++opened}`
    const [path, hash = ''] = url.split('#')
    const full = `${path}${path.includes('?') ? '&' : '?'}${nonce}${hash ? `#${hash}` : ''}`
    await electronApp.evaluate(({ BrowserWindow }, u) => {
      const w = new BrowserWindow({ show: false, width: 460, height: 560, backgroundColor: '#1d1d1f' })
      void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${u}`)
    }, full)
    await expect.poll(() => electronApp.windows().some((p) => p.url().includes(nonce)), { timeout: 15_000 }).toBe(true)
    const page = electronApp.windows().find((p) => p.url().includes(nonce))!
    await page.waitForLoadState('domcontentloaded')
    return page
  }
  const closePages = async (needle: string): Promise<void> => {
    await app().electronApp.evaluate(({ BrowserWindow }, n) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes(n)) w.destroy()
    }, needle)
  }

  it('(2) píldora: tarjeta de plan en inglés y en español (sin tocar el preload)', async () => {
    for (const [lang, title, approve, asks, tier] of [
      ['en', 'Plan and permissions', 'Approve and start', 'Asks for: Full control', 'Deny'],
      ['es', 'Plan y permisos', 'Aprobar y empezar', 'Pide: Control total', 'Denegar']
    ] as const) {
      const p = await openPage(`overlay/pill.html?lang=${lang}#demo-request`)
      try {
        expect(await p.evaluate(() => document.documentElement.lang)).toBe(lang)
        await expectVisible(p.locator('.request-title'))
        expect(await p.locator('.request-title').innerText()).toBe(title)
        expect(await p.locator('.req-approve').innerText()).toBe(approve)
        expect(await p.locator('.req-app-meta').first().innerText()).toContain(asks)
        expect(await p.locator('.req-tier-deny').first().innerText()).toBe(tier)
        await shotPage(p, `pildora-plan-${lang}`)
      } finally {
        await closePages('overlay/pill.html')
      }
    }
  })

  it('(3) píldora: toma de control, plan sin apps y estado normal en inglés', async () => {
    let p = await openPage('overlay/pill.html?lang=en#demo-takeover')
    try {
      expect(await p.locator('.request-title').innerText()).toBe('Take control of the screen?')
      expect(await p.locator('.request-reason').innerText()).toBe(
        'The agent was working in Discord in the background and needs the mouse and keyboard.'
      )
      expect(await p.locator('.req-deny').innerText()).toBe('Keep working in the background')
      expect(await p.locator('.req-approve').innerText()).toBe('Allow')
      await shotPage(p, 'pildora-toma-de-control-en')
    } finally {
      await closePages('overlay/pill.html')
    }
    p = await openPage('overlay/pill.html?lang=en#demo-plan-only')
    try {
      expect(await p.locator('.request-title').innerText()).toBe('Task plan')
      expect(await p.locator('.request-noapps').innerText()).toContain('This plan doesn’t control any app')
      expect(await p.locator('.req-deny').innerText()).toBe('Cancel')
    } finally {
      await closePages('overlay/pill.html')
    }
    p = await openPage('overlay/pill.html?lang=en#demo')
    try {
      expect(await p.locator('.title').innerText()).toBe('The AI is controlling your Mac')
      expect(await p.locator('.stop').innerText()).toBe('Stop')
      expect(await p.title()).toBe('The AI is controlling your Mac')
      await shotPage(p, 'pildora-en')
    } finally {
      await closePages('overlay/pill.html')
    }
  })

  it('(4) globo de guía, píldora de grabación y overlay de control en inglés; sin parámetro, español', async () => {
    let p = await openPage('overlay/assist.html?lang=en#teach')
    try {
      expect(await p.locator('.teach-exit').innerText()).toBe('Exit the guide')
      expect(await p.locator('.teach-next').innerText()).toBe('Next')
      expect(await p.title()).toBe('Guide and recording')
    } finally {
      await closePages('overlay/assist.html')
    }
    p = await openPage('overlay/assist.html?lang=en#record')
    try {
      expect(await p.locator('.record-finish').innerText()).toBe('Finish')
      expect(await p.locator('.record-discard').innerText()).toBe('Discard')
    } finally {
      await closePages('overlay/assist.html')
    }
    p = await openPage('overlay/assist.html#teach')
    try {
      expect(await p.locator('.teach-exit').innerText()).toBe('Salir de la guía')
      expect(await p.evaluate(() => document.documentElement.lang)).toBe('es')
    } finally {
      await closePages('overlay/assist.html')
    }
  })

  it('(5) Quick Entry: en inglés; al cambiar el idioma se recrea en español', async () => {
    const { electronApp, page } = app()
    const extras = (channel: string): Promise<unknown> =>
      page.evaluate(
        (c) => (window as unknown as { api: { extras: { invoke: (c: string) => Promise<unknown> } } }).api.extras.invoke(c),
        channel
      )
    const toggle = (): Promise<unknown> => extras('extras:quickToggle')
    const hide = (): Promise<unknown> => extras('extras:quickHide')
    const quickPage = (lang: string): Page | undefined =>
      electronApp.windows().find((w) => !w.isClosed() && isQuickUrl(w.url()) && w.url().includes(`lang=${lang}`))
    const quickVisible = async (): Promise<boolean> => (await listWindows(electronApp)).some((w) => isQuickUrl(w.url) && w.visible)
    await toggle()
    await expect.poll(() => !!quickPage('en'), { timeout: 15_000 }).toBe(true)
    let quick = quickPage('en')!
    const input = quick.getByLabel('Type a message for the chat')
    await input.waitFor({ timeout: 15_000 })
    expect(await input.getAttribute('placeholder')).toBe('How can I help?')
    expect(await quick.evaluate(() => document.documentElement.lang)).toBe('en')
    await shotPage(quick, 'quick-entry-en')
    // Se oculta y se cambia el idioma: la próxima vez nace en español.
    await hide()
    await expect.poll(quickVisible, { timeout: 5_000 }).toBe(false)
    await invokeMain(page, 'settings:set', { language: 'es' })
    await toggle()
    await expect.poll(() => !!quickPage('es'), { timeout: 15_000 }).toBe(true)
    quick = quickPage('es')!
    const input2 = quick.getByLabel('Escribe un mensaje para el chat')
    await input2.waitFor({ timeout: 15_000 })
    expect(await input2.getAttribute('placeholder')).toBe('¿En qué te ayudo?')
    await shotPage(quick, 'quick-entry-es')
    await hide()
    await invokeMain(page, 'settings:set', { language: 'en' })
  })
})
