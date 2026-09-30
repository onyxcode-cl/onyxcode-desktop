// Cuenta obligatoria (Fase 1) contra el servidor de autenticación FALSO (e2e/fake-auth): nunca hay red real, ni Google,
// ni correo. `ONYXCODE_ACCOUNT_URL` y `ONYXCODE_TEST_PLAIN_STORE` solo se honran sin empaquetar (el Llavero real no se toca).
// Capturas de la pantalla de acceso (claro/oscuro): ACCOUNT_SHOTS_DIR=/ruta.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dialogCalls, openedUrls, stubDialog, stubOpenExternal } from '../lib/dialogs'
import { startFakeAuth, type FakeAuth } from '../lib/fake-auth'
import { listWindows, isQuickUrl } from '../lib/instance'
import { startApp, type E2EApp } from '../lib/launch'
import { expectCount, expectVisible } from '../lib/wait'

const SHOTS = process.env.ACCOUNT_SHOTS_DIR
const DAY = 24 * 60 * 60 * 1000

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

function newDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-account-')))
  dirs.push(d)
  return d
}

/** Sin proveedores conectados «de fábrica»: tras la cuenta aparece «Conecta tu IA». */
function noDefaultProviders(userData: string): void {
  mkdirSync(join(userData, 'fake-opencode'), { recursive: true })
  writeFileSync(join(userData, 'fake-opencode', 'connected.json'), '[]')
}

async function launch(
  o: { signedIn?: boolean; agoMs?: number; settings?: Record<string, unknown>; userData?: string; wizard?: boolean } = {}
): Promise<E2EApp> {
  const userData = o.userData ?? newDir()
  if (o.wizard) noDefaultProviders(userData)
  const app = await startApp({
    userData,
    keepUserData: true,
    settings: o.settings,
    account: { fake, signedIn: o.signedIn, lastValidationAgoMs: o.agoMs }
  })
  apps.push(app)
  return app
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: null })
}

const gate = (p: Page): ReturnType<Page['getByTestId']> => p.getByTestId('account-gate')
const modeNav = (p: Page): ReturnType<Page['locator']> => p.locator('nav[aria-label="Modo"]')
const sessionFile = (userData: string): string => join(userData, 'account.test.json')
const sessionOf = (userData: string): { token: string; email: string; provider: string; lastValidation: number } =>
  JSON.parse(readFileSync(sessionFile(userData), 'utf8')) as { token: string; email: string; provider: string; lastValidation: number }

async function accept(p: Page): Promise<void> {
  await p.getByTestId('account-terms').check()
}

async function emailLogin(p: Page, email: string): Promise<void> {
  await accept(p)
  await p.getByTestId('account-email-open').click()
  await p.getByTestId('account-email-input').fill(email)
  await p.getByTestId('account-email-send').click()
  await expectVisible(p.getByTestId('account-code-input'))
  await expect.poll(() => fake.lastCode(email), { timeout: 10_000 }).not.toBeNull()
  const code = (await fake.lastCode(email)) as string
  await p.getByTestId('account-code-input').fill(code)
}

async function openAccountSettings(p: Page): Promise<void> {
  await p.keyboard.press('Meta+,')
  const nav = p.locator('nav[aria-label="Secciones de ajustes"]')
  await expectVisible(nav)
  await nav.getByRole('button', { name: 'Cuenta', exact: true }).click()
  await expectVisible(p.getByTestId('account-section'))
}

describe('cuenta apagada (por defecto)', () => {
  it('sin ACCOUNT_API no hay pantalla de acceso, ni sección Cuenta, ni peticiones al servidor de cuentas', async () => {
    const app = await startApp({ keepUserData: false })
    apps.push(app)
    await expectVisible(modeNav(app.page))
    await expectCount(gate(app.page), 0)
    await app.page.keyboard.press('Meta+,')
    const nav = app.page.locator('nav[aria-label="Secciones de ajustes"]')
    await expectVisible(nav)
    await expectCount(nav.getByRole('button', { name: 'Cuenta', exact: true }), 0)
    const st = await app.page.evaluate(() =>
      (window as unknown as { api: { invoke: (c: string) => Promise<{ data: { required: boolean; status: string } }> } }).api.invoke(
        'account:state'
      )
    )
    expect(st.data.required).toBe(false)
    expect((await fake.requests()).length).toBe(0)
  })
})

describe('primer arranque: correo + código', () => {
  it('(1) acceso → crear cuenta con correo → código → asistente «Conecta tu IA»', async () => {
    const app = await launch({ signedIn: false, wizard: true, settings: { onboarded: false } })
    const { page } = app
    await expectVisible(gate(page))
    // La app (y el asistente) no se montan hasta pasar la cuenta.
    await expectCount(modeNav(page), 0)
    await expectCount(page.getByRole('dialog'), 0)
    await expectVisible(page.getByRole('button', { name: /Iniciar sesión con Google/ }))
    await expectCount(page.getByTestId('account-existing-note'), 0)

    // Casilla desmarcada y obligatoria.
    expect(await page.getByTestId('account-terms').isChecked()).toBe(false)
    expect(await page.getByTestId('account-email-open').isDisabled()).toBe(true)
    expect(await page.getByTestId('account-google').isDisabled()).toBe(true)
    await shot(page, 'acceso-inicio')

    // Enlaces sin URL publicada: muestran el borrador local.
    await page.getByRole('button', { name: 'política de privacidad' }).click()
    await expectVisible(page.getByRole('dialog').getByText('Política de privacidad (borrador)'))
    await shot(page, 'acceso-borrador-privacidad')
    await page.keyboard.press('Escape')
    await expectCount(page.getByRole('dialog'), 0)

    await accept(page)
    expect(await page.getByTestId('account-email-open').isDisabled()).toBe(false)
    await page.getByTestId('account-email-open').click()
    await expectVisible(page.getByRole('heading', { name: 'Inicia sesión con tu correo' }))
    // Correo inválido: no se puede enviar.
    await page.getByTestId('account-email-input').fill('no-es-correo')
    expect(await page.getByTestId('account-email-send').isDisabled()).toBe(true)
    await page.getByTestId('account-email-input').fill('Ana.Perez@Ejemplo.test')
    await shot(page, 'acceso-correo')
    await page.getByTestId('account-email-send').click()
    await expectVisible(page.getByRole('heading', { name: 'Revisa tu correo' }))
    await shot(page, 'acceso-codigo')

    // Código incorrecto: mensaje claro y se queda.
    const real = (await fake.lastCode('ana.perez@ejemplo.test')) as string
    const wrong = real === '000000' ? '111111' : '000000'
    await page.getByTestId('account-code-input').fill(wrong)
    await expectVisible(page.getByTestId('account-error'))
    await expect(page.getByTestId('account-error').innerText()).resolves.toContain('incorrecto o ya venció')
    await shot(page, 'acceso-codigo-error')

    // Código correcto: entra y aparece el asistente de la IA.
    await page.getByTestId('account-code-input').fill(real)
    await expectVisible(page.getByRole('dialog').getByRole('heading', { name: 'Conecta tu IA' }), 30_000)
    await expectVisible(modeNav(page))
    await expectCount(gate(page), 0)

    // La sesión quedó guardada (almacén de prueba) y el token nunca llegó al renderer.
    const saved = sessionOf(app.userData)
    expect(saved).toMatchObject({ email: 'ana.perez@ejemplo.test', provider: 'email' })
    const leaked = await page.evaluate(async (tok) => {
      const r = await (window as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api.invoke('account:state')
      return (
        JSON.stringify(r).includes(tok) || document.documentElement.outerHTML.includes(tok) || JSON.stringify(localStorage).includes(tok)
      )
    }, saved.token)
    expect(leaked).toBe(false)

    // Lo que salió a la red: correo a /start, correo+código a /verify, sin cookies ni Origin, con el User-Agent de la app.
    const start = (await fake.requests('/v1/auth/email/start', 'POST'))[0]
    expect(start.body).toEqual({ email: 'ana.perez@ejemplo.test' })
    const all = await fake.requests('/v1')
    for (const r of all) {
      expect(r.origin).toBeNull()
      expect(r.cookie).toBeNull()
      expect(r.userAgent).toMatch(/^OnyxCode\//)
    }
    expect(all.some((r) => r.path === '/v1/auth/email/verify')).toBe(true)
  })

  it('quien ya tenía la app ve la nota una sola vez', async () => {
    const app = await launch({ signedIn: false })
    await expectVisible(gate(app.page))
    await expectVisible(app.page.getByTestId('account-existing-note'))
    await shot(app.page, 'acceso-nota-existente')
    await expect(app.page.getByTestId('account-existing-note').innerText()).resolves.toContain(
      'Tus conversaciones y claves de IA siguen en tu Mac.'
    )
  })
})

describe('pestañas «Iniciar sesión» | «Crear cuenta»', () => {
  const tab = (p: Page, name: string): ReturnType<Page['getByRole']> => p.getByRole('tab', { name, exact: true })

  it('(1b) por defecto «Iniciar sesión»; cambiar a «Crear cuenta» cambia los textos y el teclado mueve la pestaña', async () => {
    const app = await launch({ signedIn: false })
    const { page } = app
    await expectVisible(gate(page))
    await expectVisible(page.getByRole('tablist'))
    expect(await tab(page, 'Iniciar sesión').getAttribute('aria-selected')).toBe('true')
    expect(await tab(page, 'Crear cuenta').getAttribute('aria-selected')).toBe('false')
    await expectVisible(page.getByRole('heading', { name: 'Inicia sesión en OnyxCode' }))
    await expectVisible(page.getByText('Entra con tu cuenta de Google o con el código que te enviamos por correo. No hay contraseñas.'))
    await expectVisible(page.getByRole('button', { name: 'Iniciar sesión con Google' }))
    await expectVisible(page.getByRole('button', { name: 'Iniciar sesión con tu correo' }))
    await shot(page, 'acceso-pestana-iniciar')

    await tab(page, 'Crear cuenta').click()
    expect(await tab(page, 'Crear cuenta').getAttribute('aria-selected')).toBe('true')
    await expectVisible(page.getByRole('heading', { name: 'Crea tu cuenta de OnyxCode' }))
    await expectVisible(page.getByText('Crea una cuenta con tu cuenta de Google o con tu correo. No hay contraseñas.'))
    await expectVisible(page.getByRole('button', { name: 'Registrarse con Google' }))
    await expectVisible(page.getByRole('button', { name: 'Crear una cuenta con tu correo' }))
    await expectCount(page.getByRole('button', { name: 'Iniciar sesión con Google' }), 0)
    // La casilla sigue desmarcada y obligatoria en ambas pestañas.
    expect(await page.getByTestId('account-terms').isChecked()).toBe(false)
    expect(await page.getByTestId('account-google').isDisabled()).toBe(true)
    await shot(page, 'acceso-pestana-crear')

    // Teclado: flechas mueven la selección y el foco.
    await page.keyboard.press('ArrowLeft')
    expect(await tab(page, 'Iniciar sesión').getAttribute('aria-selected')).toBe('true')
    await expect(tab(page, 'Iniciar sesión').evaluate((el) => el === document.activeElement)).resolves.toBe(true)
    await page.keyboard.press('ArrowRight')
    expect(await tab(page, 'Crear cuenta').getAttribute('aria-selected')).toBe('true')
  })

  for (const [name, first, phrase] of [
    ['Iniciar sesión', 'Iniciar sesión con tu correo', true],
    ['Crear cuenta', 'Crear una cuenta con tu correo', false]
  ] as const) {
    it(`(1c) desde «${name}» el correo llega al mismo paso de código y completa el login (frase de cuenta nueva: ${phrase})`, async () => {
      const app = await launch({ signedIn: false })
      const { page } = app
      const email = `tab.${phrase ? 'login' : 'signup'}@ejemplo.test`
      await tab(page, name).click()
      await accept(page)
      await page.getByRole('button', { name: first }).click()
      await page.getByTestId('account-email-input').fill(email)
      await page.getByTestId('account-email-send').click()
      await expectVisible(page.getByRole('heading', { name: 'Revisa tu correo' }))
      await expectCount(page.getByText('Si no tenías cuenta, la crearemos al confirmar el código.'), phrase ? 1 : 0)
      await expectVisible(page.getByText('Vence en 10 minutos.'))
      await shot(page, phrase ? 'acceso-codigo-iniciar' : 'acceso-codigo-crear')
      await expect.poll(() => fake.lastCode(email), { timeout: 10_000 }).not.toBeNull()
      await page.getByTestId('account-code-input').fill((await fake.lastCode(email)) as string)
      await expectVisible(modeNav(page), 30_000)
      expect(sessionOf(app.userData)).toMatchObject({ email, provider: 'email' })
      // Mismo contrato con el servidor en ambas pestañas.
      expect((await fake.requests('/v1/auth/email/start', 'POST'))[0].body).toEqual({ email })
    })
  }
})

describe('Google (loopback + PKCE)', () => {
  it('(2) Google automático: abre el navegador, vuelve por el loopback y entra', async () => {
    const app = await launch({ signedIn: false })
    const { page } = app
    await stubOpenExternal(app.electronApp)
    await accept(page)
    await page.getByTestId('account-google').click()
    await expectVisible(modeNav(page), 30_000)
    const opened = await openedUrls(app.electronApp)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/__fake_google/)

    const start = (await fake.requests('/v1/auth/google/start'))[0]
    const exch = (await fake.requests('/v1/auth/exchange'))[0]
    const sb = start.body as Record<string, string>
    const eb = exch.body as Record<string, string>
    // PKCE S256: el servidor recibe el challenge en /start y el verifier solo en /exchange.
    expect(sb.code_challenge_method).toBe('S256')
    expect(sb.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(sb.state.length).toBeGreaterThanOrEqual(32)
    expect(JSON.stringify(sb)).not.toContain(eb.code_verifier)
    expect(eb.redirect_uri).toBe(sb.redirect_uri)
    expect(sessionOf(app.userData)).toMatchObject({ email: 'google.user@example.test', provider: 'google' })

    // Ajustes › Cuenta.
    await openAccountSettings(page)
    await expect(page.getByTestId('account-email').innerText()).resolves.toBe('google.user@example.test')
    await expectVisible(page.getByText('Sesión iniciada'))
    await shot(page, 'ajustes-cuenta')
  })

  it('(2b) el receptor loopback ya no escucha tras el inicio de sesión (segunda petición rechazada)', async () => {
    const app = await launch({ signedIn: false })
    await stubOpenExternal(app.electronApp)
    await accept(app.page)
    await app.page.getByTestId('account-google').click()
    await expectVisible(modeNav(app.page), 30_000)
    const start = (await fake.requests('/v1/auth/google/start'))[0].body as Record<string, string>
    const again = await fetch(`${start.redirect_uri}?code=otro&state=${start.state}`).then(
      (r) => r.status,
      () => 'cerrado'
    )
    expect(again).toBe('cerrado')
  })

  it('(2c) esperando el navegador: se puede cancelar; si Google rechaza, se explica', async () => {
    const app = await launch({ signedIn: false })
    const { page } = app
    await stubOpenExternal(app.electronApp)
    await fake.setGoogle({ mode: 'manual' })
    await accept(page)
    await page.getByTestId('account-google').click()
    await expectVisible(page.getByRole('heading', { name: 'Esperando al navegador…' }))
    await shot(page, 'acceso-esperando')
    const start = (await fake.requests('/v1/auth/google/start'))[0].body as Record<string, string>
    await page.getByTestId('account-cancel').click()
    await expectVisible(page.getByRole('button', { name: /Iniciar sesión con Google/ }))
    // Con el intento cancelado, el receptor está cerrado.
    await expect
      .poll(
        () =>
          fetch(`${start.redirect_uri}?code=x&state=${start.state}`).then(
            () => 'abierto',
            () => 'cerrado'
          ),
        { timeout: 5_000 }
      )
      .toBe('cerrado')

    await fake.setGoogle({ mode: 'deny' })
    await page.getByTestId('account-google').click()
    await expectVisible(page.getByTestId('account-error'))
    await expect(page.getByTestId('account-error').innerText()).resolves.toContain('No se completó el inicio de sesión con Google')
    await shot(page, 'acceso-google-rechazado')
  })
})

describe('sesión guardada y servidor', () => {
  it('(3) sesión revocada (401): bloquea al instante y deja volver a entrar', async () => {
    await fake.setMode('401')
    const app = await launch()
    const { page } = app
    await expectVisible(gate(page))
    await expectVisible(page.getByText('Tu sesión terminó'))
    await expectCount(modeNav(page), 0)
    expect(existsSync(sessionFile(app.userData))).toBe(false)
    await shot(page, 'acceso-sesion-terminada')
    await fake.setMode('normal')
    await emailLogin(page, 'vuelta@ejemplo.test')
    await expectVisible(modeNav(page), 30_000)
  })

  it('(3b) cuenta borrada (410): avisa y borra la sesión', async () => {
    await fake.setMode('410')
    const app = await launch()
    await expectVisible(app.page.getByText('Esta cuenta ya no existe'))
    expect(existsSync(sessionFile(app.userData))).toBe(false)
    await shot(app.page, 'acceso-cuenta-borrada')
  })

  it('(4) servidor caído dentro de la gracia de 30 días: la app abre y Ajustes lo dice', async () => {
    await fake.setMode('down')
    const app = await launch({ agoMs: 5 * DAY })
    await expectVisible(modeNav(app.page))
    await expectCount(gate(app.page), 0)
    // La sesión se conserva y la validación NO se renueva sin confirmación del servidor.
    const before = sessionOf(app.userData).lastValidation
    expect(Date.now() - before).toBeGreaterThan(4 * DAY)
    await openAccountSettings(app.page)
    await expectVisible(app.page.getByText(/Sin conexión con el servidor: puedes usar la app hasta el/))
    await shot(app.page, 'ajustes-cuenta-gracia')
  })

  it('(4b) servidor caído fuera de la gracia: bloquea; al volver el servidor, «Reintentar» abre', async () => {
    await fake.setMode('down')
    const app = await launch({ agoMs: 31 * DAY })
    const { page } = app
    await expectVisible(page.getByRole('heading', { name: 'Sin conexión con el servidor' }))
    await expectCount(modeNav(page), 0)
    await shot(page, 'acceso-sin-conexion')
    // Sigue caído: «Reintentar» no abre.
    await page.getByTestId('account-retry').click()
    await page.waitForTimeout(1000)
    await expectVisible(page.getByRole('heading', { name: 'Sin conexión con el servidor' }))
    await fake.setMode('normal')
    await page.getByTestId('account-retry').click()
    await expectVisible(modeNav(page), 30_000)
  })
})

describe('Ajustes › Cuenta', () => {
  it('(5) cerrar sesión: vuelve al acceso, avisa al servidor y borra la sesión local', async () => {
    const app = await launch()
    const { page } = app
    await expectVisible(modeNav(page))
    const { token } = sessionOf(app.userData)
    await openAccountSettings(page)
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expectVisible(gate(page))
    await expectCount(modeNav(page), 0)
    expect(existsSync(sessionFile(app.userData))).toBe(false)
    const logout = await fake.requests('/v1/logout')
    expect(logout).toHaveLength(1)
    expect(logout[0].hasAuth).toBe(true)
    // El token ya no sirve en el servidor.
    const me = await fetch(`${fake.url}/v1/me`, { headers: { authorization: `Bearer ${token}` } })
    expect(me.status).toBe(401)
  })

  it('(6) descargar mis datos y borrar mi cuenta (sin tocar las claves de IA)', async () => {
    const app = await launch()
    const { page } = app
    await expectVisible(modeNav(page))
    const out = join(newDir(), 'mis-datos.json')
    await stubDialog(app.electronApp, { savePath: out })
    await openAccountSettings(page)
    await page.getByRole('button', { name: 'Descargar mis datos' }).click()
    await expect.poll(() => existsSync(out), { timeout: 10_000 }).toBe(true)
    const exported = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>
    expect(exported.email).toBe('sembrada@example.test')
    expect(JSON.stringify(exported)).not.toContain(sessionOf(app.userData).token)
    expect((await dialogCalls(app.electronApp)).some((c) => c.kind === 'save')).toBe(true)

    // Las «claves de IA» viven en userData/opencode-data: una marca propia debe sobrevivir al borrado de la cuenta.
    const keyFile = join(app.userData, 'opencode-data', 'opencode', 'auth.json')
    mkdirSync(join(app.userData, 'opencode-data', 'opencode'), { recursive: true })
    writeFileSync(keyFile, JSON.stringify({ 'opencode-go': { type: 'api', key: 'sk-e2e-no-tocar' } }))

    await page.getByRole('button', { name: 'Borrar mi cuenta' }).click()
    const dlg = page.getByRole('alertdialog')
    await expectVisible(dlg.getByText('¿Borrar tu cuenta?'))
    await shot(page, 'ajustes-borrar-cuenta')
    await dlg.getByRole('button', { name: 'Borrar mi cuenta' }).click()
    await expectVisible(gate(page), 30_000)
    await expectCount(modeNav(page), 0)
    expect(existsSync(sessionFile(app.userData))).toBe(false)
    expect((await fake.state()).users.find((u) => u.email === 'sembrada@example.test')?.deleted).toBe(true)
    expect(readFileSync(keyFile, 'utf8')).toContain('sk-e2e-no-tocar')
  })
})

describe('Quick Entry y la cuenta', () => {
  const quickVisible = async (app: E2EApp): Promise<boolean> =>
    (await listWindows(app.electronApp)).some((w) => isQuickUrl(w.url) && w.visible)
  const toggle = (app: E2EApp): Promise<unknown> =>
    app.page.evaluate(() =>
      (window as unknown as { api: { extras: { invoke: (c: string) => Promise<unknown> } } }).api.extras.invoke('extras:quickToggle')
    )

  it('(7) sin sesión Quick Entry no se abre; con sesión sí', async () => {
    const app = await launch({ signedIn: false })
    await expectVisible(gate(app.page))
    await toggle(app)
    await app.page.waitForTimeout(1500)
    expect(await quickVisible(app)).toBe(false)

    await emailLogin(app.page, 'quick@ejemplo.test')
    await expectVisible(modeNav(app.page), 30_000)
    await toggle(app)
    await expect.poll(() => quickVisible(app), { timeout: 15_000 }).toBe(true)
  })
})
