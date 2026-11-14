import type { ElectronApplication, Page } from 'playwright-core'

/** Quick Entry y otras ventanas pueden aparecer antes que la principal. No esperes su DOMContentLoaded. */
export async function waitForMainPage(app: Pick<ElectronApplication, 'windows'>, rendererUrl: string, timeout = 60_000): Promise<Page> {
  const expected = new URL(rendererUrl)
  const deadline = Date.now() + timeout
  let page: Page | undefined
  while (Date.now() < deadline) {
    page = app.windows().find((candidate) => {
      if (candidate.isClosed()) return false
      try {
        const url = new URL(candidate.url())
        return url.protocol === expected.protocol && url.host === expected.host && (url.pathname === '/' || url.pathname === '/index.html')
      } catch {
        return false
      }
    })
    if (page) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const detail = (): string =>
    app
      .windows()
      .map((candidate) => candidate.url() || '(sin URL)')
      .join(', ')
  if (!page) throw new Error(`No apareció la ventana principal (${rendererUrl}). Ventanas: ${detail()}`)
  try {
    // Esperar la capacidad que consume el test y el shell montado funciona incluso cuando Playwright
    // se conecta después del evento de carga. También distingue un HTML cargado de un renderer listo.
    await page.waitForFunction(
      () => typeof window.api?.invoke === 'function' && Boolean(document.querySelector('nav[aria-label="Modo"], nav[aria-label="Mode"]')),
      undefined,
      { timeout: Math.max(1, deadline - Date.now()) }
    )
  } catch (cause) {
    throw new Error(`La ventana principal no quedó lista (${page.url()}). Ventanas: ${detail()}`, { cause })
  }
  return page
}
