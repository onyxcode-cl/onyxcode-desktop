// Identidad tras el renombre a «Lazunox» (Fase 1): el nombre VISIBLE es Lazunox, pero app.name sigue siendo «OnyxCode»
// (de él depende la clave «OnyxCode Safe Storage» del Llavero; cambiarlo haría perder datos en silencio).
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'

const app = useApp()

describe(`identidad visible e interna (${MODE})`, () => {
  it('app.name sigue siendo OnyxCode (Llavero) y la ventana y el documento dicen Lazunox', async () => {
    const { electronApp, page } = app()
    expect(await electronApp.evaluate(({ app }) => app.name)).toBe('OnyxCode')
    // La ventana principal (no Quick Entry): la URL del renderer principal no es la de quick/index.html.
    const titles = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed() && !/quick\/index\.html/.test(w.webContents.getURL()) && w.webContents.getURL() !== '')
        .map((w) => w.getTitle())
    )
    expect(titles[0]).toBe('Lazunox')
    expect(await page.title()).toBe('Lazunox')
  })
})
