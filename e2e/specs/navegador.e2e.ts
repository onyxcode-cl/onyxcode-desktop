// Navegador integrado: una página LOCAL (servidor estático del agente) debe cargar con sus CSS/imágenes aunque el origen solo
// esté aprobado «en esta tarea» o lo haya escrito el usuario, sin aflojar la regla de red contra OTROS puertos locales; y
// cerrar una pestaña la cierra de verdad (lista, DOM, vista nativa y webContents). Ver docs/SEGURIDAD y F8-B41.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { BrowserMcp, fakeOutsideUserData, makeTasksDir, prepareCodeBrowser, waitUserIdle } from '../lib/lotes'
import type { E2EApp } from '../lib/launch'
import { MODE } from '../lib/launch'
import { expectVisible } from '../lib/wait'

const SHOTS = process.env.NAV_SHOTS_DIR

// PNG 1x1 rojo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')

interface Site {
  port: number
  origin: string
  hits: string[]
  close: () => Promise<void>
}

/** Sitio estático: HTML + CSS + imagen. `/cruzado` intenta una imagen de OTRO puerto local (`?otro=<puerto>`). */
async function serveStatic(): Promise<Site> {
  const hits: string[] = []
  const server: Server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    const url = new URL(req.url ?? '/', 'http://x')
    res.setHeader('cache-control', 'no-store')
    if (url.pathname === '/estilo.css') {
      res.setHeader('content-type', 'text/css')
      res.end('body{background:rgb(10,200,30)} h1{color:rgb(200,10,10)}')
    } else if (url.pathname === '/logo.png' || url.pathname === '/secreto.png') {
      res.setHeader('content-type', 'image/png')
      res.end(PNG)
    } else if (url.pathname === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end('<!doctype html><title>Sitio estático</title><link rel="stylesheet" href="/estilo.css"><h1>Hola</h1><img id="logo" src="/logo.png">')
    } else if (url.pathname === '/cruzado') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><title>cruzado</title><link rel="stylesheet" href="/estilo.css"><img id="otro" src="http://127.0.0.1:${url.searchParams.get('otro')}/secreto.png">`)
    } else {
      res.statusCode = 404
      res.end('no')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port
  return { port, origin: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) }
}

const fakeBin = fakeOutsideUserData()
afterAll(() => fakeBin.dispose())

describe.skipIf(MODE !== 'dev')('Navegador integrado: páginas locales con CSS y cierre de pestañas', () => {
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin } })
  let site: Site
  let other: Site
  let mcp: BrowserMcp
  let sessionId: string
  let project: ReturnType<typeof makeTasksDir>

  beforeAll(async () => {
    project = makeTasksDir()
    site = await serveStatic()
    other = await serveStatic()
  })
  afterAll(async () => {
    await site?.close()
    await other?.close()
    project?.dispose()
  })

  const tabs = (): Promise<{ id: string; url: string; title: string }[]> =>
    app().page.evaluate(async (directory) => {
      const w = window as unknown as { api: { browser: { invoke: (c: string, r: unknown) => Promise<{ tabs: { id: string; url: string; title: string }[] }> } } }
      return (await w.api.browser.invoke('browser:state', { owner: { kind: 'code', directory } })).tabs
    }, project.dir)

  const urlInput = async (a: E2EApp): Promise<ReturnType<E2EApp['page']['getByPlaceholder']>> => {
    const input = a.page.getByPlaceholder('Escribe una URL')
    if ((await input.count()) === 0) await a.page.locator('form button.text-left').first().click()
    await input.waitFor()
    return input
  }

  /** Lee del webContents REAL de la pestaña (main) cómo quedó la página: color de fondo, color del h1 y ancho de la imagen. */
  const look = (prefix: string): Promise<{ bg: string; h1: string; img: number } | null> =>
    app().electronApp.evaluate(async ({ webContents }, p) => {
      const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(p))
      if (!wc) return null
      return wc.executeJavaScript(
        `({ bg: getComputedStyle(document.body).backgroundColor, h1: (document.querySelector('h1') ? getComputedStyle(document.querySelector('h1')).color : ''), img: (document.querySelector('img') ? document.querySelector('img').naturalWidth : -1) })`
      )
    }, prefix)

  /** Vistas nativas colgadas de la ventana principal + webContents vivos cuya URL empieza por `prefix`. */
  const natives = (prefix: string): Promise<{ children: number; alive: number }> =>
    app().electronApp.evaluate(({ BrowserWindow, webContents }, p) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /index\.html|localhost|127\.0\.0\.1/.test(w.webContents.getURL()) && !/quick|browser\/index/.test(w.webContents.getURL()))
      return {
        children: win ? win.contentView.children.length : -1,
        alive: webContents.getAllWebContents().filter((w) => !w.isDestroyed() && w.getURL().startsWith(p)).length
      }
    }, prefix)

  const snapPage = async (prefix: string, name: string): Promise<void> => {
    const b64 = await app().electronApp.evaluate(async ({ webContents }, p) => {
      const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(p))
      return wc ? (await wc.capturePage()).toPNG().toString('base64') : ''
    }, prefix)
    if (b64 && SHOTS) writeFileSync(join(SHOTS, name), Buffer.from(b64, 'base64'))
  }

  const card = (): ReturnType<E2EApp['page']['getByRole']> => app().page.getByRole('group', { name: 'Aprobación del navegador' })

  const GREEN = 'rgb(10, 200, 30)'
  const RED = 'rgb(200, 10, 10)'

  it('preparación: Code, panel del navegador y MCP', async () => {
    const r = await prepareCodeBrowser(app(), project.dir)
    mcp = r.mcp
    sessionId = r.sessionId
    await mcp.initialize()
    if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  })

  it('(1a) página que escribe el usuario (127.0.0.1:puerto): carga con CSS e imagen', async () => {
    const a = app()
    const input = await urlInput(a)
    await input.fill(`${site.origin}/`)
    await input.press('Enter')
    await expect.poll(async () => (await tabs()).at(-1)?.title, { timeout: 20_000 }).toBe('Sitio estático')
    await a.page.waitForTimeout(1_500)
    if (SHOTS) await a.page.screenshot({ path: join(SHOTS, 'usuario-127.png') })
    // Captura de la propia página (vista nativa, que `page.screenshot` del renderer no incluye).
    if (SHOTS) await snapPage(site.origin, 'pagina-127.png')
    await expect.poll(async () => (await look(site.origin))?.bg, { timeout: 20_000 }).toBe(GREEN)
    const got = await look(site.origin)
    expect(got).toEqual({ bg: GREEN, h1: RED, img: 1 })
    expect(site.hits).toContain('GET /estilo.css')
  })

  it('(1b) origen local aprobado solo «en esta tarea» por el agente: carga con CSS e imagen', async () => {
    const a = app()
    await waitUserIdle(a.page, project.dir)
    const url = `http://localhost:${site.port}/`
    const opening = mcp.call(sessionId, 'new_page', { url })
    await expectVisible(card().getByText(`¿Dejar que el agente abra tu servidor local localhost:${site.port}?`), 30_000)
    const allow = card().getByRole('button', { name: 'Permitir en esta tarea' })
    await expect.poll(() => allow.isEnabled(), { timeout: 5_000 }).toBe(true)
    await allow.click()
    const res = await opening
    expect(res.isError, res.text).toBe(false)
    await expect.poll(async () => (await look(`http://localhost:${site.port}`))?.bg, { timeout: 20_000 }).toBe(GREEN)
    expect(await look(`http://localhost:${site.port}`)).toEqual({ bg: GREEN, h1: RED, img: 1 })
    if (SHOTS) await snapPage(`http://localhost:${site.port}`, 'pagina-agente-task.png')
  })

  it('(1c) negativo: una página local aprobada «en esta tarea» NO alcanza otro puerto local no aprobado', async () => {
    const a = app()
    await waitUserIdle(a.page, project.dir)
    const before = other.hits.length
    const url = `http://localhost:${site.port}/cruzado?otro=${other.port}`
    // Mismo origen ya aprobado en la tarea: no hay tarjeta nueva; la página carga su CSS pero no la imagen ajena.
    // (Un movimiento de ratón sobre la vista recién descubierta cuenta como «usuario activo»: se reintenta tras esperar.)
    let res = await mcp.call(sessionId, 'navigate_page', { type: 'url', url })
    for (let i = 0; i < 4 && res.isError && res.text.includes('usando el navegador'); i++) {
      await a.page.waitForTimeout(3_200)
      res = await mcp.call(sessionId, 'navigate_page', { type: 'url', url })
    }
    expect(res.isError, res.text).toBe(false)
    await expect.poll(async () => (await look(`http://localhost:${site.port}/cruzado`))?.bg, { timeout: 20_000 }).toBe(GREEN)
    await a.page.waitForTimeout(800)
    expect(other.hits.length).toBe(before)
    const blocked = a.errors.filter((e) => e.text.includes('ERR_BLOCKED_BY_CLIENT') && e.text.includes(`127.0.0.1:${other.port}`))
    for (const e of blocked) a.errors.splice(a.errors.indexOf(e), 1)
  })

  it('(2) cerrar una pestaña: desaparece de la lista, del DOM, la vista nativa se quita y el webContents se destruye', async () => {
    const a = app()
    const list = await tabs()
    expect(list.length).toBeGreaterThanOrEqual(2)
    const victim = list.find((t) => t.url.startsWith(`http://localhost:${site.port}`))!
    const nativeBefore = await natives(`http://localhost:${site.port}`)
    expect(nativeBefore.alive).toBe(1)
    // Seleccionarla (como haría el usuario) y cerrarla con la ✕ de su pestaña.
    await a.page.getByRole('tab').filter({ has: a.page.locator('svg.lucide-bot') }).first().getByTitle('Cerrar pestaña').click()
    await expect.poll(async () => (await tabs()).some((t) => t.id === victim.id)).toBe(false)
    expect((await tabs()).length).toBe(list.length - 1)
    await expect.poll(() => a.page.getByRole('tab').count()).toBe(list.length - 1)
    await expect.poll(async () => (await natives(`http://localhost:${site.port}`)).alive, { timeout: 10_000 }).toBe(0)
    // Solo queda UNA vista nativa colgada (la de la pestaña activa) y la pestaña que queda está seleccionada.
    await expect.poll(async () => (await natives('http://127.0.0.1')).children, { timeout: 5_000 }).toBe(1)
    await expect.poll(() => a.page.getByRole('tab', { selected: true }).count()).toBe(1)
  })

  it('(3) cerrar la ÚLTIMA pestaña deja el panel vacío y sin ninguna vista nativa de página', async () => {
    const a = app()
    for (let i = 0; i < 10; i++) {
      const list = await tabs()
      if (!list.length) break
      await a.page.getByRole('tab').first().getByTitle('Cerrar pestaña').click()
      await expect.poll(async () => (await tabs()).length).toBe(list.length - 1)
    }
    expect((await tabs()).length).toBe(0)
    await expect.poll(async () => (await natives(site.origin)).alive + (await natives(`http://localhost:${site.port}`)).alive, { timeout: 10_000 }).toBe(0)
    await expect.poll(() => a.page.getByRole('tab').count()).toBe(0)
    if (SHOTS) await a.page.screenshot({ path: join(SHOTS, 'sin-pestanas.png') })
  })
})
