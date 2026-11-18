import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { gotoMode, scriptFor } from '../lib/lru'
import { expectVisible } from '../lib/wait'
const app = useApp()
describe('visor MP4 en Chat', () => {
  it('abre pausado/silenciado, reproduce y permite adelantar', async () => {
    const { page, electronApp, fake } = app()
    const userData = await electronApp.evaluate(({ app: a }) => a.getPath('userData'))
    const dir = join(userData, 'chat-workspace')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'promo.mp4')
    copyFileSync(join(process.cwd(), 'e2e/fixtures/video-1s.mp4'), file)
    await scriptFor(fake, 'dame el video', `Listo: ${file}`)
    await gotoMode(page, 'Chat')
    await page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    await page.getByPlaceholder('Escribe un mensaje…').fill('dame el video')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expectVisible(page.getByRole('button', { name: 'Ver aquí' }), 30000)
    await page.getByRole('button', { name: 'Ver aquí' }).click()
    const evaluate = (script: string): Promise<any> =>
      electronApp.evaluate(async ({ webContents }, s) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('lazunox-viewer:'))
        return wc ? wc.executeJavaScript(s, true) : null
      }, script)
    await expect.poll(() => evaluate("document.querySelector('video')?.readyState >= 2"), { timeout: 20000 }).toBe(true)
    expect(
      await evaluate(
        "({paused:document.querySelector('video').paused,muted:document.querySelector('video').muted,controls:document.querySelector('video').controls})"
      )
    ).toEqual({ paused: true, muted: true, controls: true })
    await evaluate("document.querySelector('video').currentTime = 0.6; true")
    await expect
      .poll(() => evaluate("!document.querySelector('video').seeking && document.querySelector('video').currentTime >= 0.6"), {
        timeout: 10000
      })
      .toBe(true)
    await evaluate("document.querySelector('video').play().then(() => true)")
    await expect.poll(() => evaluate("document.querySelector('video').currentTime > 0.65"), { timeout: 10000 }).toBe(true)
  }, 60000)
})
