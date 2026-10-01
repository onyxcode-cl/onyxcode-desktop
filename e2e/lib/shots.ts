// Capturas de pantalla de los E2E: claro y oscuro a 820 y 1280 px de ancho. La ventana vuelve a 1280 al terminar.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { E2EApp } from './launch'

/**
 * Guarda `<dir>/<name>-<ancho>-<light|dark>.png`. Sin `dir` (variable de entorno de capturas sin definir) no hace nada.
 */
export async function shot(app: E2EApp, dir: string | undefined, name: string, widths: number[] = [820, 1280]): Promise<void> {
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const { page } = app
  for (const w of widths) {
    await app.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), w)
    await page.setViewportSize({ width: w, height: 800 })
    await page.waitForTimeout(400)
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(dir, `${name}-${w}-${scheme}.png`) })
    }
  }
  await page.emulateMedia({ colorScheme: null })
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800))
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(300)
}
