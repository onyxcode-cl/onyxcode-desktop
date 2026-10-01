// Calidad R2-C (F8-B36): accesibilidad en las vistas que faltaban. axe-core (claro y oscuro) sobre Ajustes (todas las secciones),
// Rutinas (lista y editor), diálogos (confirmación, catálogo MCP, primer uso, guía y grabación, píldora de plan), paneles de Code
// (cambios, terminal, archivos) y Tareas (aprobaciones, escalada), más foco: entra al diálogo, no se escapa con Tab, Esc cierra y
// el foco vuelve a quien lo abrió. Informe completo con RC_AXE_REPORT=/ruta.jsonl (y RC_AUDIT=1 no falla: solo cuenta); capturas con RC_SHOTS_DIR.
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE, startApp, type E2EApp } from '../lib/launch'
import { runAxe, SERIOUS, summarize, type AxeViolation } from '../lib/axe'
import { shot } from '../lib/shots'
import { expectVisible, expectCount } from '../lib/wait'
import { connectTasksFolderReady, makeGitRepo, makeHomeFolder, openCodeProject, prepareFakeBin } from '../lib/fase6'
import { storeSet } from '../lib/stores'
import { stubDialog } from '../lib/dialogs'
import { fakeOutsideUserData } from '../lib/lotes'
import { scriptFor } from '../lib/lru'

const SHOTS = process.env.RC_SHOTS_DIR
const REPORT = process.env.RC_AXE_REPORT
const AUDIT = process.env.RC_AUDIT === '1'

function report(view: string, v: Record<'light' | 'dark', AxeViolation[]>): void {
  if (REPORT) appendFileSync(REPORT, JSON.stringify({ view, violations: v }) + '\n')
}

/** axe sobre la página; falla con violaciones serias/críticas/moderadas (RC_AUDIT=1 solo las imprime). */
async function clean(page: Page, view: string): Promise<void> {
  const v = await runAxe(page)
  report(view, v)
  const bad = [...v.light, ...v.dark].filter((x) => x.impact && SERIOUS.has(x.impact))
  if (AUDIT) console.log(`AUDIT ${view}: ${bad.length} serias/moderadas; total ${v.light.length}/${v.dark.length}\n${summarize(v)}`)
  else expect(bad, `${view}\n${summarize(v)}`).toEqual([])
}

/** ¿El elemento enfocado está dentro de `dlg`? */
const focusInside = (dlg: Locator): Promise<boolean> => dlg.evaluate((el) => el.contains(document.activeElement))

/** Diálogo modal: el foco entra, Tab y Mayús+Tab no lo sacan, y (si `esc`) Esc lo cierra devolviendo el foco al `opener`. */
async function expectFocusContract(page: Page, dlg: Locator, opener: Locator | null, esc = true): Promise<void> {
  await expectVisible(dlg)
  await expect.poll(() => focusInside(dlg), { message: 'el foco entra al diálogo', timeout: 5_000 }).toBe(true)
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await focusInside(dlg), `Tab #${i + 1} dentro del diálogo`).toBe(true)
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Shift+Tab')
    expect(await focusInside(dlg), `Mayús+Tab #${i + 1} dentro del diálogo`).toBe(true)
  }
  if (!esc) return
  await page.keyboard.press('Escape')
  await expectCount(dlg, 0)
  if (opener) await expect.poll(() => opener.evaluate((el) => el === document.activeElement), { message: 'el foco vuelve al botón que abrió el diálogo' }).toBe(true)
}

const routine = (id: string, name: string, enabled: boolean): Record<string, unknown> => ({
  id, name, prompt: 'no hacer nada', mode: 'chat', folder: null, model: { providerID: 'fake', modelID: 'fake-model' },
  schedule: { kind: 'daily', time: '09:00' }, enabled, createdAt: Date.now(), updatedAt: Date.now()
})
const nav = (page: Page, name: string): Promise<void> => page.locator('nav[aria-label="Modo"]').getByRole('button', { name }).click()

// ───────────────────────── Ajustes, Rutinas, diálogos y ventanas propias ─────────────────────────
describe.skipIf(MODE === 'prod')(`calidad R2-C: Ajustes, Rutinas y diálogos (${MODE})`, () => {
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-rc-')))
  writeFileSync(
    join(userData, 'routines.json'),
    JSON.stringify({ routines: [routine('r-on', 'Rutina activa e2e', true), routine('r-off', 'Rutina pausada e2e', false)], history: [] })
  )
  afterAll(() => rmSync(userData, { recursive: true, force: true }))
  const app = useApp({ userData, settings: { routinesTermsAcknowledged: false } })

  it('Ajustes: todas las secciones sin violaciones', async () => {
    const { page } = app()
    await page.keyboard.press('Meta+,')
    const sections = page.locator('nav[aria-label="Secciones de ajustes"]')
    await expectVisible(sections)
    const n = await sections.getByRole('button').count()
    expect(n).toBeGreaterThanOrEqual(12)
    for (let i = 0; i < n; i++) {
      const b = sections.getByRole('button').nth(i)
      const name = (await b.innerText()).trim()
      await b.click()
      await page.waitForTimeout(400)
      await clean(page, `ajustes:${name}`)
      if (i === 0) await shot(app(), SHOTS, 'ajustes-general')
    }
  })

  it('Rutinas: lista y editor sin violaciones; el editor es un diálogo con foco contenido', async () => {
    const { page } = app()
    await nav(page, 'Rutinas')
    await expectVisible(page.getByRole('button', { name: /Rutina activa e2e/ }))
    await clean(page, 'rutinas:lista')
    await shot(app(), SHOTS, 'rutinas-lista')
    // Detalle de una rutina seleccionada.
    await page.getByRole('button', { name: /Rutina activa e2e/ }).first().click()
    await page.waitForTimeout(500)
    await clean(page, 'rutinas:detalle')
    const opener = page.getByRole('button', { name: 'Nueva rutina' }).first()
    await opener.click()
    const dlg = page.getByRole('dialog', { name: 'Nueva rutina' })
    await expectVisible(dlg)
    await clean(page, 'rutinas:editor')
    await shot(app(), SHOTS, 'rutinas-editor')
    // Otras pestañas de programación y el modo Tareas (reglas, hosts) y Code (carpeta).
    await dlg.getByRole('button', { name: 'Intervalo', exact: true }).click()
    await clean(page, 'rutinas:editor-intervalo')
    await dlg.getByRole('button', { name: 'Cron avanzado', exact: true }).click()
    await clean(page, 'rutinas:editor-cron')
    await dlg.getByRole('button', { name: /^Tareas/ }).click()
    await dlg.getByRole('button', { name: 'Añadir regla' }).click()
    await clean(page, 'rutinas:editor-tareas')
    await dlg.getByRole('button', { name: /^Code/ }).click()
    await clean(page, 'rutinas:editor-code')
    await expectFocusContract(page, dlg, opener)
  })

  it('Diálogo de confirmación (términos de Rutinas): foco inicial, trampa, Esc y devolución del foco', async () => {
    const { page } = app()
    await nav(page, 'Rutinas')
    const sw = page.getByRole('switch', { name: /Activar/ }).first()
    await sw.click()
    const dlg = page.getByRole('alertdialog', { name: 'Rutinas y los términos de OpenCode' })
    await expectVisible(dlg)
    await clean(page, 'dialogo:confirmacion')
    await shot(app(), SHOTS, 'dialogo-confirmacion')
    await expectFocusContract(page, dlg, sw)
  })

  it('Catálogo MCP: diálogo de añadir sin violaciones y con foco contenido', async () => {
    const { page } = app()
    await page.keyboard.press('Meta+,')
    await page.locator('nav[aria-label="Secciones de ajustes"]').getByRole('button', { name: 'MCP', exact: true }).click()
    const opener = page.getByRole('button', { name: 'Añadir Context7' })
    await opener.click()
    const dlg = page.getByRole('dialog', { name: /^Añadir / })
    await expectVisible(dlg)
    await clean(page, 'dialogo:mcp-catalogo')
    await shot(app(), SHOTS, 'dialogo-mcp')
    await expectFocusContract(page, dlg, opener)
  })

  it('Tareas sin carpeta (primer uso): sin violaciones', async () => {
    const { page } = app()
    await nav(page, 'Tareas')
    await page.waitForTimeout(600)
    await clean(page, 'tareas:primer-uso')
  })

  describe('ventanas propias (píldora, guía, grabación, Quick Entry)', () => {
    let opened = 0
    const open = async (url: string): Promise<Page> => {
      const { electronApp } = app()
      const nonce = `n=${++opened}`
      const [path, hash = ''] = url.split('#')
      const full = `${path}${path.includes('?') ? '&' : '?'}${nonce}${hash ? `#${hash}` : ''}`
      await electronApp.evaluate(({ BrowserWindow }, u) => {
        const w = new BrowserWindow({ show: false, width: 460, height: 560, backgroundColor: '#1d1d1f' })
        void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${u}`)
      }, full)
      await expect.poll(() => electronApp.windows().some((p) => p.url().includes(nonce)), { timeout: 15_000 }).toBe(true)
      const page = electronApp.windows().find((p) => p.url().includes(nonce))!
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(500)
      return page
    }
    const close = (needle: string): Promise<void> =>
      app().electronApp.evaluate(({ BrowserWindow }, n) => {
        for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes(n)) w.destroy()
      }, needle)

    for (const [view, url, needle] of [
      ['pildora:plan', 'overlay/pill.html#demo-plan', 'overlay/pill.html'],
      ['pildora:toma-de-control', 'overlay/pill.html#demo-takeover', 'overlay/pill.html'],
      ['pildora:estado', 'overlay/pill.html#demo', 'overlay/pill.html'],
      ['guia', 'overlay/assist.html#teach', 'overlay/assist.html'],
      ['grabacion', 'overlay/assist.html#record', 'overlay/assist.html']
    ] as const) {
      it(`${view}: axe sin violaciones`, async () => {
        const p = await open(url)
        try {
          // Hace visibles los estados que la ventana real recibe por IPC (guía y grabación empiezan ocultas).
          await p.evaluate(() => document.body.classList.add('on'))
          await clean(p, `ventana:${view}`)
        } finally {
          await close(needle)
        }
      })
    }
  })
})

// ───────────────────────── Primer uso (asistente) ─────────────────────────
describe.skipIf(MODE === 'prod')(`calidad R2-C: asistente de primer uso (${MODE})`, () => {
  let app: E2EApp | null = null
  let userData = ''
  let home = ''
  let env: Record<string, string> = {}
  const fakeBin = fakeOutsideUserData()
  beforeAll(() => {
    userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-rc-onb-')))
    home = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-rc-onb-home-')))
    mkdirSync(join(home, '.opencode', 'bin'), { recursive: true })
    env = { OPENCODE_BIN: join(home, 'no-existe', 'opencode'), HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }
  })
  afterAll(async () => {
    await app?.stop()
    fakeBin.dispose()
    for (const d of [userData, home]) if (d) rmSync(d, { recursive: true, force: true })
  })

  it('los cinco pasos del asistente, sin violaciones y con el foco contenido', async () => {
    app = await startApp({ userData, keepUserData: true, noServer: true, env, settings: { onboarded: false } })
    const a = app
    const d = a.page.getByRole('dialog')
    await expectVisible(d.getByRole('heading', { name: 'Instala o localiza OpenCode' }))
    await expectVisible(d.getByRole('alert').filter({ hasText: 'No se encontró el binario' }))
    await clean(a.page, 'asistente:paso1-error')
    await shot(a, SHOTS, 'asistente-paso1')
    await expectFocusContract(a.page, d, null, false)

    await stubDialog(a.electronApp, { openPaths: [fakeBin.bin] })
    await d.getByRole('button', { name: 'Elegir binario…' }).click()
    await expectVisible(d.getByText('OpenCode está en marcha.'))
    await expect.poll(() => d.getByRole('button', { name: 'Continuar' }).isEnabled()).toBe(true)
    await clean(a.page, 'asistente:paso1-listo')
    await a.connectFake()
    await d.getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(d.getByRole('heading', { name: 'Conecta tu IA' }))
    await clean(a.page, 'asistente:paso2')
    await shot(a, SHOTS, 'asistente-paso2')
    await d.getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(d.getByRole('heading', { name: 'Elige tu modelo' }))
    await clean(a.page, 'asistente:paso3')
    await d.getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(d.getByRole('heading', { name: 'Los cuatro modos' }))
    await clean(a.page, 'asistente:paso4')
    await d.getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(d.getByRole('heading', { name: 'Permisos de macOS' }))
    await clean(a.page, 'asistente:paso5')
    await shot(a, SHOTS, 'asistente-paso5')
  })
})

// ───────────────────────── Code y Tareas con datos falsos ─────────────────────────
describe.skipIf(MODE === 'prod')(`calidad R2-C: Code y Tareas (${MODE})`, () => {
  const res = {} as { bin: ReturnType<typeof prepareFakeBin>; folder: ReturnType<typeof makeHomeFolder> }
  const env: Record<string, string> = {}
  let repo = ''
  beforeAll(() => {
    res.bin = prepareFakeBin()
    res.folder = makeHomeFolder()
    repo = makeGitRepo()
    writeFileSync(join(repo, 'README.md'), '# e2e\ncambio sin confirmar\n')
    writeFileSync(join(repo, 'nuevo.txt'), 'archivo nuevo\n')
    Object.assign(env, res.bin.env)
  })
  const app = useApp({ env })
  afterAll(() => {
    res.folder?.cleanup()
    res.bin?.cleanup()
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  it('Code: diálogo de confianza de la carpeta (foco contenido) y sin violaciones', async () => {
    const a = app()
    await stubDialog(a.electronApp, { openPaths: [repo] })
    await nav(a.page, 'Code')
    const opener = a.page.getByRole('button', { name: /Abrir carpeta/ }).first()
    await opener.click()
    const dlg = a.page.getByRole('alertdialog', { name: '¿Confiar en esta carpeta?' })
    await expectVisible(dlg)
    await clean(a.page, 'code:confianza')
    await shot(a, SHOTS, 'code-confianza')
    await expectFocusContract(a.page, dlg, opener, false)
    await a.page.getByRole('button', { name: 'Confiar y continuar' }).click()
    await expectCount(dlg, 0)
  })

  it('Code: paneles Cambios, Terminal y Archivos sin violaciones', async () => {
    const a = app()
    await openCodeProject(a, repo)
    for (const [name, text] of [
      ['Cambios', /README\.md/],
      ['Terminal', null],
      ['Archivos', /README\.md/]
    ] as const) {
      const btn = a.page.locator(`button[aria-label="${name}"]`)
      if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click()
      if (text) await expectVisible(a.page.getByText(text).first(), 20_000)
      await a.page.waitForTimeout(700)
      await clean(a.page, `code:panel-${name}`)
      await shot(a, SHOTS, `code-panel-${name.toLowerCase()}`)
    }
  })

  it('Code: cambiar de sesión (selector) como diálogo con foco', async () => {
    const a = app()
    await a.page.keyboard.press('Meta+k')
    const dlg = a.page.getByRole('dialog', { name: 'Cambiar de sesión' })
    await expectVisible(dlg)
    await clean(a.page, 'code:selector-sesion')
    await expectFocusContract(a.page, dlg, null, false)
    await a.page.keyboard.press('Escape')
  })

  it('Code: diálogo «Nueva rama en un worktree» con foco contenido', async () => {
    const a = app()
    const opener = a.page.getByRole('button', { name: 'Nueva rama / worktree' }).first()
    if (!(await opener.isVisible())) await a.page.locator('button[aria-label="Cambios"]').click()
    await expectVisible(opener, 20_000)
    await opener.click()
    const dlg = a.page.getByRole('dialog', { name: 'Nueva rama en un worktree' })
    await expectVisible(dlg)
    await clean(a.page, 'code:worktree')
    await shot(a, SHOTS, 'code-worktree')
    await expectFocusContract(a.page, dlg, opener)
  })

  it('Code: permiso del agente sin violaciones', async () => {
    const a = app()
    await a.fake.script({
      match: 'pide permiso rc',
      steps: [{ type: 'text', text: 'Voy a ejecutar un comando.' }, { type: 'permission', permission: 'bash', patterns: ['echo rc'] }]
    })
    const box = a.page.getByRole('combobox', { name: 'Mensaje para el asistente' })
    await box.fill('pide permiso rc')
    await box.press('Enter')
    const allow = a.page.getByRole('button', { name: /Permitir/ }).first()
    await expectVisible(allow, 30_000)
    await clean(a.page, 'code:permiso')
    await shot(a, SHOTS, 'code-permiso')
    await a.page.getByRole('button', { name: /Denegar|Rechazar/ }).first().click()
  })

  it('Tareas: aprobaciones (permiso y pregunta) y escalada sin violaciones', async () => {
    const a = app()
    // Elegir carpeta: diálogo de confirmación de la carpeta (con foco contenido) y luego Tareas lista.
    await stubDialog(a.electronApp, { openPaths: [res.folder.path] })
    await nav(a.page, 'Tareas')
    const choose = a.page.getByRole('button', { name: 'Elegir carpeta' }).first()
    await choose.click()
    const confirm = a.page.getByRole('dialog').filter({ has: a.page.getByRole('button', { name: 'Permitir', exact: true }) })
    await expectVisible(confirm)
    await clean(a.page, 'tareas:confirmar-carpeta')
    await shot(a, SHOTS, 'tareas-confirmar-carpeta')
    await expectFocusContract(a.page, confirm, choose, false)
    await a.page.getByRole('button', { name: 'Permitir', exact: true }).click()
    const { fake } = await connectTasksFolderReady(a)
    const box = a.page.getByPlaceholder('Describe la tarea que quieres delegar…')
    const send = async (text: string): Promise<void> => {
      await a.page.getByRole('button', { name: 'Nueva tarea' }).first().click()
      await box.fill(text)
      await a.page.getByRole('button', { name: 'Enviar' }).first().click()
    }
    // Permiso
    await fake.script({
      match: 'tarea con permiso',
      steps: [{ type: 'text', text: 'Necesito ejecutar algo.' }, { type: 'permission', permission: 'bash', patterns: ['echo rc'] }]
    })
    await send('tarea con permiso')
    const deny = a.page.getByRole('button', { name: 'Rechazar', exact: true }).first()
    await expectVisible(a.page.getByRole('button', { name: 'Permitir una vez' }).first(), 30_000)
    await clean(a.page, 'tareas:permiso')
    await shot(a, SHOTS, 'tareas-permiso')
    await deny.click()
    await expectCount(deny, 0)
    // Pregunta
    await fake.script({
      match: 'tarea con pregunta',
      steps: [
        {
          type: 'question',
          questions: [{ question: '¿Qué formato prefieres?', header: 'Formato', options: [{ label: 'PDF', description: 'Documento' }, { label: 'Word', description: 'Editable' }], multiple: false, custom: true }]
        }
      ]
    })
    await send('tarea con pregunta')
    await expectVisible(a.page.getByText('¿Qué formato prefieres?'), 30_000)
    await clean(a.page, 'tareas:pregunta')
    await shot(a, SHOTS, 'tareas-pregunta')
    await a.page.getByRole('button', { name: 'Omitir', exact: true }).first().click()
    // Escalada
    await scriptFor(fake, 'tarea que escala', 'Esto necesita control total del Mac. [[ONYX:NEEDS_FULL_CONTROL]]')
    await send('tarea que escala')
    const esc = a.page.getByRole('button', { name: /control total/i }).first()
    await expectVisible(esc, 30_000)
    await clean(a.page, 'tareas:escalada')
    await shot(a, SHOTS, 'tareas-escalada')
  })

  it('Tareas: diálogo «¿Permitir que el agente controle tu Mac?» con foco contenido', async () => {
    const a = app()
    await storeSet(a.page, 'useTasks', { pendingFullAccess: res.folder.path })
    const dlg = a.page.getByRole('alertdialog').first()
    await expectVisible(dlg)
    await clean(a.page, 'tareas:control-total-dialogo')
    await shot(a, SHOTS, 'tareas-control-total')
    await expectFocusContract(a.page, dlg, null, false)
    await a.page.keyboard.press('Escape')
    await expectCount(dlg, 0)
  })

  it('Tareas: tarjetas de acceso a apps (plan y toma de control) sin violaciones', async () => {
    const a = app()
    const apps = [
      { bundleId: 'com.apple.Notes', name: 'Notas', requested: 'click', current: null },
      { bundleId: 'com.apple.Safari', name: 'Safari', requested: 'full', current: 'view' }
    ]
    await storeSet(a.page, 'useTasks', { accessRequest: { id: 'rc-plan', apps, reason: 'Para ordenar tus notas', plan: ['Abrir Notas', 'Copiar el texto', 'Pegarlo en Safari'] } })
    await expectVisible(a.page.getByRole('alertdialog').first())
    await clean(a.page, 'tareas:acceso-plan')
    await shot(a, SHOTS, 'tareas-acceso-plan')
    await storeSet(a.page, 'useTasks', { accessRequest: { id: 'rc-take', kind: 'takeover', apps: [apps[0]], reason: 'Necesita el ratón' } })
    await expectVisible(a.page.getByRole('alertdialog').first())
    await clean(a.page, 'tareas:toma-de-control')
    await shot(a, SHOTS, 'tareas-toma-de-control')
    await storeSet(a.page, 'useTasks', { accessRequest: null })
  })

  it('Tareas: diálogo de renombrar (prompt) y paleta de comandos con foco contenido', async () => {
    const a = app()
    const more = a.page.locator('[aria-label^="Más acciones de la tarea «"]').first()
    await more.click()
    await a.page.getByRole('menuitem', { name: 'Renombrar' }).click()
    const dlg = a.page.getByRole('dialog', { name: 'Nuevo nombre de la tarea' })
    await expectVisible(dlg)
    await clean(a.page, 'dialogo:prompt')
    await shot(a, SHOTS, 'dialogo-prompt')
    await expectFocusContract(a.page, dlg, null)
    await a.page.keyboard.press('Meta+k')
    const pal = a.page.getByRole('dialog', { name: 'Paleta de comandos' })
    await expectVisible(pal)
    await clean(a.page, 'paleta')
    await shot(a, SHOTS, 'paleta')
    await expectFocusContract(a.page, pal, null)
  })

  it('Tareas: grabar una skill (diálogo del panel del proyecto) con foco contenido', async () => {
    const a = app()
    await storeSet(a.page, 'useTasks', { projectPanelOpen: true })
    const opener = a.page.getByRole('button', { name: 'Grabar una skill' })
    await expectVisible(opener, 20_000)
    await opener.click()
    const dlg = a.page.getByRole('dialog', { name: /./ }).last()
    await expectVisible(a.page.getByRole('button', { name: /^Empezar|^Grabar|^Iniciar/ }).last())
    await clean(a.page, 'tareas:grabar-skill')
    await shot(a, SHOTS, 'tareas-grabar-skill')
    await expectFocusContract(a.page, dlg, null, false)
    await a.page.keyboard.press('Escape')
    await storeSet(a.page, 'useTasks', { projectPanelOpen: false })
  })

  it('Tareas: panel del proyecto como diálogo con foco', async () => {
    const a = app()
    await storeSet(a.page, 'useTasks', { projectPanelOpen: true })
    const dlg = a.page.getByRole('dialog').first()
    await expectVisible(dlg)
    await a.page.waitForTimeout(500)
    await clean(a.page, 'tareas:panel-proyecto')
    await expectFocusContract(a.page, dlg, null, false)
    await a.page.keyboard.press('Escape')
    await expectCount(dlg, 0)
  })
})
