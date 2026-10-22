// Catálogo MCP curado contra la app real y el OpenCode falso. Cancelar no toca nada (ni recarga el servidor); «Añadir y
// conectar» escribe exactamente la entrada; el token no llega al DOM; eliminar limpia entrada, permiso y procedencia.
// Capturas con MCP_SHOTS_DIR.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { openedUrls, stubOpenExternal } from '../lib/dialogs'
import { MODE, type E2EApp } from '../lib/launch'
import { consumeErrors, newChatAndSend } from '../lib/fase6'
import { shot as takeShot } from '../lib/shots'
import { expectCount, expectVisible } from '../lib/wait'
import { IS_WIN, DEVICE } from '../lib/proc'
import { findCatalogItem } from '../../src/shared/mcp-catalog'

const DEV = MODE === 'dev'
const SHOTS = process.env.MCP_SHOTS_DIR
const TOKEN = 'ghp_' + 'Zx9Qw3Er5Ty7'.repeat(3)
const BAD_TOKEN = 'token-que-no-vale-123'

const shot = (app: E2EApp, name: string, widths?: number[]): Promise<void> => takeShot(app, SHOTS, name, widths)

describe.skipIf(!DEV)('Catálogo MCP', () => {
  const app = useApp()
  const cfgPath = (): string => join(app().userData, 'opencode', 'opencode.json')
  const provPath = (): string => join(app().userData, 'mcp-catalog-installs.json')
  const cfgRaw = (): string => readFileSync(cfgPath(), 'utf8')
  const cfg = (): { mcp: Record<string, unknown>; permission?: Record<string, string> } => JSON.parse(cfgRaw())
  const disposeCount = async (): Promise<number> => Number((await app().fake.status()).disposeCount)
  const engineUrl = (page: Page): Promise<string | null> =>
    page.evaluate(async () => {
      const r = await (window as any).api.invoke('opencode:connection')
      return r.ok && r.data ? (r.data.baseUrl as string) : null
    })

  /**
   * Un conector NUEVO relanza el motor (F8-B203): no se recarga en caliente porque quedaría cargado sin su regla «ask». El motor
   * nuevo es otro proceso (otro puerto, estado propio). Espera a que la app lo anuncie, reconecta el cliente del falso y consume
   * SOLO los errores de red hacia el puerto viejo (el flujo de eventos cortado y las lecturas que aún apuntaban a él).
   */
  async function awaitEngineRelaunch(oldUrl: string): Promise<void> {
    const { page } = app()
    await expect.poll(async () => ((await engineUrl(page)) ?? oldUrl) !== oldUrl, { timeout: 60_000 }).toBe(true)
    await app().connectFake()
    const oldPort = new URL(oldUrl).port
    const stale = new RegExp(`(ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_CONNECTION_REFUSED) \\(http://127\\.0\\.0\\.1:${oldPort}/`)
    await page.waitForTimeout(500)
    consumeErrors(app(), stale)
  }

  const dialog = (page: Page): Locator => page.getByRole('dialog', { name: /^Añadir / })
  const card = (page: Page, title: string): Locator => page.getByLabel('Catálogo de conectores').locator('div.flex-col', { hasText: title })
  const row = (page: Page, name: string): Locator =>
    page.locator('div.border-b').filter({ has: page.locator('span.font-mono', { hasText: new RegExp(`^${name}$`) }) })
  const bodyText = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText)
  const bodyHtml = (page: Page): Promise<string> => page.evaluate(() => document.body.innerHTML)

  /** Desplaza el cuerpo del diálogo (arriba o abajo) para que la captura enseñe esa parte. */
  const scrollDialog = (d: Locator, where: 'top' | 'bottom'): Promise<void> =>
    d.locator('div.overflow-y-auto').evaluate((el, w) => void (el.scrollTop = w === 'top' ? 0 : el.scrollHeight), where)

  async function open(page: Page, title: string): Promise<Locator> {
    await card(page, title)
      .getByRole('button', { name: `Añadir ${title}` })
      .click()
    const d = dialog(page)
    await expectVisible(d)
    return d
  }

  it('(1) Ajustes › MCP muestra el catálogo con insignias y sin nada instalado', async () => {
    const { page } = app()
    await page.keyboard.press('ControlOrMeta+,')
    const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
    await nav.getByRole('button', { name: 'Conectores', exact: true }).click()
    await expectVisible(page.getByLabel('Catálogo de conectores'))
    for (const t of ['Context7', 'Cloudflare Docs', 'GitHub', 'Linear', 'Notion', 'Sentry', 'Atlassian (Jira y Confluence)']) {
      await expectVisible(card(page, t))
    }
    const txt = await bodyText(page)
    expect(txt).toContain(`Remoto · no ejecuta nada en tu ${DEVICE}`)
    expect(txt).toContain('Inicio de sesión')
    expect(txt).toContain('Necesita un token')
    expect(txt).not.toContain('Del catálogo')
    expect(existsSync(provPath())).toBe(false)
    await shot(app(), 'mcp-catalogo')
  })

  it('(2) el diálogo informa y «Cancelar» (foco inicial) no toca el archivo ni recarga el servidor', async () => {
    const { page } = app()
    const before = cfgRaw()
    const disposes = await disposeCount()
    const d = await open(page, 'Context7')
    expect(await d.locator('strong').first().innerText()).toBe('mcp.context7.com')
    await expectVisible(d.getByText('https://mcp.context7.com/mcp', { exact: true }))
    await expectVisible(d.getByText('Qué podrá hacer'))
    await expectVisible(d.getByText('Qué datos salen'))
    await expectVisible(d.getByText(/Verificado el 1 de octubre de 2026/))
    const json = await d.getByLabel('Configuración que se guardará').innerText()
    expect(JSON.parse(json)).toEqual({
      mcp: { context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true, oauth: false } },
      permission: { 'context7_*': 'ask' }
    })
    expect(await d.getByRole('switch', { name: 'Preguntar antes de cada uso' }).getAttribute('aria-checked')).toBe('true')
    const tareas = d.getByRole('switch', { name: 'Disponible en Overdrive' })
    expect(await tareas.isDisabled()).toBe(true)
    expect(await tareas.getAttribute('aria-checked')).toBe('false')
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Cancelar')
    await scrollDialog(d, 'top')
    await shot(app(), 'mcp-dialogo-context7')
    await scrollDialog(d, 'bottom')
    await shot(app(), 'mcp-dialogo-context7-abajo')
    await scrollDialog(d, 'top')

    // El enlace a la documentación se abre fuera de la app (aquí, interceptado).
    await stubOpenExternal(app().electronApp)
    await d.getByRole('button', { name: /Documentación oficial/ }).click()
    await expect.poll(() => openedUrls(app().electronApp)).toEqual(['https://github.com/upstash/context7'])

    await d.getByRole('button', { name: 'Cancelar' }).click()
    await expectCount(dialog(page), 0)
    expect(cfgRaw()).toBe(before)
    expect(await disposeCount()).toBe(disposes)
    expect(existsSync(provPath())).toBe(false)

    // Esc también cancela.
    await open(page, 'Context7')
    await page.keyboard.press('Escape')
    await expectCount(dialog(page), 0)
    expect(cfgRaw()).toBe(before)
  })

  it('(3) «Añadir y conectar» escribe exactamente la entrada; aparece conectado y «Del catálogo»', async () => {
    const { page } = app()
    const oldUrl = (await engineUrl(page))!
    const d = await open(page, 'Context7')
    await d.getByRole('button', { name: 'Añadir y conectar' }).click()
    await expectCount(dialog(page), 0)
    expect(cfg().mcp).toEqual({ context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true, oauth: false } })
    expect(cfg().permission).toEqual({ 'context7_*': 'ask' })
    // Windows: sin bits de permiso POSIX (ACL del perfil).
    if (!IS_WIN) expect(statSync(cfgPath()).mode & 0o777).toBe(0o600)
    // Windows: sin bits de permiso POSIX (ACL del perfil).
    if (!IS_WIN) expect(statSync(provPath()).mode & 0o777).toBe(0o600)
    expect(Object.keys(JSON.parse(readFileSync(provPath(), 'utf8')))).toEqual(['context7'])
    // El motor se relanzó (otro proceso, otro puerto) y arrancó con el conector Y su regla «ask» a la vez; no hubo recarga en caliente.
    await awaitEngineRelaunch(oldUrl)
    expect(await disposeCount()).toBe(0)
    const live = (await app().fake.config()).config as { mcp: Record<string, unknown>; permission?: Record<string, string> }
    expect(live.mcp.context7).toEqual({ type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true, oauth: false })
    expect(live.permission?.['context7_*']).toBe('ask')
    const r = row(page, 'context7')
    await expectVisible(r.getByText('Conectado', { exact: true }))
    await expectVisible(r.getByText('Del catálogo', { exact: true }))
    expect(await r.getByText('Modificado', { exact: true }).count()).toBe(0)
    await expectVisible(card(page, 'Context7').getByText('Añadido', { exact: true }))
  })

  it('(4) nombre repetido: propone «-2» y bloquea escribir el mismo', async () => {
    const { page } = app()
    const before = cfgRaw()
    const d = await open(page, 'Context7')
    const name = d.getByLabel('Nombre del servidor')
    expect(await name.inputValue()).toBe('context7-2')
    await name.fill('context7')
    await expectVisible(d.getByText(/Ya existe un servidor llamado "context7"\. Prueba con "context7-2"/))
    expect(await d.getByRole('button', { name: 'Añadir y conectar' }).isDisabled()).toBe(true)
    await d.getByRole('button', { name: 'Cancelar' }).click()
    expect(cfgRaw()).toBe(before)
  })

  it('(5) token inválido: error, campo enmascarado, no se escribe y el valor no aparece en la pantalla', async () => {
    const { page } = app()
    const before = cfgRaw()
    const d = await open(page, 'GitHub')
    const input = d.getByLabel('Token de acceso personal')
    expect(await input.getAttribute('type')).toBe('password')
    await input.fill(BAD_TOKEN)
    await expectVisible(d.getByText(/no tiene el formato esperado/))
    expect(await d.getByRole('button', { name: 'Añadir y conectar' }).isDisabled()).toBe(true)
    expect(await bodyText(page)).not.toContain(BAD_TOKEN)
    // Aunque el renderer se saltara su validación, main rechaza el valor (y su mensaje no lo repite).
    const err = await page.evaluate(async (t) => {
      try {
        await (window as any).api.extras.invoke('mcp:installCatalog', {
          id: 'github',
          name: 'github',
          inputs: { token: t },
          enable: true,
          askEachUse: true
        })
        return null
      } catch (e) {
        return String((e as Error).message ?? e)
      }
    }, BAD_TOKEN)
    expect(err).toMatch(/formato/)
    expect(err).not.toContain(BAD_TOKEN)
    expect(cfgRaw()).toBe(before)
    await d.getByRole('button', { name: 'Cancelar' }).click()
  })

  it('(6) GitHub con token válido: cabecera en el archivo, vista previa «••••», token fuera del DOM', async () => {
    const { page } = app()
    const d = await open(page, 'GitHub')
    await d.getByLabel('Token de acceso personal').fill(TOKEN)
    const preview = await d.getByLabel('Configuración que se guardará').innerText()
    expect(preview).toContain('Bearer ••••')
    expect(preview).not.toContain(TOKEN)
    await scrollDialog(d, 'bottom')
    await shot(app(), 'mcp-dialogo-github-abajo')
    await scrollDialog(d, 'top')
    await shot(app(), 'mcp-dialogo-github')
    const oldUrl = (await engineUrl(page))!
    await d.getByRole('button', { name: 'Añadir y conectar' }).click()
    await expectCount(dialog(page), 0)
    expect(cfg().mcp.github).toEqual({
      type: 'remote',
      url: 'https://api.githubcopilot.com/mcp/',
      enabled: true,
      headers: { Authorization: `Bearer ${TOKEN}` },
      oauth: false
    })
    expect(cfg().permission).toEqual({ 'context7_*': 'ask', 'github_*': 'ask' })
    expect(readFileSync(provPath(), 'utf8')).not.toContain(TOKEN)
    await awaitEngineRelaunch(oldUrl)
    await expectVisible(row(page, 'github').getByText('Conectado', { exact: true }))
    expect(await bodyText(page)).not.toContain(TOKEN)
    expect(await bodyHtml(page)).not.toContain(TOKEN)
  })

  it('(7) OAuth (Linear) sin «Preguntar»: queda «Requiere autenticación» con el botón «Autenticar»', async () => {
    const { page } = app()
    const oldUrl = (await engineUrl(page))!
    const d = await open(page, 'Linear')
    await d.getByRole('switch', { name: 'Preguntar antes de cada uso' }).click()
    expect(await d.getByLabel('Configuración que se guardará').innerText()).not.toContain('permission')
    await d.getByRole('button', { name: 'Añadir y conectar' }).click()
    await expectCount(dialog(page), 0)
    expect(cfg().mcp.linear).toEqual({ type: 'remote', url: 'https://mcp.linear.app/mcp', enabled: true })
    expect(cfg().permission?.['linear_*']).toBeUndefined()
    // El estado simulado vive en el proceso del falso: el motor relanzado empieza limpio, así que se fija ahora.
    await awaitEngineRelaunch(oldUrl)
    await app().fake.set({ mcp: { linear: { status: 'needs_auth' } } })
    await expectVisible(row(page, 'linear').getByText('Conectado', { exact: true }))
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    const r = row(page, 'linear')
    await expectVisible(r.getByText('Requiere autenticación', { exact: true }))
    await expectVisible(r.getByRole('button', { name: 'Autenticar' }))
    await shot(app(), 'mcp-instalados')
  })

  it('(8) editar a mano una entrada del catálogo la marca como «Modificado»', async () => {
    const { page } = app()
    const r = row(page, 'context7')
    await r.getByRole('button', { name: 'Editar' }).click()
    await page.getByRole('button', { name: 'Remoto (URL)' }).click()
    await page.getByPlaceholder('https://mcp.ejemplo.com/mcp').fill('https://mcp.context7.com/otra-ruta')
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expectVisible(row(page, 'context7').getByText('Modificado', { exact: true }))
  })

  it('(9) eliminar limpia la entrada, su permiso «ask» y la procedencia', async () => {
    const { page } = app()
    const oldUrl = (await engineUrl(page))!
    await row(page, 'github').getByRole('button', { name: 'Eliminar' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar' }).click()
    await expectCount(row(page, 'github'), 0)
    await awaitEngineRelaunch(oldUrl)
    expect(cfg().mcp.github).toBeUndefined()
    expect(cfg().permission?.['github_*']).toBeUndefined()
    expect(cfg().permission?.['context7_*']).toBe('ask')
    expect(Object.keys(JSON.parse(readFileSync(provPath(), 'utf8'))).sort()).toEqual(['context7', 'linear'])
    expect(cfgRaw()).not.toContain(TOKEN)
    // La ficha vuelve a poder añadirse con su nombre.
    const d = await open(page, 'GitHub')
    expect(await d.getByLabel('Nombre del servidor').inputValue()).toBe('github')
    await d.getByRole('button', { name: 'Cancelar' }).click()
  })

  it('(10) cada ficha del catálogo coincide con la copia de main (id, URL y nombre)', async () => {
    const { page } = app()
    const state = await page.evaluate(() => (window as any).api.extras.invoke('mcp:catalog'))
    for (const it of state.items) {
      const mine = findCatalogItem(it.id)!
      expect(it.url).toBe(mine.url)
      expect(it.name).toBe(mine.name)
    }
    expect(Object.keys(state.installed).sort()).toEqual(['context7', 'linear'])
  })

  it('(11) con un turno en curso el conector se guarda pero el motor NO se relanza hasta que quede ocioso', async () => {
    const { page } = app()
    const sid = await newChatAndSend(app(), 'hola')
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('nav[aria-label="Secciones de ajustes"]').getByRole('button', { name: 'Conectores', exact: true }).click()
    await expectVisible(page.getByLabel('Catálogo de conectores'))
    await app().fake.set({ sessionStatus: { [sid]: 'busy' } })
    const oldUrl = (await engineUrl(page))!
    const d = await open(page, 'Sentry')
    await d.getByRole('button', { name: 'Añadir y conectar' }).click()
    await expectCount(dialog(page), 0)
    expect(Object.keys(cfg().mcp)).toContain('sentry')
    // Mientras hay un turno en curso el motor sigue siendo el mismo (el reintento es cada 15 s: se mira un buen rato).
    await page.waitForTimeout(4_000)
    expect(await engineUrl(page)).toBe(oldUrl)
    // El motor en marcha aún no lleva la regla «ask» del conector nuevo (se carga junto con él al relanzar).
    expect(((await app().fake.config()).config as { permission?: Record<string, string> }).permission?.['sentry_*']).toBeUndefined()
    await app().fake.set({ sessionStatus: { [sid]: 'idle' } })
    await awaitEngineRelaunch(oldUrl)
    const live = (await app().fake.config()).config as { mcp: Record<string, unknown>; permission?: Record<string, string> }
    expect(live.mcp.sentry).toBeDefined()
    expect(live.permission?.['sentry_*']).toBe('ask')
  })
})
