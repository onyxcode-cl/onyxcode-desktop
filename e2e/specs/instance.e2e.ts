// Instancia única y Quick Entry contra la app real.
// LIMITE (modo headless, ONYXCODE_E2E_HEADLESS=1: opacidad 0, showInactive, sin foco ni Dock): las aserciones de FOCO real
// (que la ventana quede al frente/enfocada tras second-instance o al abrir Quick Entry, hide al perder foco) son HUMANAS.
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { findQuickPage, isMainUrl, isQuickUrl, listWindows, spawnSecondInstance } from '../lib/instance'
import { expectVisible } from '../lib/wait'

const app = useApp()

async function mainWindows(): Promise<ReturnType<typeof listWindows>> {
  return (await listWindows(app().electronApp)).filter((w) => !w.destroyed && isMainUrl(w.url))
}

describe(`instancia única y Quick Entry (${MODE})`, () => {
  it('segunda instancia con mismo userData sale sola en <5 s con código 0', async () => {
    const { electronApp, userData, page } = app()
    expect(userData).toBe(await electronApp.evaluate(({ app }) => app.getPath('userData')))
    const run = await spawnSecondInstance(userData)
    expect(run.timedOut).toBe(false)
    expect(run.code).toBe(0)
    expect(run.ms).toBeLessThan(5_000)
    // La original sigue viva.
    expect((await mainWindows()).length).toBe(1)
    expect(await page.locator('nav[aria-label="Modo"]').isVisible()).toBe(true)
  })

  it('second-instance restaura una ventana minimizada', async (ctx) => {
    const { electronApp, userData } = app()
    await electronApp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !/quick\/index\.html/.test(x.webContents.getURL()))
      w?.minimize()
    })
    const minimized = await (async () => {
      for (let i = 0; i < 20; i++) {
        if ((await mainWindows()).some((w) => w.minimized)) return true
        await new Promise((r) => setTimeout(r, 100))
      }
      return false
    })()
    // En headless (opacidad 0 + showInactive) minimize() puede no reflejarse: si es así, no es fiable → se documenta y se salta.
    if (!minimized) {
      console.warn('[instance] minimize() no se refleja en isMinimized() en headless; caso no verificable (humano)')
      ctx.skip()
      return
    }
    const run = await spawnSecondInstance(userData)
    expect(run.code).toBe(0)
    await expect.poll(async () => (await mainWindows()).some((w) => w.minimized), { timeout: 5_000 }).toBe(false)
    expect((await mainWindows()).length).toBe(1)
  })

  it('Quick Entry: un prompt abre Chat en la principal y llega al fake como prompt_async', async () => {
    const { electronApp, page, fake } = app()
    // Mismo camino que el atajo: toggleQuickEntry vía IPC `extras:quickToggle`.
    await page.evaluate(() => (window as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api.invoke('extras:quickToggle'))
    await expect
      .poll(() => (findQuickPage(electronApp) ? true : false), { timeout: 15_000, message: 'página de Quick Entry' })
      .toBe(true)
    const quick = findQuickPage(electronApp)!
    expect(isQuickUrl(quick.url())).toBe(true)
    const input = quick.getByLabel('Escribe un mensaje para el chat')
    await input.waitFor({ timeout: 15_000 })
    const text = `quick-e2e-${Date.now()}`
    await input.fill(text)
    await input.press('Enter')

    const req = await fake.waitForRequest((r) => r.method === 'POST' && /\/session\/[^/]+\/prompt_async$/.test(r.path), 30_000)
    expect(JSON.stringify(req.body)).toContain(text)
    await expectVisible(page.getByText(`Respuesta simulada: ${text}`), 30_000)
    // Tras enviar, Quick Entry se oculta.
    await expect
      .poll(async () => (await listWindows(electronApp)).filter((w) => isQuickUrl(w.url)).some((w) => w.visible), { timeout: 5_000 })
      .toBe(false)
  })

  it('second-instance con la principal cerrada crea una nueva', async () => {
    const { electronApp, userData } = app()
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((x) => !/quick\/index\.html/.test(x.webContents.getURL()))
        ?.close()
    })
    await expect.poll(async () => (await mainWindows()).length, { timeout: 10_000 }).toBe(0)
    // En darwin la app no sale al cerrar la ventana (index.ts: `window-all-closed` solo hace quit si platform !== 'darwin').
    const platform = await electronApp.evaluate(() => process.platform)
    if (platform !== 'darwin') {
      // Windows/Linux (decisión de la v1): ventana cerrada = la app se cierra; no hay «principal cerrada» que reabrir.
      await expect.poll(() => electronApp.process().exitCode !== null || electronApp.process().killed, { timeout: 15_000 }).toBe(true)
      return
    }
    const run = await spawnSecondInstance(userData)
    expect(run.code).toBe(0)
    await expect.poll(async () => (await mainWindows()).length, { timeout: 15_000 }).toBe(1)
    await expect.poll(async () => (await mainWindows()).some((w) => w.visible), { timeout: 15_000 }).toBe(true)
  })

  it.skip('arranque normal migra userData (Lapis/OpenDesk) y corre killStaleServers', () => {
    // NO automatizable con seguridad: toca datos reales ~/Library/Application Support/{Lapis,OpenDesk} y mata procesos
    // `opencode serve` huérfanos (podría alcanzar la instancia del usuario). Checklist humana.
  })
})
