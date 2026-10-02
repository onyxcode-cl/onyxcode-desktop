// Control total sin carpeta (F8-B44) contra la app real de Electron y el OpenCode falso (userData tmp y HOME falso):
//  - «Control total del Mac» NO pide carpeta: diálogo de consentimiento UNA vez por equipo y cwd = carpeta personal;
//  - el consentimiento se guarda con fecha (`fullAccessConsentAt`) y se retira en Ajustes › Tareas;
//  - mientras una tarea corre se ve el aviso de que no está confinado;
//  - Sandbox sigue pidiendo carpeta (y no acepta la carpeta personal).
// Capturas (claro/oscuro) con CTL_SHOTS_DIR.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { dialogCalls, stubDialog } from '../lib/dialogs'
import { FakeClient } from '../lib/fake'
import { useApp } from '../lib/harness'
import { fakeOutsideUserData, makeTasksDir } from '../lib/lotes'
import { MODE, type E2EApp } from '../lib/launch'
import { shot as takeShot } from '../lib/shots'
import { storeState } from '../lib/stores'
import { MODE_LABELS, UI_LABELS } from '../../src/shared/labels'
import { TASKS_TERMS } from '../../src/shared/tasks-glossary'
import { expectCount, expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.CTL_SHOTS_DIR
const fakeBin = fakeOutsideUserData()
const work = makeTasksDir()
// HOME falso: la app lo toma como «carpeta personal» (os.homedir) sin tocar la del usuario real.
const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-home-')))
mkdirSync(join(fakeHome, 'Documents'))
afterAll(() => {
  fakeBin.dispose()
  work.dispose()
  rmSync(fakeHome, { recursive: true, force: true })
})

const shot = (app: E2EApp, name: string, widths?: number[]): Promise<void> => takeShot(app, SHOTS, name, widths)

/** `window.api.tasks.invoke` desenvuelto como hace el renderer: devuelve el dato o lanza con el error. */
const invoke = <T>(page: Page, channel: string, req?: unknown): Promise<T> =>
  page.evaluate(
    async ([c, r]) => {
      const res = await (window as any).api.tasks.invoke(c, r)
      if (!res.ok) throw new Error(res.error)
      return res.data
    },
    [channel, req] as const
  ) as Promise<T>

interface Conn {
  folder: string
  baseUrl: string
  authorization: string
  fullAccess: boolean
  sandboxed: boolean
}
const conn = (page: Page): Promise<Conn | null> => storeState<Conn | null>(page, 'useTasks', 'conn')
const phase = (page: Page): Promise<string> => storeState<string>(page, 'useTasks', 'phase')
const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true })

async function openSettings(app: E2EApp, section: string): Promise<void> {
  await app.page.keyboard.press('Meta+,')
  const nav = app.page.locator('nav[aria-label="Secciones de ajustes"]')
  await expectVisible(nav)
  await nav.getByRole('button', { name: section, exact: true }).click()
}

describe.skipIf(!DEV)('Control total sin carpeta', () => {
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin, HOME: fakeHome } })

  it('Control total no pide carpeta: un solo diálogo de consentimiento y el cwd es la carpeta personal', async () => {
    const a = app()
    const { page, electronApp } = a
    await stubDialog(electronApp, { openPaths: [] })
    await page.locator('nav[aria-label="Modo"]').getByRole('button', { name: MODE_LABELS.tasks }).click()
    // Sin carpeta elegida y sin consentimiento.
    expect(await storeState(page, 'useTasks', 'folder')).toBeNull()
    expect((await invoke<{ consentAt: number | null }>(page, 'tasks:fullAccess:state')).consentAt).toBeNull()
    await expectVisible(page.getByRole('button', { name: 'Elegir carpeta' }).first().or(page.getByText('¿En qué trabajamos hoy?')))

    // El interruptor está habilitado aunque no haya carpeta.
    const full = radio(page, TASKS_TERMS.fullControl)
    await expectVisible(full)
    expect(await full.isDisabled()).toBe(false)
    await full.click()

    // Diálogo de consentimiento (sin selector de carpeta).
    const dlg = page.getByRole('alertdialog').first()
    await expectVisible(dlg)
    await expectVisible(dlg.getByText('nada queda confinado a una carpeta', { exact: false }))
    await expectVisible(dlg.getByTestId('full-consent-once'))
    await expectVisible(dlg.getByText('No tienes que elegir una carpeta', { exact: false }))
    await shot(a, 'consentimiento')
    await dlg.getByRole('button', { name: 'Permitir control' }).click()

    await expect.poll(() => phase(page), { timeout: 60_000, message: 'Control total listo' }).toBe('ready')
    const c = (await conn(page))!
    expect(c.fullAccess).toBe(true)
    expect(c.sandboxed).toBe(false)
    expect(c.folder).toBe(fakeHome)
    // Nunca se abrió el selector de carpetas.
    expect((await dialogCalls(electronApp)).filter((d) => d.kind === 'open')).toHaveLength(0)

    // Consentimiento registrado con fecha, sin autorizar ninguna carpeta para Sandbox.
    const st = await invoke<{ consentAt: number; workspace: string; home: string }>(page, 'tasks:fullAccess:state')
    expect(st.consentAt).toBeGreaterThan(0)
    expect(st.workspace).toBe(fakeHome)
    expect(st.home).toBe(fakeHome)
    expect(await invoke<unknown[]>(page, 'tasks:listFolders')).toEqual([])
    const saved = JSON.parse(readFileSync(join(a.userData, 'tasks-folders.json'), 'utf8')) as {
      fullAccessConsentAt?: number
      folders: unknown[]
    }
    expect(saved.fullAccessConsentAt).toBe(st.consentAt)
    expect(saved.folders).toEqual([])

    // La interfaz deja claro que no está confinado y dónde trabaja.
    const note = page.getByTestId('full-workspace-note')
    await expectVisible(note)
    expect(await note.innerText()).toContain('~')
    expect(await note.innerText()).toContain('Sin sandbox')
    await shot(a, 'inicio-control-total')
  })

  it('una tarea en Control total corre en la carpeta personal y muestra el indicador de «no confinado»', async () => {
    const a = app()
    const { page } = a
    const c = (await conn(page))!
    const fake = new FakeClient(c)
    await fake.script({
      match: 'TAREA CTL',
      title: 'Tarea sin carpeta',
      steps: [
        { type: 'text', text: 'Trabajando en tu equipo.' },
        { type: 'delay', ms: 6_000 },
        { type: 'text', text: ' Listo.' }
      ]
    })
    await page.getByPlaceholder('Describe qué debe hacer en tu Mac…').fill('TAREA CTL haz algo')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(page.getByText('Trabajando en tu equipo.', { exact: false }).first(), 30_000)
    // Mientras corre: banner «Controlando tu Mac · … no está confinado».
    const banner = page.getByTestId('control-banner-busy')
    await expectVisible(banner, 15_000)
    expect(await banner.innerText()).toContain('no está confinado')
    await shot(a, 'tarea-corriendo')
    // El servidor recibió el directorio personal (cwd), no una carpeta autorizada.
    const reqs = await fake.requests({ limit: 200 })
    expect(reqs.some((r) => r.directory === fakeHome)).toBe(true)
    const id = (await storeState<string | null>(page, 'useTasks', 'activeTaskId'))!
    await expect
      .poll(() => page.evaluate((sid) => ((window as any).__onyxE2E.useSessions.getState().status[sid] ?? 'idle') === 'idle', id), {
        timeout: 60_000
      })
      .toBe(true)
  })

  it('Sandbox sigue pidiendo carpeta; volver a Control total no repite el diálogo (consentimiento único)', async () => {
    const a = app()
    const { page, electronApp } = a
    // Tras la tarea, de vuelta al inicio (el selector de modo vive en la pantalla de inicio).
    await page
      .getByRole('button', { name: /^Nueva tarea/ })
      .first()
      .click()
    // A Sandbox: sin carpeta autorizada no hay a dónde volver → pide elegir una.
    await radio(page, TASKS_TERMS.sandbox).click()
    await expect.poll(() => storeState(page, 'useTasks', 'folder'), { timeout: 30_000 }).toBeNull()
    expect(await conn(page)).toBeNull()
    await expectVisible(page.getByRole('button', { name: 'Elegir carpeta' }).first())
    // La carpeta personal NO vale para Sandbox (main la rechaza como siempre).
    await expect(invoke(page, 'tasks:start', { folder: fakeHome })).rejects.toThrow()
    await expect(invoke(page, 'tasks:approveFolder', { folder: fakeHome })).rejects.toThrow()

    // Sin diálogo: ya hay consentimiento en este equipo.
    await radio(page, TASKS_TERMS.fullControl).click()
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('ready')
    expect(await page.getByRole('alertdialog').count()).toBe(0)
    expect((await conn(page))!.folder).toBe(fakeHome)

    // Sandbox con carpeta de verdad: elegir carpeta → «Permitir» → servidor sandbox.
    await radio(page, TASKS_TERMS.sandbox).click()
    await expect.poll(() => storeState(page, 'useTasks', 'folder'), { timeout: 30_000 }).toBeNull()
    await stubDialog(electronApp, { openPaths: [work.dir] })
    await page.getByRole('button', { name: 'Elegir carpeta' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Permitir', exact: true }).click()
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('ready')
    const c = (await conn(page))!
    expect(c.fullAccess).toBe(false)
    expect(c.folder).toBe(work.dir)
    expect(c.sandboxed).toBe(true)
    expect(await page.getByTestId('full-workspace-note').count()).toBe(0)

    // Desde una carpeta autorizada, Control total trabaja en ESA carpeta (sin diálogo, sin pedir otra).
    await radio(page, TASKS_TERMS.fullControl).click()
    await expect.poll(async () => (await conn(page))?.fullAccess, { timeout: 60_000 }).toBe(true)
    expect((await conn(page))!.folder).toBe(work.dir)
    expect(await page.getByRole('alertdialog').count()).toBe(0)
  })

  it('el consentimiento se retira en Ajustes › Tareas y vuelve a pedirse', async () => {
    const a = app()
    const { page } = a
    await openSettings(a, UI_LABELS.tasksMode)
    const status = page.getByTestId('full-consent-status')
    await expectVisible(status)
    expect(await status.innerText()).toContain('Consentimiento dado el')
    await shot(a, 'ajustes-consentimiento', [1280])
    await page.getByRole('button', { name: 'Retirar consentimiento' }).click()
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).last()
    await expectVisible(confirm)
    await confirm.getByRole('button', { name: 'Retirar consentimiento' }).click()
    await expect.poll(() => status.innerText(), { timeout: 15_000 }).toContain('Sin consentimiento')
    expect((await invoke<{ consentAt: number | null }>(page, 'tasks:fullAccess:state')).consentAt).toBeNull()
    const saved = JSON.parse(readFileSync(join(a.userData, 'tasks-folders.json'), 'utf8')) as { fullAccessConsentAt?: number }
    expect(saved.fullAccessConsentAt).toBeUndefined()
    // Sin consentimiento main no arranca Control total, ni siquiera por IPC directo.
    await expect(invoke(page, 'tasks:start', { folder: fakeHome, fullAccess: true })).rejects.toThrow(/FULL_ACCESS_NOT_GRANTED/)
    await page.keyboard.press('Escape')

    // La tarea que estaba en Control total en esa carpeta volvió a Sandbox; pedir Control total otra vez muestra el diálogo.
    await expect.poll(async () => (await conn(page))?.fullAccess, { timeout: 30_000 }).toBe(false)
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('ready')
    await radio(page, TASKS_TERMS.fullControl).click()
    const dlg = page.getByRole('alertdialog').first()
    await expectVisible(dlg)
    await dlg.getByRole('button', { name: 'Cancelar' }).click()
    await expectCount(dlg, 0)
    expect((await invoke<{ consentAt: number | null }>(page, 'tasks:fullAccess:state')).consentAt).toBeNull()
    expect(existsSync(join(a.userData, 'tasks-folders.json'))).toBe(true)
  })
})
