// Actualizador propio: descarga + verificación contra un servidor local que imita las releases de GitHub (manifiesto firmado,
// firma, ZIP y una redirección 302 a un «CDN»). NUNCA se sustituye ninguna app: la app de E2E no está empaquetada, así que
// «Reiniciar ahora» se rechaza. `ONYXCODE_TEST_UPDATE_PUBKEY` y `ONYXCODE_TEST_UPDATE_INSTALL_DIR` solo se honran sin empaquetar.
// Capturas claro/oscuro: UPDATE_SHOTS_DIR=/ruta
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { startApp, type E2EApp } from '../lib/launch'
import { startReleasesServer, type ReleasesServer } from '../lib/releases-server'
import { buildFixture, FIXTURE_REPO, FIXTURE_VERSION, newKeys, type Fixture, type FixtureOptions } from '../lib/update-fixtures'
import { expectCount, expectVisible } from '../lib/wait'

const SHOTS = process.env.UPDATE_SHOTS_DIR
const keys = newKeys()
const apps: E2EApp[] = []
const servers: ReleasesServer[] = []
const dirs: string[] = []
const fixtures: Fixture[] = []

const newDir = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-inst-')))
  dirs.push(d)
  return d
}
const newServer = async (): Promise<ReleasesServer> => {
  const s = await startReleasesServer(FIXTURE_REPO)
  servers.push(s)
  return s
}
const fixture = (o: FixtureOptions = {}): Fixture => {
  const f = buildFixture(keys, o)
  fixtures.push(f)
  return f
}

/** Publica los archivos de una versión en el servidor local (con el ZIP detrás de una redirección 302 si `redirect`). */
function publish(
  srv: ReleasesServer,
  f: Fixture,
  o: { redirect?: boolean; holdAfter?: number; omitZip?: boolean; redirectTo?: string } = {}
): void {
  srv.setRelease(f.tag)
  srv.setAsset(`${f.base}/update.json`, { body: f.manifest })
  srv.setAsset(`${f.base}/update.json.sig`, { body: Buffer.from(f.sig) })
  if (o.omitZip) return
  const zipPath = `${f.base}/${f.zipName}`
  if (o.redirectTo) srv.setAsset(zipPath, { redirectTo: o.redirectTo })
  else if (o.redirect) {
    srv.setAsset(zipPath, { redirectTo: `/cdn/${f.zipName}` })
    srv.setAsset(`/cdn/${f.zipName}`, { body: f.zip, holdAfter: o.holdAfter })
  } else srv.setAsset(zipPath, { body: f.zip, holdAfter: o.holdAfter })
}

interface LaunchOpts {
  installDir?: string | null
  withKey?: boolean
  userData?: string
}
async function launch(srv: ReleasesServer, o: LaunchOpts = {}): Promise<E2EApp & { installDir: string }> {
  const installDir = o.installDir ?? newDir()
  const env: Record<string, string> = {
    ONYXCODE_TEST_UPDATE_DELAY_MS: '200',
    ONYXCODE_TEST_RELEASES_API: srv.url,
    ONYXCODE_TEST_RELEASES_REPO: FIXTURE_REPO,
    ONYXCODE_TEST_UPDATE_INSTALL_DIR: installDir
  }
  if (o.withKey !== false) env.ONYXCODE_TEST_UPDATE_PUBKEY = keys.publicKey
  const app = await startApp({ userData: o.userData ?? newDir(), keepUserData: true, env })
  apps.push(app)
  return Object.assign(app, { installDir })
}
async function stopApp(app: E2EApp): Promise<void> {
  apps.splice(apps.indexOf(app), 1)
  await app.stop()
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  // En Acerca de, la fila de la actualización es la última: se trae a la vista antes de capturar.
  if (await page.getByTestId('update-status').count()) {
    await page.evaluate(() => {
      for (const e of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        if (e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY !== 'visible') e.scrollTop = e.scrollHeight
      }
    })
  }
  mkdirSync(SHOTS, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: null })
}

const notice = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('update-notice')
const phase = (page: Page): Promise<string | null> =>
  notice(page)
    .getAttribute('data-phase', { timeout: 1000 })
    .catch(() => null)
async function waitPhase(page: Page, want: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => phase(page), { timeout, message: `fase ${want}` }).toBe(want)
}
const noticeText = (page: Page): Promise<string> => notice(page).innerText()
const button = (page: Page, name: string): ReturnType<Page['getByRole']> => notice(page).getByRole('button', { name, exact: true })

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
async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

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

const stagingDir = (app: E2EApp): string => join(app.userData, 'update', 'staging', FIXTURE_VERSION)
const installDirEmpty = (dir: string): boolean => readdirSync(dir).length === 0

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
})
afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  for (const s of servers.splice(0)) await s.close()
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(d, 0o755)
    } catch {
      /* ya no existe */
    }
    rmSync(d, { recursive: true, force: true })
  }
  for (const f of fixtures.splice(0)) f.dispose()
})

describe('actualizador propio', () => {
  it('(1) descarga (con redirección 302) hasta «Lista para reiniciar» SIN reemplazar nada; «Reiniciar ahora» se rechaza sin empaquetar', async () => {
    const srv = await newServer()
    const f = fixture()
    publish(srv, f, { redirect: true })
    const app = await launch(srv)
    await expectVisible(button(app.page, 'Actualizar'))
    expect(await noticeText(app.page)).toContain(`Hay una versión nueva de OnyxCode (${FIXTURE_VERSION}).`)
    await shot(app.page, 'instalador-1-aviso')

    await button(app.page, 'Actualizar').click()
    await waitPhase(app.page, 'ready')
    expect(await noticeText(app.page)).toContain(`OnyxCode ${FIXTURE_VERSION} está lista: reinicia para terminar de actualizar.`)
    await expectVisible(button(app.page, 'Reiniciar ahora'))
    await shot(app.page, 'instalador-4-lista')

    // Peticiones: manifiesto, firma, ZIP (redirigido al «CDN») y ninguna con credenciales.
    const paths = srv.assetRequests().map((r) => r.url)
    expect(paths).toEqual([`${f.base}/update.json`, `${f.base}/update.json.sig`, `${f.base}/${f.zipName}`, `/cdn/${f.zipName}`])
    for (const r of srv.assetRequests()) {
      expect(r.headers.authorization).toBeUndefined()
      expect(r.headers.cookie).toBeUndefined()
    }
    // Nada se instaló: la carpeta de instalación sigue vacía y la app verificada espera en el staging (0700).
    expect(installDirEmpty(app.installDir)).toBe(true)
    expect(existsSync(join(stagingDir(app), 'extract', 'OnyxCode.app', 'Contents', 'Info.plist'))).toBe(true)

    await openAbout(app.page)
    await expectVisible(app.page.getByText('Solo descarga cuando pulsas Actualizar.', { exact: false }))
    await expect(app.page.getByTestId('update-current').innerText()).resolves.toMatch(/^v\d/)
    await expectVisible(app.page.getByText('Estable', { exact: true }))
    await expectVisible(app.page.getByTestId('update-status').getByText(`está lista`, { exact: false }))
    await shot(app.page, 'instalador-6-acerca-lista')
    await closeSettings(app.page)

    // La app de E2E no está empaquetada: reiniciar se rechaza y no toca nada.
    await button(app.page, 'Reiniciar ahora').click()
    await waitPhase(app.page, 'error')
    expect(await noticeText(app.page)).toContain('Esta copia de la app no se puede actualizar sola desde aquí.')
    expect(installDirEmpty(app.installDir)).toBe(true)
    await shot(app.page, 'instalador-5-error-reinicio')
    // «Reintentar» vuelve a descargar y verificar.
    await button(app.page, 'Reintentar').click()
    await waitPhase(app.page, 'ready')
    await stopApp(app)
  })

  it('(2) descarga a medias: porcentaje, «Cancelar» y vuelve a ofrecer «Actualizar»', async () => {
    const srv = await newServer()
    const f = fixture({ padding: 4 * 1024 * 1024 })
    publish(srv, f, { holdAfter: Math.floor(f.zip.length / 2) })
    const app = await launch(srv)
    await expectVisible(button(app.page, 'Actualizar'))
    await button(app.page, 'Actualizar').click()
    await waitPhase(app.page, 'downloading')
    await expect
      .poll(
        async () =>
          Number(
            /^(\d+) %$/.exec(
              await app.page
                .getByTestId('update-percent')
                .innerText()
                .catch(() => '')
            )?.[1] ?? 0
          ),
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0)
    expect(await noticeText(app.page)).toContain(`Descargando OnyxCode ${FIXTURE_VERSION}…`)
    await expectVisible(app.page.getByRole('progressbar').first())
    await shot(app.page, 'instalador-2-descargando')
    await openAbout(app.page)
    await expectVisible(app.page.getByTestId('update-status').getByText('Descargando', { exact: false }))
    await shot(app.page, 'instalador-6-acerca-descargando')
    await closeSettings(app.page)

    await button(app.page, 'Cancelar').click()
    await expectVisible(button(app.page, 'Actualizar'))
    srv.release()
    await expect.poll(() => existsSync(stagingDir(app))).toBe(false)
    expect(installDirEmpty(app.installDir)).toBe(true)
    await stopApp(app)
  })

  it.each([
    ['firma inválida', { badSignature: true }, /comprobación de autenticidad/, false],
    ['hash distinto', { wrongHash: true }, /no coincide con lo publicado/, true],
    ['manifiesto antiguo repetido (firmado pero de otra versión)', { manifestVersion: '0.0.5' }, /paquete descargado no es válido/, false],
    ['Info.plist con versión menor que la firmada (downgrade)', { plistVersion: '0.0.5' }, /no es más nueva/, true],
    ['ZIP con entrada ../', { traversalZip: true }, /paquete descargado no es válido/, true]
  ] satisfies Array<[string, FixtureOptions, RegExp, boolean]>)(
    '(3) %s: error, nada instalado, «Descargar manualmente»',
    async (_n, opts, text, zipRequested) => {
      const srv = await newServer()
      const f = fixture(opts)
      publish(srv, f)
      const app = await launch(srv)
      await expectVisible(button(app.page, 'Actualizar'))
      await button(app.page, 'Actualizar').click()
      await waitPhase(app.page, 'error')
      expect(await noticeText(app.page)).toMatch(text)
      await expectVisible(button(app.page, 'Descargar manualmente'))
      await expectVisible(button(app.page, 'Reintentar'))
      // La firma inválida o el manifiesto repetido se descartan ANTES de pedir el ZIP.
      expect(srv.assetRequests().some((r) => r.url.endsWith('.zip'))).toBe(zipRequested)
      expect(installDirEmpty(app.installDir)).toBe(true)
      expect(existsSync(join(stagingDir(app), 'extract', 'OnyxCode.app'))).toBe(false)
      if (opts.badSignature) await shot(app.page, 'instalador-5-error')
      await stopApp(app)
    }
  )

  it('(4) error de red (servidor caído) y redirección a un host no permitido', async () => {
    const srv = await newServer()
    const f = fixture()
    publish(srv, f)
    const app = await launch(srv)
    await expectVisible(button(app.page, 'Actualizar'))
    await srv.close()
    await button(app.page, 'Actualizar').click()
    await waitPhase(app.page, 'error')
    expect(await noticeText(app.page)).toContain('No se pudo descargar la actualización. Revisa tu conexión.')
    await stopApp(app)

    const evil = await newServer()
    const g = fixture()
    publish(evil, g, { redirectTo: 'https://evil.example/OnyxCode.zip' })
    const app2 = await launch(evil)
    await expectVisible(button(app2.page, 'Actualizar'))
    await button(app2.page, 'Actualizar').click()
    await waitPhase(app2.page, 'error')
    expect(await noticeText(app2.page)).toContain('No se pudo descargar la actualización.')
    expect(evil.assetRequests().map((r) => r.url)).not.toContain('https://evil.example/OnyxCode.zip')
    await stopApp(app2)
  })

  it('(5) carpeta sin permiso de escritura: se degrada a «Descargar» (comportamiento de siempre)', async () => {
    const srv = await newServer()
    const f = fixture()
    publish(srv, f)
    const ro = newDir()
    chmodSync(ro, 0o555)
    const app = await launch(srv, { installDir: ro })
    await expectVisible(notice(app.page))
    await expectVisible(button(app.page, 'Descargar'))
    await expectCount(button(app.page, 'Actualizar'), 0)
    await stubOpenExternal(app)
    await button(app.page, 'Descargar').click()
    await expect.poll(() => opened(app)).toEqual([`https://github.com/${FIXTURE_REPO}/releases/tag/${f.tag}`])
    await openAbout(app.page)
    await expectCount(app.page.getByTestId('update-actions').getByRole('button', { name: 'Actualizar', exact: true }), 0)
    await shot(app.page, 'instalador-7-acerca-sin-permiso')
    expect(srv.assetRequests()).toHaveLength(0)
    await stopApp(app)
    chmodSync(ro, 0o755)
  })

  it('(6) sin clave pública configurada: sin «Actualizar» y sin peticiones de archivos', async () => {
    const srv = await newServer()
    const f = fixture()
    publish(srv, f)
    const app = await launch(srv, { withKey: false })
    await expectVisible(button(app.page, 'Descargar'))
    await expectCount(button(app.page, 'Actualizar'), 0)
    expect(srv.assetRequests()).toHaveLength(0)
    await stopApp(app)
  })

  it('(7) aviso con «Actualizar» en Acerca de: «Actualizar» desde ajustes', async () => {
    const srv = await newServer()
    const f = fixture()
    publish(srv, f)
    const app = await launch(srv)
    await expectVisible(button(app.page, 'Actualizar'))
    await openAbout(app.page)
    const status = app.page.getByTestId('update-status')
    await expectVisible(status)
    await shot(app.page, 'instalador-6-acerca-oferta')
    const actions = app.page.getByTestId('update-actions')
    await actions.getByRole('button', { name: 'Actualizar', exact: true }).click()
    await expect.poll(() => status.getAttribute('data-phase'), { timeout: 30_000 }).toBe('ready')
    await expectVisible(actions.getByRole('button', { name: 'Reiniciar ahora', exact: true }))
    await stopApp(app)
  })
})
