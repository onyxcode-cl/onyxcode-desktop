// Sin cuenta ni inicio de sesión: la app abre directo, Quick Entry funciona y el arranque borra la sesión heredada
// (`account.bin(.tmp)` / `account.test.json(.tmp)`) de userData sin tocar ningún otro archivo (`legacy-account-cleanup`).
// La bandeja no se puede inspeccionar desde Playwright: su cableado lo cubre `src/main/extras/quick-entry-tray.test.ts`.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isQuickUrl, listWindows } from '../lib/instance'
import { startApp, type E2EApp } from '../lib/launch'
import { expectCount, expectVisible } from '../lib/wait'

const apps: E2EApp[] = []
const dirs: string[] = []

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
  for (const a of apps.splice(0)) await a.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function newDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-sin-cuenta-')))
  dirs.push(d)
  return d
}

const modeNav = (app: E2EApp): ReturnType<E2EApp['page']['locator']> => app.page.locator('nav[aria-label="Modo"]')

describe('sin cuenta', () => {
  it('abre directo: sin pantalla de acceso, sin sección Cuenta y sin canales account:*', async () => {
    const app = await startApp({ keepUserData: false })
    apps.push(app)
    const { page } = app
    await expectVisible(modeNav(app))
    await expectCount(page.getByTestId('account-gate'), 0)
    await page.keyboard.press('ControlOrMeta+,')
    const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
    await expectVisible(nav)
    await expectCount(nav.getByRole('button', { name: 'Cuenta', exact: true }), 0)
    // `window.api.invoke` es `invokeRaw`: un canal que el preload no conoce RESPONDE `{ok:false, code:'FORBIDDEN'}` (no lanza).
    const res = await page.evaluate(async () => {
      const api = (window as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api
      try {
        return { resolved: await api.invoke('account:state') }
      } catch (e) {
        return { thrown: String((e as Error).message ?? e) }
      }
    })
    const r = res as { resolved?: { ok?: boolean; code?: string; error?: string }; thrown?: string }
    expect(r.thrown).toBeUndefined()
    expect(r.resolved?.ok).toBe(false)
    expect(r.resolved?.code).toBe('FORBIDDEN')
    expect(r.resolved?.error).toContain('Canal IPC no permitido')
  })

  it('Quick Entry se abre sin ninguna puerta de acceso', async () => {
    const app = await startApp({ keepUserData: false })
    apps.push(app)
    await expectVisible(modeNav(app))
    await app.page.evaluate(() =>
      (window as unknown as { api: { extras: { invoke: (c: string) => Promise<unknown> } } }).api.extras.invoke('extras:quickToggle')
    )
    await expect
      .poll(async () => (await listWindows(app.electronApp)).some((w) => isQuickUrl(w.url) && w.visible), { timeout: 15_000 })
      .toBe(true)
  })

  it('una sesión heredada se borra al arrancar y no se toca nada más', async () => {
    const userData = newDir()
    const legacy = ['account.bin', 'account.bin.tmp', 'account.test.json', 'account.test.json.tmp']
    for (const f of legacy) writeFileSync(join(userData, f), 'sesion-heredada-de-prueba')
    writeFileSync(join(userData, 'sentinel.txt'), 'no me toques')
    writeFileSync(join(userData, 'account.backup'), 'nombre parecido, no es de la lista')

    const app = await startApp({ userData, keepUserData: true })
    apps.push(app)
    await expectVisible(modeNav(app))
    for (const f of legacy) expect(existsSync(join(userData, f)), f).toBe(false)
    expect(readFileSync(join(userData, 'sentinel.txt'), 'utf8')).toBe('no me toques')
    expect(existsSync(join(userData, 'account.backup'))).toBe(true)
    expect(existsSync(join(userData, 'settings.json'))).toBe(true)
  })
})
