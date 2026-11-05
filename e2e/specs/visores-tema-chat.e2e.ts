// 1.8.9 · P5: el documento abierto en el panel del CHAT (tarjeta «Ver aquí») sigue el tema de la app al alternarlo.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { gotoMode, scriptFor } from '../lib/lru'
import { expectVisible } from '../lib/wait'
import { MODE } from '../lib/launch'

const app = useApp()
const SHOTS = process.env.P5_DIR

describe(`visor en el panel del Chat sigue el tema (${MODE})`, () => {
  it('Word abierto con «Ver aquí» cambia de tema al alternar claro/oscuro', async () => {
    const { page, electronApp, fake } = app()
    const userData = await electronApp.evaluate(({ app: a }) => a.getPath('userData'))
    const dir = join(userData, 'chat-workspace')
    mkdirSync(dir, { recursive: true })
    const ejemplo = process.env.P5_DOCX ?? join(process.cwd(), 'e2e/fixtures/ejemplo-visor.docx')
    const file = join(dir, 'informe.docx')
    copyFileSync(ejemplo, file)
    await scriptFor(fake, 'dame el informe', `Listo, el informe quedó en ${file}`)

    await gotoMode(page, 'Chat')
    await page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    await page.getByPlaceholder('Escribe un mensaje…').fill('dame el informe')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(page.getByRole('button', { name: 'Ver aquí' }), 30_000)
    await page.getByRole('button', { name: 'Ver aquí' }).click()

    const viewerTheme = async (): Promise<string | null> =>
      electronApp.evaluate(({ webContents }) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('lazunox-viewer:'))
        if (!wc) return null
        return /[#&]theme=(\w+)/.exec(wc.getURL())?.[1] ?? '?'
      })
    const shot = async (name: string): Promise<void> => {
      if (!SHOTS) return
      mkdirSync(SHOTS, { recursive: true })
      const b64 = await electronApp.evaluate(async ({ webContents }) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('lazunox-viewer:'))
        return wc ? (await wc.capturePage()).toPNG().toString('base64') : ''
      })
      if (b64) writeFileSync(join(SHOTS, `${name}-visor.png`), Buffer.from(b64, 'base64'))
      await page.screenshot({ path: join(SHOTS, `${name}-ventana.png`) })
    }

    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(viewerTheme, { timeout: 20_000 }).toBe('light')
    await page.waitForTimeout(1500)
    await shot('chat-docx-claro')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(viewerTheme, { timeout: 20_000, message: 'el visor del Chat no pasó a oscuro' }).toBe('dark')
    await page.waitForTimeout(1500)
    await shot('chat-docx-oscuro')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(viewerTheme, { timeout: 20_000, message: 'el visor del Chat no volvió a claro' }).toBe('light')
  }, 180_000)
})
