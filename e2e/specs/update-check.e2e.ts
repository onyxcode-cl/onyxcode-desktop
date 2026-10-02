// Aviso de versión nueva: contra un servidor local que imita la API de releases de GitHub (nunca contra api.github.com).
// `ONYXCODE_TEST_RELEASES_API` solo se honra en la app sin empaquetar. Capturas: UPDATE_SHOTS_DIR=/ruta.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { startApp, type E2EApp } from '../lib/launch'
import { closedPortUrl, startReleasesServer, type ReleasesServer } from '../lib/releases-server'
import { expectCount, expectVisible } from '../lib/wait'

const SHOTS = process.env.UPDATE_SHOTS_DIR
const REPO = 'test-owner/test-repo'
// En los E2E (electron con `out/main/index.js`) `app.getVersion()` es la de Electron, no la de package.json:
// se lee de la propia app y las «versiones nuevas» de las pruebas son 99.x.
async function appVersion(app: E2EApp): Promise<string> {
  return app.page.evaluate(async () => {
    const r = await (window as unknown as { api: { invoke: (c: string) => Promise<{ data: { version: string } }> } }).api.invoke('app:info')
    return r.data.version
  })
}

const apps: E2EApp[] = []
const servers: ReleasesServer[] = []
const dirs: string[] = []

const newDir = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-upd-')))
  dirs.push(d)
  return d
}
const newServer = async (): Promise<ReleasesServer> => {
  const s = await startReleasesServer(REPO)
  servers.push(s)
  return s
}

async function launch(
  api: string | null,
  o: { userData?: string; settings?: Record<string, unknown>; repo?: string | null } = {}
): Promise<E2EApp> {
  const env: Record<string, string> = { ONYXCODE_TEST_UPDATE_DELAY_MS: '200' }
  if (api) env.ONYXCODE_TEST_RELEASES_API = api
  if (o.repo !== null) env.ONYXCODE_TEST_RELEASES_REPO = o.repo ?? REPO
  const app = await startApp({ userData: o.userData ?? newDir(), keepUserData: true, env, settings: o.settings })
  apps.push(app)
  return app
}

async function stopApp(app: E2EApp): Promise<void> {
  apps.splice(apps.indexOf(app), 1)
  await app.stop()
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: null })
}

const notice = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('update-notice')

async function openAbout(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,')
  const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
  await expectVisible(nav)
  await nav.getByRole('button', { name: 'Acerca de', exact: true }).click()
  const title = page.getByText('Actualizaciones', { exact: true })
  await expectVisible(title)
  await title.scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Buscar ahora' }).scrollIntoViewIfNeeded()
}

/** Sustituye shell.openExternal en main para registrar las URLs en vez de abrirlas. */
async function stubOpenExternal(app: E2EApp): Promise<void> {
  await app.electronApp.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] }
    g.__opened = []
    shell.openExternal = async (u: string) => {
      g.__opened.push(u)
    }
  })
}
const opened = (app: E2EApp): Promise<string[]> =>
  app.electronApp.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
})

afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  for (const s of servers.splice(0)) await s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('aviso de versión nueva', () => {
  it('(1) sin repositorio configurado: 0 peticiones y ningún aviso', async () => {
    const srv = await newServer()
    srv.setRelease('v99.9.9')
    const app = await launch(srv.url, { repo: null })
    await app.page.waitForTimeout(2000)
    expect(srv.requests).toHaveLength(0)
    await expectCount(notice(app.page), 0)
    await openAbout(app.page)
    await expectVisible(app.page.getByText('Esta compilación no tiene configurado dónde buscar versiones nuevas.'))
    expect(await app.page.getByRole('button', { name: 'Buscar ahora' }).isDisabled()).toBe(true)
    await shot(app.page, 'acerca-sin-configurar')
    await stopApp(app)
  })

  it('(2) versión nueva: aviso, petición correcta y «Descargar» abre la página de la release', async () => {
    const srv = await newServer()
    srv.setRelease('v99.9.9')
    const app = await launch(srv.url)
    await stubOpenExternal(app)
    await expectVisible(notice(app.page))
    await expect(notice(app.page).innerText()).resolves.toContain('Hay una versión nueva de OnyxCode (99.9.9).')
    await shot(app.page, 'aviso')

    expect(srv.requests).toHaveLength(1)
    const req = srv.requests[0]
    expect(req.method).toBe('GET')
    expect(req.url).toBe(`/repos/${REPO}/releases/latest`)
    expect(req.headers['user-agent']).toBe(`OnyxCode/${await appVersion(app)}`)
    expect(req.headers.accept).toBe('application/vnd.github+json')
    expect(req.headers['x-github-api-version']).toBe('2022-11-28')
    expect(req.headers.cookie).toBeUndefined()
    expect(req.headers.authorization).toBeUndefined()

    await notice(app.page).getByRole('button', { name: 'Descargar' }).click()
    await expect.poll(() => opened(app)).toEqual([`https://github.com/${REPO}/releases/tag/v99.9.9`])
    await openAbout(app.page)
    await expectVisible(app.page.getByText(/Última comprobación: \d/))
    await shot(app.page, 'acerca-con-aviso')
    await stopApp(app)
  })

  it('(3) html_url maliciosa: se abre la URL de reserva de github.com', async () => {
    const srv = await newServer()
    srv.setRelease('v99.9.9', { html_url: 'https://evil.example/x' })
    const app = await launch(srv.url)
    await stubOpenExternal(app)
    await expectVisible(notice(app.page))
    await notice(app.page).getByRole('button', { name: 'Descargar' }).click()
    await expect.poll(() => opened(app)).toEqual([`https://github.com/${REPO}/releases/tag/v99.9.9`])
    await stopApp(app)
  })

  it('(4) «Más tarde» persiste; al reiniciar no hay petición (24 h); «Buscar ahora» con una versión mayor lo vuelve a mostrar', async () => {
    const srv = await newServer()
    srv.setRelease('v99.9.9')
    const userData = newDir()
    const app = await launch(srv.url, { userData })
    await expectVisible(notice(app.page))
    await notice(app.page).getByRole('button', { name: 'Más tarde' }).click()
    await expectCount(notice(app.page), 0)
    await stopApp(app)
    expect(srv.requests).toHaveLength(1)

    const again = await launch(srv.url, { userData })
    await again.page.waitForTimeout(2000)
    expect(srv.requests).toHaveLength(1)
    await expectCount(notice(again.page), 0)

    // Misma versión con «Buscar ahora»: sigue descartada.
    await openAbout(again.page)
    await again.page.getByRole('button', { name: 'Buscar ahora' }).click()
    await expectVisible(again.page.getByTestId('update-result'))
    expect(srv.requests).toHaveLength(2)
    await expectCount(notice(again.page), 0)

    srv.setRelease('v99.9.10')
    await again.page.getByRole('button', { name: 'Buscar ahora' }).click()
    await expectVisible(notice(again.page))
    await expect(notice(again.page).innerText()).resolves.toContain('(99.9.10)')
    await expect(again.page.getByTestId('update-result').innerText()).resolves.toBe('Hay una versión nueva: 99.9.10')
    expect(srv.requests).toHaveLength(3)
    await stopApp(again)
  })

  it('(4b) «Buscar ahora» al día: «Tienes la última versión.»', async () => {
    const srv = await newServer()
    const app = await launch(srv.url)
    srv.setRelease(`v${await appVersion(app)}`)
    await expect.poll(() => srv.requests.length).toBe(1)
    await openAbout(app.page)
    await app.page.getByRole('button', { name: 'Buscar ahora' }).click()
    await expect(app.page.getByTestId('update-result').innerText()).resolves.toBe('Tienes la última versión.')
    await shot(app.page, 'acerca-al-dia')
    await stopApp(app)
  })

  it('(5) ajuste desactivado: 0 peticiones', async () => {
    const srv = await newServer()
    srv.setRelease('v99.9.9')
    const app = await launch(srv.url, { settings: { checkUpdates: false } })
    await app.page.waitForTimeout(2000)
    expect(srv.requests).toHaveLength(0)
    await expectCount(notice(app.page), 0)
    await openAbout(app.page)
    await expect(
      app.page.getByRole('switch', { name: 'Buscar actualizaciones automáticamente' }).getAttribute('aria-checked')
    ).resolves.toBe('false')
    await stopApp(app)
  })

  it('(5b) activar el ajuste en caliente dispara la comprobación', async () => {
    const srv = await newServer()
    srv.setRelease('v99.9.9')
    const app = await launch(srv.url, { settings: { checkUpdates: false } })
    await app.page.waitForTimeout(1000)
    expect(srv.requests).toHaveLength(0)
    await openAbout(app.page)
    await app.page.getByRole('switch', { name: 'Buscar actualizaciones automáticamente' }).click()
    await expectVisible(notice(app.page))
    expect(srv.requests).toHaveLength(1)
    await stopApp(app)
  })

  it('(6) error de red, 500 y 429: sin aviso y sin errores', async () => {
    const dead = await closedPortUrl()
    const a = await launch(dead)
    await a.page.waitForTimeout(2000)
    await expectCount(notice(a.page), 0)
    await openAbout(a.page)
    await a.page.getByRole('button', { name: 'Buscar ahora' }).click()
    await expect(a.page.getByTestId('update-result').innerText()).resolves.toBe('No se pudo comprobar ahora. Inténtalo más tarde.')
    await shot(a.page, 'acerca-error')
    await a.assertClean('red')
    await stopApp(a)

    for (const r of [
      { status: 500, body: 'boom' },
      { status: 429, headers: { 'retry-after': '7200' }, body: { message: 'rate limit' } }
    ]) {
      const srv = await newServer()
      srv.setResponse(r)
      const app = await launch(srv.url)
      await expect.poll(() => srv.requests.length).toBe(1)
      await app.page.waitForTimeout(500)
      await expectCount(notice(app.page), 0)
      await openAbout(app.page)
      // La espera por error (retryAfter) también frena «Buscar ahora»: no hay segunda petición.
      await app.page.getByRole('button', { name: 'Buscar ahora' }).click()
      await expect(app.page.getByTestId('update-result').innerText()).resolves.toBe('No se pudo comprobar ahora. Inténtalo más tarde.')
      expect(srv.requests).toHaveLength(1)
      await app.assertClean(`http-${r.status}`)
      await stopApp(app)
    }
  })
})
