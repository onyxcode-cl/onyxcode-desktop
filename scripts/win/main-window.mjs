/** Excluye quick, overlay y visores aunque compartan el origen de la app. */
export async function mainWindow(pages) {
  const candidates = pages.filter((page) => {
    try {
      const url = new URL(page.url())
      const own = url.protocol === 'lazunox:' && url.hostname === 'app'
      const dev = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port
      return (own || dev) && ['/', '/index.html'].includes(url.pathname)
    } catch {
      return false
    }
  })
  for (const page of candidates) {
    if (await page.evaluate(() => typeof window.api?.tasks?.invoke === 'function').catch(() => false)) return page
  }
}
