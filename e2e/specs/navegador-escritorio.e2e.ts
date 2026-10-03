// Navegador integrado (F8-B46): las páginas se ven SIEMPRE con su versión de escritorio (viewport emulado de 1280 px, con
// escala para caber en el panel) y «Móvil» solo cuando el usuario lo pide. Servidor estático local con una página que cambia
// por `@media (max-width: 800px)`; el clic del agente (por uid → coordenadas) debe caer en el elemento correcto con escala ≠ 1.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { BrowserMcp, fakeOutsideUserData, makeTasksDir, prepareCodeBrowser, waitUserIdle } from '../lib/lotes'
import { MODE, type E2EApp } from '../lib/launch'
import { IS_WIN } from '../lib/proc'
import { shot } from '../lib/shots'

const SHOTS = process.env.MY_SHOTS_DIR

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Escritorio o móvil</title>
<style>
body{margin:0;background:rgb(10,200,30);font:16px sans-serif}
#modo::after{content:'escritorio'}
button{position:absolute;top:120px;width:160px;height:60px;font-size:18px}
#izq{left:40px}#der{left:1060px}
@media (max-width:800px){body{background:rgb(220,20,20)} #modo::after{content:'movil'} button{position:static;display:block;width:120px}}
</style>
<h1 id="modo">Vista: </h1>
<button id="izq" onclick="document.title='clic-izq'">Botón izquierdo</button>
<button id="der" onclick="document.title='clic-der'">Botón derecho</button>`

async function serve(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(PAGE)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r())))
  }
}

const fakeBin = fakeOutsideUserData()
afterAll(() => fakeBin.dispose())

describe.skipIf(MODE !== 'dev')('Navegador integrado: vista de escritorio por defecto y «Móvil» a petición', () => {
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin } })
  let site: Awaited<ReturnType<typeof serve>>
  let mcp: BrowserMcp
  let sessionId: string
  let project: ReturnType<typeof makeTasksDir>

  beforeAll(async () => {
    project = makeTasksDir()
    site = await serve()
  })
  afterAll(async () => {
    await site?.close()
    project?.dispose()
  })

  /** Lo que ve la página real de la pestaña (main): ancho del viewport, estilo aplicado, UA, ancho de la vista nativa. */
  const look = (): Promise<{ w: number; mode: string; bg: string; ua: string; title: string; native: number } | null> =>
    app().electronApp.evaluate(async ({ webContents, BrowserWindow }, p) => {
      const wc = webContents.getAllWebContents().find((x) => !x.isDestroyed() && x.getURL().startsWith(p))
      if (!wc) return null
      const r = (await wc.executeJavaScript(
        `({ w: innerWidth, mode: getComputedStyle(document.getElementById('modo'),'::after').content.replace(/"/g,''), bg: getComputedStyle(document.body).backgroundColor, ua: navigator.userAgent, title: document.title })`
      )) as { w: number; mode: string; bg: string; ua: string; title: string }
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.contentView.children.length > 0)
      const native = win ? Math.max(...win.contentView.children.map((c) => c.getBounds().width)) : -1
      return { ...r, native }
    }, site.origin)

  const setTitle = (title: string): Promise<void> =>
    app().electronApp.evaluate(
      async ({ webContents }, [p, t]) => {
        const wc = webContents.getAllWebContents().find((x) => !x.isDestroyed() && x.getURL().startsWith(p))
        await wc?.executeJavaScript(`document.title=${JSON.stringify(t)}`)
      },
      [site.origin, title]
    )

  async function uidOf(name: string): Promise<string> {
    const snap = await mcp.call(sessionId, 'take_snapshot')
    expect(snap.isError, snap.text).toBe(false)
    const line = snap.text.split('\n').find((l) => l.includes(`"${name}`))
    expect(line, `snapshot sin «${name}»:\n${snap.text}`).toBeTruthy()
    return /uid=(s\d+_\d+)/.exec(line!)![1]
  }

  const viewBtn = (name: 'Escritorio' | 'Móvil'): ReturnType<E2EApp['page']['getByRole']> =>
    app().page.getByRole('group', { name: 'Vista de las páginas' }).getByRole('button', { name })

  it('preparación y navegación del usuario', async () => {
    const a = app()
    const r = await prepareCodeBrowser(a, project.dir)
    mcp = r.mcp
    sessionId = r.sessionId
    await mcp.initialize()
    const input = a.page.getByPlaceholder('Escribe una URL')
    if ((await input.count()) === 0) await a.page.locator('form button.text-left').first().click()
    await input.waitFor()
    await input.fill(`${site.origin}/`)
    await input.press('Enter')
    await expect.poll(async () => (await look())?.mode, { timeout: 20_000 }).toBeTruthy()
  })

  it('por defecto: escritorio aunque el panel sea estrecho (viewport 1280, sin UA móvil)', async () => {
    await expect.poll(() => viewBtn('Escritorio').getAttribute('aria-pressed')).toBe('true')
    await expect.poll(() => viewBtn('Móvil').getAttribute('aria-pressed')).toBe('false')
    const got = await look()
    expect(got!.native).toBeLessThan(1280) // el panel es más estrecho que un escritorio
    expect(got).toMatchObject({ w: 1280, mode: 'escritorio', bg: 'rgb(10, 200, 30)' })
    expect(got!.ua).not.toMatch(/Mobile|Android|iPhone/)
    expect(got!.ua).not.toMatch(/Electron/)
  })

  it.skipIf(IS_WIN)('clic del agente con escala ≠ 1: cada botón recibe SU clic; la captura mide 1280 px de ancho', async () => {
    const a = app()
    const got0 = (await look())!
    expect(got0.native / got0.w).toBeLessThan(0.95) // escala real ≠ 1
    // El agente solo actúa en un origen local aprobado: se cierra la pestaña del usuario y el agente abre la página (tarjeta «en esta tarea»).
    await a.page.evaluate(async (directory) => {
      const w = window as unknown as {
        api: { browser: { invoke: (c: string, r: unknown) => Promise<{ tabs: { id: string }[] }> } }
      }
      const owner = { kind: 'code', directory }
      for (const t of (await w.api.browser.invoke('browser:state', { owner })).tabs)
        await w.api.browser.invoke('browser:closeTab', { owner, tabId: t.id })
    }, project.dir)
    await waitUserIdle(a.page, project.dir)
    const opening = mcp.call(sessionId, 'new_page', { url: `${site.origin}/` })
    const card = a.page.getByRole('group', { name: 'Aprobación del navegador' })
    const allow = card.getByRole('button', { name: 'Permitir en esta tarea' })
    await allow.waitFor({ timeout: 30_000 })
    await expect.poll(() => allow.isEnabled(), { timeout: 5_000 }).toBe(true)
    await allow.click()
    const opened = await opening
    expect(opened.isError, opened.text).toBe(false)
    await expect.poll(async () => (await look())?.mode, { timeout: 20_000 }).toBe('escritorio')
    const got = (await look())!
    expect(got.w).toBe(1280)
    expect(got.native / got.w).toBeLessThan(0.95)
    await waitUserIdle(a.page, project.dir)
    const der = await uidOf('Botón derecho')
    const izq = await uidOf('Botón izquierdo')
    let res = await mcp.call(sessionId, 'click', { uid: der })
    expect(res.isError, res.text).toBe(false)
    await expect.poll(async () => (await look())?.title, { timeout: 5_000 }).toBe('clic-der')
    await setTitle('reset')
    await waitUserIdle(a.page, project.dir)
    res = await mcp.call(sessionId, 'click', { uid: izq })
    expect(res.isError, res.text).toBe(false)
    await expect.poll(async () => (await look())?.title, { timeout: 5_000 }).toBe('clic-izq')
    const shotRes = await mcp.call(sessionId, 'take_screenshot')
    expect(shotRes.isError, shotRes.text).toBe(false)
    expect(shotRes.text).toMatch(/\(1280x\d+ px\)/)
  })

  it('«Móvil» (a petición) activa la versión móvil con UA móvil; «Escritorio» la devuelve', async () => {
    await viewBtn('Móvil').click()
    await expect.poll(() => viewBtn('Móvil').getAttribute('aria-pressed')).toBe('true')
    await expect
      .poll(
        async () => {
          const l = await look()
          return l && { mode: l.mode, narrow: l.w <= 800, mobile: /Mobile/.test(l.ua), w: l.w }
        },
        { timeout: 15_000 }
      )
      .toMatchObject({ mode: 'movil', narrow: true, mobile: true })
    const m = (await look())!
    expect(m.w).toBeLessThanOrEqual(800)
    expect(m.bg).toBe('rgb(220, 20, 20)')
    expect(m.ua).toMatch(/Mobile/)
    if (SHOTS) await shot(app(), SHOTS, 'navegador-movil')
    await viewBtn('Escritorio').click()
    await expect
      .poll(
        async () => {
          const l = await look()
          return l && { mode: l.mode, w: l.w, mobile: /Mobile/.test(l.ua) }
        },
        { timeout: 15_000 }
      )
      .toMatchObject({ mode: 'escritorio', w: 1280, mobile: false })
    const d = (await look())!
    expect(d).toMatchObject({ w: 1280, bg: 'rgb(10, 200, 30)' })
    expect(d.ua).not.toMatch(/Mobile/)
    if (SHOTS) await shot(app(), SHOTS, 'navegador-escritorio')
  })

  it('la elección se recuerda (embedded-browser.json) y arranca en escritorio', async () => {
    await viewBtn('Móvil').click()
    await expect
      .poll(() => JSON.parse(readFileSync(join(app().userData, 'embedded-browser.json'), 'utf8')).prefs.viewMode, { timeout: 5_000 })
      .toBe('mobile')
    await viewBtn('Escritorio').click()
    await expect
      .poll(() => JSON.parse(readFileSync(join(app().userData, 'embedded-browser.json'), 'utf8')).prefs.viewMode, { timeout: 5_000 })
      .toBe('desktop')
  })
})
