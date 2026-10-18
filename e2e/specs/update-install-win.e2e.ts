// Actualizador propio en WINDOWS (análogo de update-install.e2e.ts). SOLO corre en win32: en macOS/Linux todo el archivo se salta.
// Servidor local que imita las releases de GitHub (update-win32-x64.json + .sig + ZIP detrás de una 302) con un paquete de juguete
// armado por scripts/publish-update.mjs (--platform win32-x64) y una clave Ed25519 EFÍMERA (LAZUNOX_TEST_UPDATE_PUBKEY).
// La app de E2E no está empaquetada: descarga, verifica y extrae con el tar.exe REAL, pero «Reiniciar ahora» se rechaza y nunca se
// sustituye ninguna app. El reemplazo real se prueba aparte con resources\updater\swap.ps1 en su modo de prueba
// (LAZUNOX_SWAP_TEST_NO_OPEN=1, que el propio script solo acepta bajo la carpeta de pruebas del PC o %TEMP%), sobre copias del staging verificado y un
// «ejecutable» que es una copia de ping.exe. Lo ejecuta el dueño en el PC: scripts\win\update-e2e.ps1 (docs/DISTRIBUCION.md §12).
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { startApp, type E2EApp } from '../lib/launch'
import { startReleasesServer, type ReleasesServer } from '../lib/releases-server'
import {
  buildWinFixture,
  FIXTURE_REPO,
  FIXTURE_VERSION,
  newKeys,
  type WinFixture,
  type WinFixtureOptions
} from '../lib/update-fixtures-win'
import { expectVisible } from '../lib/wait'

const IS_WIN = process.platform === 'win32'
const keys = newKeys()
const apps: E2EApp[] = []
const servers: ReleasesServer[] = []
const dirs: string[] = []
const fixtures: WinFixture[] = []

const newDir = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-e2e-inst-')))
  dirs.push(d)
  return d
}
const newServer = async (): Promise<ReleasesServer> => {
  const s = await startReleasesServer(FIXTURE_REPO)
  servers.push(s)
  return s
}
const fixture = async (o: WinFixtureOptions = {}): Promise<WinFixture> => {
  const f = await buildWinFixture(keys, o)
  fixtures.push(f)
  return f
}

function publish(srv: ReleasesServer, f: WinFixture, o: { redirect?: boolean; redirectTo?: string } = {}): void {
  srv.setRelease(f.tag)
  srv.setAsset(`${f.base}/${f.manifestName}`, { body: f.manifest })
  srv.setAsset(`${f.base}/${f.sigName}`, { body: Buffer.from(f.sig) })
  const zipPath = `${f.base}/${f.zipName}`
  if (o.redirectTo) srv.setAsset(zipPath, { redirectTo: o.redirectTo })
  else if (o.redirect) {
    srv.setAsset(zipPath, { redirectTo: `/cdn/${f.zipName}` })
    srv.setAsset(`/cdn/${f.zipName}`, { body: f.zip })
  } else srv.setAsset(zipPath, { body: f.zip })
}

/** La carpeta de instalación de prueba se llama «Lazunox» (como la real) y cuelga de una carpeta temporal propia. */
const newInstallDir = (): string => {
  const parent = newDir()
  const d = join(parent, 'Programs', 'Lazunox')
  mkdirSync(d, { recursive: true })
  return d
}

async function launch(srv: ReleasesServer, o: { installDir?: string; withKey?: boolean } = {}): Promise<E2EApp & { installDir: string }> {
  const installDir = o.installDir ?? newInstallDir()
  const env: Record<string, string> = {
    LAZUNOX_TEST_UPDATE_DELAY_MS: '200',
    LAZUNOX_TEST_RELEASES_API: srv.url,
    LAZUNOX_TEST_RELEASES_REPO: FIXTURE_REPO,
    LAZUNOX_TEST_UPDATE_INSTALL_DIR: installDir
  }
  if (o.withKey !== false) env.LAZUNOX_TEST_UPDATE_PUBKEY = keys.publicKey
  const app = await startApp({ userData: newDir(), keepUserData: true, env })
  apps.push(app)
  return Object.assign(app, { installDir })
}
async function stopApp(app: E2EApp): Promise<void> {
  apps.splice(apps.indexOf(app), 1)
  await app.stop()
}

const notice = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('update-notice')
const phase = (page: Page): Promise<string | null> =>
  notice(page)
    .getAttribute('data-phase', { timeout: 1000 })
    .catch(() => null)
async function waitPhase(page: Page, want: string, timeout = 60_000): Promise<void> {
  await expect.poll(() => phase(page), { timeout, message: `fase ${want}` }).toBe(want)
}
const noticeText = (page: Page): Promise<string> => notice(page).innerText()
const button = (page: Page, name: string): ReturnType<Page['getByRole']> => notice(page).getByRole('button', { name, exact: true })

/** Staging verificado: carpeta hermana de la instalación (`.Lazunox.staging-<versión>`), para que el swap sea un renombrado en el mismo volumen. */
const stagingOf = (installDir: string, version = FIXTURE_VERSION): string => join(installDir, '..', `.Lazunox.staging-${version}`)
const installDirEmpty = (dir: string): boolean => readdirSync(dir).length === 0
const readText = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8').trim() : null)

interface SwapResult {
  code: number
  parent: string
  target: string
  bak: string
  md: string
}
const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const PING = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'ping.exe')

/** Ejecuta resources\updater\swap.ps1 en su modo de prueba sobre una copia del staging verificado (nunca sobre una app real). */
async function runSwap(staged: string, version: string, o: { failBoot: boolean }): Promise<SwapResult> {
  const parent = newDir()
  const target = join(parent, 'Lazunox')
  const md = join(parent, 'ud', 'update')
  const run = join(parent, 'run')
  for (const d of [target, md, run]) mkdirSync(d, { recursive: true })
  // Instalación «antigua» de juguete: lo mismo que el juguete nuevo, pero con VERSION.txt = antigua.
  cpSync(staged, target, { recursive: true })
  writeFileSync(join(target, 'VERSION.txt'), 'antigua')
  cpSync(staged, join(parent, `.Lazunox.staging-${version}`), { recursive: true })
  cpSync(join(__dirname, '..', '..', 'resources', 'updater', 'swap.ps1'), join(run, 'swap.ps1'))
  // «App en ejecución» que se cierra sola a los 4 s (ping a 127.0.0.1).
  const old = spawn(PING, ['-n', '4', '127.0.0.1'], { stdio: 'ignore', windowsHide: true })
  const bak = join(parent, '.Lazunox.bak-0.0.1')
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    join(run, 'swap.ps1'),
    '-AppPid',
    String(old.pid),
    '-Target',
    target,
    '-Staged',
    join(parent, `.Lazunox.staging-${version}`),
    '-Bak',
    bak,
    '-MarkerDir',
    md,
    '-Version',
    version
  ]
  const env = {
    ...process.env,
    LAZUNOX_SWAP_TEST_NO_OPEN: '1',
    LAZUNOX_SWAP_WAIT_PID: '20',
    LAZUNOX_SWAP_WAIT_BOOT: o.failBoot ? '6' : '30',
    LAZUNOX_SWAP_TEST_EXEC: 'fake.exe'
  }
  const child = spawn(POWERSHELL, args, { env, stdio: 'ignore', windowsHide: true })
  // La app nueva «confirma» el arranque (boot-ok) a los 6 s, salvo que se pruebe el rollback.
  const confirm = o.failBoot ? null : setTimeout(() => writeFileSync(join(md, `boot-ok-${version}`), 'ok'), 6000)
  const code = await new Promise<number>((resolve) => {
    const kill = setTimeout(() => {
      spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      resolve(-999)
    }, 120_000)
    child.on('exit', (c) => {
      clearTimeout(kill)
      resolve(c ?? -1)
    })
  })
  if (confirm) clearTimeout(confirm)
  return { code, parent, target, bak, md }
}

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
})
afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  for (const s of servers.splice(0)) await s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  for (const f of fixtures.splice(0)) f.dispose()
})

// Salto: el actualizador de Windows (tar.exe, swap.ps1, NTFS) solo existe en Windows; el del Mac lo cubre update-install.e2e.ts.
describe.skipIf(!IS_WIN)('actualizador propio (Windows)', () => {
  it('(1) descarga con 302, extrae con tar.exe hasta «Lista para reiniciar» SIN reemplazar nada; «Reiniciar ahora» se rechaza sin empaquetar', async () => {
    const srv = await newServer()
    const f = await fixture()
    publish(srv, f, { redirect: true })
    const app = await launch(srv)
    await expectVisible(button(app.page, 'Actualizar'))
    expect(await noticeText(app.page)).toContain(`Hay una versión nueva de Lazunox (${FIXTURE_VERSION}).`)

    await button(app.page, 'Actualizar').click()
    await waitPhase(app.page, 'ready')
    expect(await noticeText(app.page)).toContain(`Lazunox ${FIXTURE_VERSION} está lista: reinicia para terminar de actualizar.`)

    const paths = srv.assetRequests().map((r) => r.url)
    expect(paths).toEqual([`${f.base}/${f.manifestName}`, `${f.base}/${f.sigName}`, `${f.base}/${f.zipName}`, `/cdn/${f.zipName}`])
    for (const r of srv.assetRequests()) {
      expect(r.headers.authorization).toBeUndefined()
      expect(r.headers.cookie).toBeUndefined()
    }
    // Nada se instaló; la app verificada espera en el staging hermano de la instalación.
    expect(installDirEmpty(app.installDir)).toBe(true)
    const staged = stagingOf(app.installDir)
    expect(existsSync(join(staged, 'Lazunox.exe'))).toBe(true)
    expect(existsSync(join(staged, 'resources', 'app.asar'))).toBe(true)
    expect(existsSync(join(staged, 'resources', 'opencode', 'opencode.exe'))).toBe(true)

    await button(app.page, 'Reiniciar ahora').click()
    await waitPhase(app.page, 'error')
    expect(await noticeText(app.page)).toContain('Esta copia de la app no se puede actualizar sola desde aquí.')
    expect(installDirEmpty(app.installDir)).toBe(true)
    await button(app.page, 'Reintentar').click()
    await waitPhase(app.page, 'ready')
    await stopApp(app)
  })

  it('(2) swap.ps1 en modo de prueba sobre el staging verificado: queda la versión nueva, la antigua en la copia', async () => {
    const srv = await newServer()
    const f = await fixture()
    publish(srv, f)
    const app = await launch(srv)
    await expectVisible(button(app.page, 'Actualizar'))
    await button(app.page, 'Actualizar').click()
    await waitPhase(app.page, 'ready')
    await stopApp(app)
    const r = await runSwap(stagingOf(app.installDir), '9.9.9', { failBoot: false })
    expect(r.code).toBe(0)
    const res = JSON.parse(readText(join(r.md, 'result.json')) ?? '{}') as { ok?: boolean; rolledBack?: boolean }
    expect(res).toMatchObject({ ok: true, rolledBack: false })
    expect(readText(join(r.target, 'VERSION.txt'))).toBe('nueva')
    expect(readText(join(r.bak, 'VERSION.txt'))).toBe('antigua')
    expect(existsSync(join(r.parent, '.Lazunox.staging-9.9.9'))).toBe(false)
  })

  it('(3) swap.ps1 sin confirmación de arranque: vuelve atrás y deja la fallida aparte', async () => {
    const srv = await newServer()
    const f = await fixture()
    publish(srv, f)
    const app = await launch(srv)
    await expectVisible(button(app.page, 'Actualizar'))
    await button(app.page, 'Actualizar').click()
    await waitPhase(app.page, 'ready')
    await stopApp(app)
    const r = await runSwap(stagingOf(app.installDir), '9.9.8', { failBoot: true })
    expect(r.code).not.toBe(0)
    expect(r.code).not.toBe(-999)
    const res = JSON.parse(readText(join(r.md, 'result.json')) ?? '{}') as { ok?: boolean; rolledBack?: boolean; error?: string }
    expect(res).toMatchObject({ ok: false, rolledBack: true, error: 'boot-timeout' })
    expect(readText(join(r.target, 'VERSION.txt'))).toBe('antigua')
    expect(readText(join(r.parent, '.Lazunox.failed-9.9.8', 'VERSION.txt'))).toBe('nueva')
  })

  it.each([
    ['firma inválida', { badSignature: true }, /comprobación de autenticidad/, false],
    ['hash distinto', { wrongHash: true }, /no coincide con lo publicado/, true],
    ['manifiesto antiguo repetido (firmado pero de otra versión)', { manifestVersion: '0.0.5' }, /paquete descargado no es válido/, false],
    ['app.asar con versión menor que la firmada (downgrade)', { asarVersion: '0.0.5' }, /no es más nueva/, true],
    ['ZIP con entrada ../', { traversalZip: true }, /paquete descargado no es válido/, true]
  ] satisfies Array<[string, WinFixtureOptions, RegExp, boolean]>)(
    '(4) %s: error, nada instalado, «Descargar manualmente»',
    async (_n, opts, text, zipRequested) => {
      const srv = await newServer()
      const f = await fixture(opts)
      publish(srv, f)
      const app = await launch(srv)
      await expectVisible(button(app.page, 'Actualizar'))
      await button(app.page, 'Actualizar').click()
      await waitPhase(app.page, 'error')
      expect(await noticeText(app.page)).toMatch(text)
      await expectVisible(button(app.page, 'Descargar manualmente'))
      await expectVisible(button(app.page, 'Reintentar'))
      expect(srv.assetRequests().some((r) => r.url.endsWith('.zip'))).toBe(zipRequested)
      expect(installDirEmpty(app.installDir)).toBe(true)
      expect(existsSync(join(stagingOf(app.installDir), 'Lazunox.exe'))).toBe(false)
      await stopApp(app)
    }
  )

  it('(5) redirección a un host no permitido: no se sigue', async () => {
    const evil = await newServer()
    const g = await fixture()
    publish(evil, g, { redirectTo: 'https://evil.example/Lazunox.zip' })
    const app = await launch(evil)
    await expectVisible(button(app.page, 'Actualizar'))
    await button(app.page, 'Actualizar').click()
    await waitPhase(app.page, 'error')
    expect(await noticeText(app.page)).toContain('No se pudo descargar la actualización.')
    expect(evil.assetRequests().map((r) => r.url)).not.toContain('https://evil.example/Lazunox.zip')
    await stopApp(app)
  })

  it('(6) sin clave pública configurada: sin «Actualizar» y sin peticiones de archivos', async () => {
    const srv = await newServer()
    const f = await fixture()
    publish(srv, f)
    const app = await launch(srv, { withKey: false })
    await expectVisible(button(app.page, 'Ver descarga'))
    expect(await button(app.page, 'Actualizar').count()).toBe(0)
    expect(srv.assetRequests()).toHaveLength(0)
    await stopApp(app)
  })
})
