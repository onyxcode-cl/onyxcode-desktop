// Lo automatizable de las guías manuales de los Lotes B (Tareas, docs/TASKS-LOTE-B.md §4) y D (navegador integrado,
// docs/LOTE-D.md §4) contra la app real de Electron y el OpenCode falso. Ver el mapa en docs/VERIFICACION.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stubDialog } from '../lib/dialogs'
import { useApp } from '../lib/harness'
import { BrowserMcp, tasksFake, fakeOutsideUserData, killByPath, makeTasksDir, neutralizeNativeApprovalDialog, prepareCodeBrowser, servePages, waitUserIdle, type PageServer } from '../lib/lotes'
import { MODE, startApp, type E2EApp } from '../lib/launch'
import { MODE_LABELS, UI_LABELS } from '../../src/shared/labels'
import { setMode, storeCall, storeState, waitForHooks } from '../lib/stores'
import { expectVisible } from '../lib/wait'

const fakeBin = fakeOutsideUserData()
const work = makeTasksDir()
afterAll(() => {
  fakeBin.dispose()
  work.dispose()
})

const DEV = MODE === 'dev'

async function goTasks(app: E2EApp): Promise<void> {
  await app.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: MODE_LABELS.tasks }).click()
}

async function openSettings(app: E2EApp, section: string): Promise<void> {
  await app.page.keyboard.press('Meta+,')
  const nav = app.page.locator('nav[aria-label="Secciones de ajustes"]')
  await expectVisible(nav)
  await nav.getByRole('button', { name: section, exact: true }).click()
}

/** Elige carpeta con el diálogo sustituido y pulsa «Permitir» en la confirmación de Tareas. */
async function pickFolder(app: E2EApp, path: string): Promise<void> {
  await stubDialog(app.electronApp, { openPaths: [path] })
  await app.page.getByRole('button', { name: 'Elegir carpeta' }).first().click()
  await app.page.getByRole('dialog').getByRole('button', { name: 'Permitir', exact: true }).click()
}

describe.skipIf(!DEV)('Lote B: Tareas (guion manual §4, pasos 1, 2, 3, 11, 13)', () => {
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin } })

  it('paso 1: el onboarding se descarta y no vuelve tras recargar', async () => {
    const a = app()
    await goTasks(a)
    await expectVisible(a.page.getByText('Así funcionan las tareas'))
    await a.page.getByRole('button', { name: 'Entendido, no mostrar más' }).click()
    await expect.poll(() => a.page.getByText('Así funcionan las tareas').count()).toBe(0)
    await a.page.reload({ waitUntil: 'domcontentloaded' })
    await waitForHooks(a.page)
    await a.page.locator('nav[aria-label="Modo"]').waitFor()
    await goTasks(a)
    await expectVisible(a.page.getByText('¿En qué trabajamos hoy?'))
    expect(await a.page.getByText('Así funcionan las tareas').count()).toBe(0)
  })

  const ROOT_MSG = 'No se puede usar la raíz del disco ni tu carpeta personal completa.'
  const LIB_MSG = 'Esa es una ubicación protegida de macOS (Library)'

  it('paso 2: carpetas prohibidas (~ y ~/Library) se rechazan con su mensaje concreto (estado del store)', async () => {
    const a = app()
    await goTasks(a)
    await pickFolder(a, homedir())
    await expect.poll(() => storeState<string | null>(a.page, 'useTasks', 'error')).toContain(ROOT_MSG)
    await pickFolder(a, join(homedir(), 'Library'))
    await expect.poll(() => storeState<string | null>(a.page, 'useTasks', 'error')).toContain(LIB_MSG)
    expect(await storeState(a.page, 'useTasks', 'folder')).toBeNull()
    expect(await a.page.getByRole('dialog').count()).toBe(0)
  })

  // F7-B4: el motivo de la carpeta rechazada se pinta en un banner `role="alert"` con «Cerrar».
  it('paso 2 (UI): el mensaje de carpeta prohibida es visible para el usuario y se puede cerrar', async () => {
    const a = app()
    await goTasks(a)
    await pickFolder(a, homedir())
    await expect.poll(() => storeState<string | null>(a.page, 'useTasks', 'error')).toContain(ROOT_MSG)
    await expectVisible(a.page.getByRole('alert').getByText(ROOT_MSG), 3_000)
    await pickFolder(a, join(homedir(), 'Library'))
    await expectVisible(a.page.getByRole('alert').getByText(LIB_MSG, { exact: false }), 3_000)
    await a.page.getByRole('alert').getByRole('button', { name: 'Cerrar' }).click()
    await expect.poll(() => storeState(a.page, 'useTasks', 'error')).toBeNull()
    expect(await a.page.getByRole('alert').getByText(LIB_MSG, { exact: false }).count()).toBe(0)
  })

  it('paso 3 (preparación): una carpeta válida arranca el servidor Tareas (sandbox Seatbelt + OpenCode falso)', async () => {
    const a = app()
    await goTasks(a)
    await pickFolder(a, work.dir)
    await expect.poll(() => storeState(a.page, 'useTasks', 'phase'), { timeout: 60_000 }).toBe('ready')
    expect(await storeState<{ sandboxed: boolean }>(a.page, 'useTasks', 'conn')).toMatchObject({ sandboxed: true })
    await expectVisible(a.page.getByText('Sandbox activo'))
  })

  async function sendTask(a: E2EApp, text: string): Promise<void> {
    const box = a.page.getByPlaceholder('Describe la tarea que quieres delegar…')
    await box.fill(text)
    await a.page.getByRole('button', { name: 'Enviar' }).click()
  }

  it('paso 3: permission.asked de external_directory muestra «El agente quiere trabajar en otra carpeta»', async () => {
    const a = app()
    const cw = await tasksFake(a.page)
    const other = join(homedir(), 'onyx-e2e-otra-carpeta')
    await cw.script({
      steps: [
        { type: 'text', text: 'Voy a leer otra carpeta.' },
        {
          type: 'permission',
          permission: 'external_directory',
          patterns: [`${other}/*`],
          metadata: { parentDir: other, reason: 'Necesito leer los informes' }
        }
      ]
    })
    await sendTask(a, 'Resume los informes de otra carpeta')
    const card = a.page.getByText('El agente quiere trabajar en otra carpeta')
    await expectVisible(card, 30_000)
    await expectVisible(a.page.getByText('Carpeta que pide el agente'))
    await expectVisible(a.page.getByText(other, { exact: true }))
    await expectVisible(a.page.getByText('Motivo (según el agente, no verificado)'))
    // Sin rechazar la petición la tarea quedaría en espera: «Denegar» la responde y libera la sesión.
    await a.page.getByRole('button', { name: 'Denegar' }).click()
    await expect.poll(() => card.count(), { timeout: 15_000 }).toBe(0)
  })

  it('paso 11: fijar, archivar y restaurar una tarea', async () => {
    const a = app()
    const more = a.page.locator('[aria-label^="Más acciones de la tarea «"]').first()
    await expectVisible(more.locator('..'))
    const menu = a.page.getByRole('menu', { name: 'Acciones de la tarea' })
    const act = async (label: string): Promise<void> => {
      await more.click()
      await menu.getByText(label, { exact: true }).click()
    }
    await act('Fijar')
    await expectVisible(a.page.locator('section[aria-label="Fijadas"]'))
    await more.click()
    await expectVisible(menu.getByText('Desfijar', { exact: true }))
    await a.page.keyboard.press('Escape')
    await act('Archivar')
    await expect.poll(() => a.page.locator('[aria-label^="Más acciones de la tarea «"]').count()).toBe(0)
    await a.page.getByRole('button', { name: /^Archivadas/ }).click()
    await expectVisible(a.page.getByRole('button', { name: 'Restaurar' }))
    await a.page.getByRole('button', { name: 'Restaurar' }).click()
    await a.page.getByTitle('Volver a las tareas').click()
    await expectVisible(a.page.locator('[aria-label^="Más acciones de la tarea «"]').first().locator('..'))
  })

  it('paso 13: exportar a Markdown escribe el archivo con la conversación (diálogo de guardado sustituido)', async () => {
    const a = app()
    const out = join(work.dir, 'exportada.md')
    await stubDialog(a.electronApp, { savePath: out })
    const more = a.page.locator('[aria-label^="Más acciones de la tarea «"]').first()
    await more.locator('xpath=ancestor::div[contains(@class,"group")][1]//button[contains(@class,"flex-1")]').click()
    await a.page.getByLabel('Más acciones de la tarea', { exact: true }).click()
    await a.page.getByText('Exportar a Markdown', { exact: true }).click()
    await expect.poll(() => existsSync(out), { timeout: 15_000 }).toBe(true)
    const md = readFileSync(out, 'utf8')
    expect(md).toContain('Resume los informes de otra carpeta')
    await expectVisible(a.page.getByText(`Conversación guardada en ${out}`))
  })
})

// ─────────────────────────── Lote B, paso 22: política gestionada ───────────────────────────

/** `managed.json` de prueba (solo con la app sin empaquetar: `ONYXCODE_MANAGED_POLICY`, policy.ts `policyFile`). */
function writePolicy(name: string, content: string): string {
  const dir = join(work.dir, 'policy')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, content)
  return file
}

describe.skipIf(!DEV)('Lote B: política gestionada (paso 22)', () => {
  let app: E2EApp
  beforeAll(async () => {
    const file = writePolicy('managed.json', JSON.stringify({ disableRoutines: true, disableBrowser: true, allowedFolderRoots: [join(homedir(), 'Documents')] }))
    app = await startApp({ env: { OPENCODE_BIN: fakeBin.bin, ONYXCODE_MANAGED_POLICY: file } })
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('Ajustes → Tareas muestra «Gestionado por tu organización» con las restricciones', async () => {
    await openSettings(app, UI_LABELS.tasksMode)
    const banner = app.page.getByRole('status').filter({ hasText: 'Gestionado por tu organización' })
    await expectVisible(banner)
    await expectVisible(app.page.getByText('Las rutinas están desactivadas.'))
    await expectVisible(app.page.getByText('Las carpetas solo pueden estar dentro de:'))
    await app.page.keyboard.press('Escape')
  })

  it('Ajustes → Navegador refleja disableBrowser y bloquea el interruptor', async () => {
    await openSettings(app, 'Navegador')
    await expectVisible(app.page.getByText('Tu organización desactivó el navegador integrado.'))
    await expect.poll(() => app.page.getByRole('switch', { name: /Permitir que el agente use el navegador en Code/ }).isDisabled()).toBe(true)
    await app.page.keyboard.press('Escape')
  })

  it('una carpeta fuera de allowedFolderRoots se rechaza con el motivo de la organización', async () => {
    await goTasks(app)
    await pickFolder(app, work.dir)
    await expect.poll(() => storeState<string | null>(app.page, 'useTasks', 'error')).toContain('Tu organización solo permite carpetas dentro de')
    expect(await storeState(app.page, 'useTasks', 'folder')).toBeNull()
  })
})

describe.skipIf(!DEV)('Lote B: política gestionada con JSON inválido (falla cerrado)', () => {
  let app: E2EApp
  beforeAll(async () => {
    const file = writePolicy('roto.json', '{ esto no es json')
    app = await startApp({ env: { OPENCODE_BIN: fakeBin.bin, ONYXCODE_MANAGED_POLICY: file } })
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('activa todas las restricciones booleanas', async () => {
    await openSettings(app, UI_LABELS.tasksMode)
    await expectVisible(app.page.getByRole('status').filter({ hasText: 'Gestionado por tu organización' }))
    for (const t of ['Control total del Mac está desactivado.', 'Las rutinas están desactivadas.', 'No se pueden añadir sitios a la red del sandbox.', 'No se pueden recordar permisos con «Siempre permitir».'])
      await expectVisible(app.page.getByText(t))
    await app.page.keyboard.press('Escape')
    // El error de lectura del JSON lo escribe main con console.error a propósito.
    app.errors.length = 0
  })
})

// ─────────────────────────── Lote D: navegador integrado (guion manual §4) ───────────────────────────

const TIENDA = readFileSync(join(__dirname, '..', 'pages', 'tienda.html'), 'utf8')

interface BrowserTabInfo {
  id: string
  url: string
  title: string
}

describe.skipIf(!DEV)('Lote D: navegador integrado', () => {
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin } })
  let tienda: PageServer
  let secundario: PageServer
  let mcp: BrowserMcp
  let sessionId: string
  let project: ReturnType<typeof makeTasksDir>

  beforeAll(async () => {
    project = makeTasksDir()
    tienda = await servePages({ '/': TIENDA, '/otra': '<title>otra</title><p>otra página</p>' })
    secundario = await servePages({ '/secreto': 'no deberías verme' })
  })
  afterAll(async () => {
    await tienda?.close()
    await secundario?.close()
    project?.dispose()
  })

  /** Pestañas del owner de Code (estado real de main, por IPC del renderer). */
  const tabs = (): Promise<BrowserTabInfo[]> =>
    app().page.evaluate(async (directory) => {
      const w = window as unknown as { api: { browser: { invoke: (c: string, r: unknown) => Promise<{ tabs: BrowserTabInfo[] }> } } }
      return (await w.api.browser.invoke('browser:state', { owner: { kind: 'code', directory } })).tabs
    }, project.dir)

  /** Campo de la barra de URL (si no está en edición, se abre pulsando la URL). */
  const urlInput = async (a: E2EApp): Promise<ReturnType<E2EApp['page']['getByPlaceholder']>> => {
    const input = a.page.getByPlaceholder('Escribe una URL')
    if ((await input.count()) === 0) await a.page.locator('form button.text-left').first().click()
    await input.waitFor()
    return input
  }

  const tabTitle = async (): Promise<string | undefined> => (await tabs()).at(-1)?.title

  const card = (): ReturnType<E2EApp['page']['getByRole']> => app().page.getByRole('group', { name: 'Aprobación del navegador' })

  it('preparación: proyecto y sesión de Code, panel Navegador abierto y MCP del navegador en la config', async () => {
    const a = app()
    await neutralizeNativeApprovalDialog(a)
    await setMode(a.page, 'code')
    await storeCall(a.page, 'useCode', 'trustFolder', project.dir) // sin diálogo de trust al reconectar (F7-G4)
    await storeCall(a.page, 'useCode', 'openProject', project.dir)
    sessionId = (await storeCall<string | null>(a.page, 'useCode', 'newSessionAt', project.dir)) ?? ''
    expect(sessionId).toMatch(/^ses_/)
    const cfg = await a.fake.config()
    const browser = (cfg.content as { mcp?: { browser?: { url: string; headers: { Authorization: string } } } }).mcp?.browser
    expect(browser?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(browser?.headers.Authorization).toMatch(/^Bearer .{20,}/)
    mcp = new BrowserMcp(browser!.url, browser!.headers.Authorization.slice('Bearer '.length))
    await a.page.keyboard.press('Meta+4')
    await expectVisible(a.page.getByText('Sin pestañas abiertas'))
    // Una pestaña humana antes del agente: así el panel ya está alojado y visible en main (`hasVisibleHost`) y la aprobación
    // sale como tarjeta en la ventana; sin anfitrión visible, main cae al diálogo nativo (bloqueante) de respaldo.
    await a.page.getByTitle('Nueva pestaña').click()
    await expect.poll(async () => (await tabs()).length).toBe(1)
  })

  it('el navegador del agente viene desactivado: el MCP lo rechaza hasta activarlo en Ajustes → Navegador', async () => {
    const a = app()
    await mcp.initialize()
    expect(await mcp.tools()).toEqual(expect.arrayContaining(['new_page', 'take_snapshot', 'click', 'fill']))
    const off = await mcp.call(sessionId, 'list_pages')
    expect(off.isError).toBe(true)
    expect(off.text).toContain('desactivado')
    await openSettings(a, 'Navegador')
    const toggle = a.page.getByRole('switch', { name: 'Permitir que el agente use el navegador en Code' })
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await a.page.keyboard.press('Escape')
    const on = await mcp.call(sessionId, 'list_pages')
    expect(on.isError).toBe(false)
  })

  it('un cliente sin Bearer válido o con cabecera Origin no entra al MCP', async () => {
    const bad = await fetch(mcp.url, { method: 'POST', headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, body: '{}' })
    expect(bad.status).toBe(401)
    const origin = await fetch(mcp.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${mcp.token}`, origin: 'http://evil.example', 'content-type': 'application/json' },
      body: '{}'
    })
    expect(origin.status).toBe(403)
  })

  it('new_page a un origen local pide la tarjeta «tu servidor local»; «Permitir en esta tarea» abre la tienda', async () => {
    const a = app()
    await waitUserIdle(a.page, project.dir)
    const opening = mcp.call(sessionId, 'new_page', { url: `${tienda.origin}/` })
    await expectVisible(card().getByText(`¿Dejar que el agente abra tu servidor local 127.0.0.1:${tienda.port}?`), 30_000)
    const allow = card().getByRole('button', { name: 'Permitir en esta tarea' })
    await expect.poll(() => allow.isEnabled(), { timeout: 5_000 }).toBe(true)
    await allow.click()
    const res = await opening
    expect(res.isError, res.text).toBe(false)
    expect(res.text).toContain('Pestaña nueva abierta')
    await expect.poll(async () => (await tabs()).at(-1)?.title).toBe('Tienda de prueba')
  })

  async function uidOf(name: string, role = ''): Promise<string> {
    const snap = await mcp.call(sessionId, 'take_snapshot')
    expect(snap.isError, snap.text).toBe(false)
    const line = snap.text.split('\n').find((l) => l.includes(`"${name}`) && (!role || l.includes(`- ${role} `)))
    expect(line, `snapshot sin «${name}»:\n${snap.text}`).toBeTruthy()
    const m = /uid=(s\d+_\d+)/.exec(line!)
    expect(m, `sin uid en: ${line}`).toBeTruthy()
    return m![1]
  }

  it('click en «Pagar ahora»: aparece la tarjeta «acción sensible»; «Permitir» hace el clic (título «pagado»)', async () => {
    const a = app()
    const uid = await uidOf('Pagar ahora')
    await waitUserIdle(a.page, project.dir)
    const clicking = mcp.call(sessionId, 'click', { uid })
    await expectVisible(card().getByText(`pulsar "Pagar ahora" en 127.0.0.1`), 30_000)
    expect(await tabTitle()).toBe('Tienda de prueba') // nada ocurrió antes de aprobar
    const allow = card().getByRole('button', { name: 'Permitir', exact: true })
    await expect.poll(() => allow.isEnabled(), { timeout: 5_000 }).toBe(true)
    await allow.click()
    const res = await clicking
    expect(res.isError, res.text).toBe(false)
    await expect.poll(tabTitle).toBe('pagado')
    expect(await card().count()).toBe(0)
    void a
  })

  it('click en «Pagar ahora» con «Cancelar»: error del MCP y la página queda intacta', async () => {
    const a = app()
    const nav = await mcp.call(sessionId, 'navigate_page', { type: 'reload' })
    expect(nav.isError, nav.text).toBe(false)
    await expect.poll(tabTitle).toBe('Tienda de prueba')
    const uid = await uidOf('Pagar ahora')
    await waitUserIdle(a.page, project.dir)
    const clicking = mcp.call(sessionId, 'click', { uid })
    await expectVisible(card().getByText(`pulsar "Pagar ahora" en 127.0.0.1`), 30_000)
    const cancel = card().getByRole('button', { name: 'Cancelar' })
    await expect.poll(() => cancel.isEnabled(), { timeout: 5_000 }).toBe(true)
    await cancel.click()
    const res = await clicking
    expect(res.isError).toBe(true)
    expect(res.text).toContain('El usuario no confirmó esta acción sensible')
    expect(await tabTitle()).toBe('Tienda de prueba')
  })

  // F7-B2: `ApprovalCard` enfoca el botón de denegar en cuanto se arma (antes lo hacía al montar, con el botón `disabled`, y no recibía foco).
  it('la tarjeta sensible deja el foco por defecto en «Cancelar» una vez armada', async () => {
    const a = app()
    const uid = await uidOf('Pagar ahora')
    await waitUserIdle(a.page, project.dir)
    const clicking = mcp.call(sessionId, 'click', { uid })
    try {
      await expectVisible(card().getByText('pulsar "Pagar ahora" en 127.0.0.1'), 30_000)
      const cancel = card().getByRole('button', { name: 'Cancelar' })
      await expect.poll(() => cancel.isEnabled(), { timeout: 5_000 }).toBe(true)
      await expect.poll(() => a.page.evaluate(() => document.activeElement?.textContent), { timeout: 2_000 }).toBe('Cancelar')
    } finally {
      await card().getByRole('button', { name: 'Cancelar' }).click() // libera la llamada MCP pendiente
      await clicking
    }
  })

  it('fill sobre el campo de contraseña se rechaza (el agente nunca escribe contraseñas)', async () => {
    await waitUserIdle(app().page, project.dir)
    const uid = await uidOf('Contraseña', 'textbox')
    const res = await mcp.call(sessionId, 'fill', { uid, value: 'hunter2' })
    expect(res.isError).toBe(true)
    expect(res.text.toLowerCase()).toContain('contraseña')
  })

  it('un enlace normal navega en la misma pestaña (sin nueva aprobación: mismo origen aprobado en la tarea)', async () => {
    await waitUserIdle(app().page, project.dir)
    const uid = await uidOf('Ir a otra página')
    const res = await mcp.call(sessionId, 'click', { uid })
    expect(res.isError, res.text).toBe(false)
    await expect.poll(async () => (await tabs()).at(-1)?.url).toBe(`${tienda.origin}/otra`)
    await mcp.call(sessionId, 'navigate_page', { type: 'back' })
    await expect.poll(async () => (await tabs()).at(-1)?.url).toBe(`${tienda.origin}/`)
  })

  it('la barra de URL rechaza file:///etc/hosts', async () => {
    const a = app()
    const before = (await tabs()).at(-1)?.url
    const input = await urlInput(a)
    await input.fill('file:///etc/hosts')
    await input.press('Enter')
    await a.page.waitForTimeout(1_000) // ausencia de efecto: no hay evento que esperar
    const after = await tabs()
    expect(after.at(-1)?.url).toBe(before)
    expect(after.at(-1)?.url.startsWith('file:')).toBe(false)
  })

  it('una página no aprobada no llega con fetch a otro puerto de loopback (regla webRequest)', async () => {
    const a = app()
    // Navegación humana: no aprueba el origen local, así que la regla de red bloquea sus subrecursos locales.
    const input = await urlInput(a)
    await input.fill(`http://localhost:${tienda.port}/?probe=${secundario.port}`)
    await input.press('Enter')
    await expect.poll(tabTitle, { timeout: 20_000 }).toMatch(/^sonda:(bloqueado|llego)$/)
    expect(await tabTitle()).toBe('sonda:bloqueado')
    expect(secundario.hits).toEqual([])
    // Evidencia del bloqueo: Chromium lo registra como error de consola de la pestaña (ERR_BLOCKED_BY_CLIENT); se consume
    // aquí para que el colector global no lo tome por un fallo de la app.
    const blocked = a.errors.filter((e) => e.text.includes('ERR_BLOCKED_BY_CLIENT') && e.text.includes(`127.0.0.1:${secundario.port}`))
    expect(blocked.length).toBeGreaterThan(0)
    for (const e of blocked) a.errors.splice(a.errors.indexOf(e), 1)
  })

  // Observación (no es un fallo del test): `session.ts` deja pasar los subrecursos locales cuando el ORIGEN DE LA PÁGINA está
  // aprobado con «Permitir siempre» (`isLocalOriginApproved(top)`), sin mirar el destino: una página así alcanza cualquier otro
  // puerto de loopback. Es la regla que permite que un front en :5173 hable con su API en :3000, pero también amplía el
  // alcance; si se endurece (p. ej. exigir destino aprobado), este test debe actualizarse.
  it('observación: una página cuyo origen está aprobado con «Permitir siempre» sí alcanza otro puerto de loopback', async () => {
    const a = app()
    await waitUserIdle(a.page, project.dir)
    // `localhost` es otro origen que `127.0.0.1` (que solo está aprobado «en esta tarea», que no cuenta para la regla de red).
    const nav = mcp.call(sessionId, 'navigate_page', { type: 'url', url: `http://localhost:${tienda.port}/?probe=${secundario.port}` })
    await expectVisible(card().getByText(`¿Dejar que el agente abra tu servidor local localhost:${tienda.port}?`), 30_000)
    const always = card().getByRole('button', { name: 'Permitir siempre' })
    await expect.poll(() => always.isEnabled(), { timeout: 5_000 }).toBe(true)
    // F7-B2: también en la tarjeta de origen local, una vez armada el foco está en «No» (Enter no aprueba).
    await expect.poll(() => app().page.evaluate(() => document.activeElement?.textContent), { timeout: 2_000 }).toBe('No')
    await always.click()
    expect((await nav).isError).toBe(false)
    await expect.poll(tabTitle, { timeout: 20_000 }).toMatch(/^sonda:(bloqueado|llego)$/)
    expect(await tabTitle()).toBe('sonda:llego')
    expect(secundario.hits).toContain('GET /secreto')
  })
})

// F7-B1: navegar una pestaña del navegador integrado a un esquema externo (`mailto:`, `tel:`) mataba el proceso principal
// (SIGTRAP en CrBrowserMain): el respaldo `did-start-navigation` llamaba a `stop()`/`goBack()` síncronos dentro del evento.
// Ahora se bloquea en `will-navigate`, se registra solo el esquema y se avisa al usuario; nunca se abre otra aplicación.
// Va en su propio describe/app por historia (antes tumbaba la app); ya no hay que activarlo a mano.
describe.skipIf(!DEV)('Lote D: mailto: y tel: en el navegador integrado', () => {
  let app: E2EApp
  let tienda: PageServer
  let project: ReturnType<typeof makeTasksDir>
  beforeAll(async () => {
    project = makeTasksDir()
    tienda = await servePages({ '/': TIENDA })
    app = await startApp({ env: { OPENCODE_BIN: fakeBin.bin } })
  })
  afterAll(async () => {
    await Promise.race([app?.stop().catch(() => undefined), new Promise((r) => setTimeout(r, 8_000))])
    if (app) killByPath(app.userData)
    await tienda?.close()
    project?.dispose()
  })

  let mcp: BrowserMcp
  let sessionId = ''
  let uid = ''
  const tabUrl = (): Promise<string | undefined> =>
    app.page.evaluate(async (directory) => {
      const w = window as unknown as { api: { browser: { invoke: (c: string, r: unknown) => Promise<{ tabs: { url: string }[] }> } } }
      return (await w.api.browser.invoke('browser:state', { owner: { kind: 'code', directory } })).tabs.at(-1)?.url
    }, project.dir)
  /** La acción de entrada del agente se rechaza mientras la pestaña tiene entrada humana reciente (3 s): reintenta hasta que pase. */
  const callWhenIdle = async (tool: string, args: Record<string, unknown>): Promise<Awaited<ReturnType<BrowserMcp['call']>>> => {
    let res = await mcp.call(sessionId, tool, args)
    for (let i = 0; i < 8 && res.text.includes('está usando el navegador'); i++) {
      await new Promise((r) => setTimeout(r, 1_000))
      res = await mcp.call(sessionId, tool, args)
    }
    return res
  }
  const opened = (): Promise<string[]> => app.electronApp.evaluate(() => (globalThis as unknown as { __e2eOpened?: string[] }).__e2eOpened ?? [])
  const warns = (): Promise<string[]> => app.electronApp.evaluate(() => (globalThis as unknown as { __e2eWarns?: string[] }).__e2eWarns ?? [])

  it('preparación: la página con el enlace mailto: está abierta, shell.openExternal y console.warn de main espiados', async () => {
    ;({ mcp, sessionId } = await prepareCodeBrowser(app, project.dir))
    await waitUserIdle(app.page, project.dir)
    const opening = mcp.call(sessionId, 'new_page', { url: `${tienda.origin}/` })
    const allow = app.page.getByRole('button', { name: 'Permitir en esta tarea' })
    await expect.poll(() => allow.isEnabled(), { timeout: 15_000 }).toBe(true)
    await allow.click()
    expect((await opening).isError).toBe(false)
    await app.electronApp.evaluate(({ shell }) => {
      const g = globalThis as unknown as { __e2eOpened?: string[]; __e2eWarns?: string[] }
      g.__e2eOpened = []
      g.__e2eWarns = []
      shell.openExternal = (async (url: string) => {
        g.__e2eOpened!.push(url)
      }) as typeof shell.openExternal
      const orig = console.warn
      console.warn = (...args: unknown[]) => {
        g.__e2eWarns!.push(args.map(String).join(' '))
        orig.apply(console, args)
      }
    })
    const snap = await mcp.call(sessionId, 'take_snapshot')
    uid = /"Escríbenos" \[uid=(s\d+_\d+)\]/.exec(snap.text)?.[1] ?? ''
    expect(uid, snap.text).toBeTruthy()
    await waitUserIdle(app.page, project.dir)
  })

  it('un clic en un enlace mailto: no llama a shell.openExternal, no cambia la pestaña y avisa (sin volcar la dirección)', async () => {
    await waitUserIdle(app.page, project.dir)
    const before = await tabUrl()
    const res = await callWhenIdle('click', { uid })
    expect(res.text).toContain('no abre enlaces mailto:')
    await new Promise((r) => setTimeout(r, 1_500)) // ausencia de efecto: no hay evento que esperar
    // La app sigue viva (evaluate falla si main murió) y no se abrió nada fuera.
    expect(await opened()).toEqual([])
    expect(await tabUrl()).toBe(before)
    const log = (await warns()).filter((w) => w.includes('navegación bloqueada: mailto:'))
    expect(log.length).toBeGreaterThan(0)
    expect(log.join('\n')).not.toContain('ventas@example.com')
    // El aviso llega al panel (línea role=status con «Cerrar»).
    const notice = app.page.getByRole('status').filter({ hasText: 'no abre enlaces mailto:' })
    await expectVisible(notice)
    await notice.getByRole('button', { name: 'Cerrar' }).click()
    await expect.poll(() => notice.count()).toBe(0)
  })

  it('tel: por location.href tampoco abre nada ni tumba la app', async () => {
    await waitUserIdle(app.page, project.dir)
    const before = await tabUrl()
    const res = await callWhenIdle('evaluate_script', { function: "() => { location.href = 'tel:+56912345678' }" })
    expect(res.isError, res.text).toBe(false)
    await new Promise((r) => setTimeout(r, 1_500))
    expect(await opened()).toEqual([])
    expect(await tabUrl()).toBe(before)
    const log = (await warns()).filter((w) => w.includes('navegación bloqueada: tel:'))
    expect(log.length).toBeGreaterThan(0)
    expect(log.join('\n')).not.toContain('56912345678')
  })
})
