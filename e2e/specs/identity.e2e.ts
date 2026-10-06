// Identidad única «Lazunox»: app.name, el título de la ventana y el del documento son «Lazunox» (de app.name depende la clave
// «Lazunox Safe Storage» del Llavero) y ninguna partición de sesión conserva el nombre viejo.
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'

const app = useApp()

describe(`identidad visible e interna (${MODE})`, () => {
  it('app.name, la ventana y el documento dicen Lazunox y ninguna partición lleva el nombre viejo', async () => {
    const { electronApp, page } = app()
    expect(await electronApp.evaluate(({ app }) => app.name)).toBe('Lazunox')
    // La ventana principal (no Quick Entry): la URL del renderer principal no es la de quick/index.html.
    const titles = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed() && !/quick\/index\.html/.test(w.webContents.getURL()) && w.webContents.getURL() !== '')
        .map((w) => w.getTitle())
    )
    expect(titles[0]).toBe('Lazunox')
    expect(await page.title()).toBe('Lazunox')
    // Particiones de sesión de todos los webContents: ninguna con el nombre viejo.
    const partitions = await electronApp.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((wc) => String((wc.session as unknown as { storagePath?: string }).storagePath ?? ''))
    )
    expect(partitions.filter((p) => /onyx/i.test(p))).toEqual([])
  })
})
