// Puntos de restauración de Tareas contra la app real y el OpenCode falso: el guion modifica a.txt, crea b.txt y borra
// c.txt; el panel lo muestra, «Deshacer» lo revierte (b.txt a la Papelera de pruebas), «Rehacer» lo recupera, y la tarjeta
// de permisos de edición enseña el diff y deja «Rechazar con indicaciones». Capturas con RESTORE_SHOTS_DIR.
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stubDialog } from '../lib/dialogs'
import { useApp } from '../lib/harness'
import { shot as takeShot } from '../lib/shots'
import { fakeOutsideUserData, makeTasksDir, tasksFake } from '../lib/lotes'
import { MODE, type E2EApp } from '../lib/launch'
import { MODE_LABELS } from '../../src/shared/labels'
import { TASKS_TERMS } from '../../src/shared/tasks-glossary'
import { storeSet, storeState } from '../lib/stores'
import { expectCount, expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.RESTORE_SHOTS_DIR
const fakeBin = fakeOutsideUserData()
const work = makeTasksDir()
const trashDir = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-trash-')))
afterAll(() => {
  fakeBin.dispose()
  work.dispose()
  rmSync(trashDir, { recursive: true, force: true })
})

const A_ORIG = 'uno\ndos\ntres\n'
const A_NEW = 'uno\nDOS\ntres\ncuatro\n'
const C_ORIG = 'contenido de c\n'
const CLOUD_KEEP = 'nube.bin' // el agente no lo toca
const CLOUD_EDIT = 'nube-editado.bin' // el agente lo sobrescribe: el panel debe decir por qué no se puede deshacer
const CLOUD_EDIT_NEW = 'editado por el agente\n'

const read = (rel: string): string => readFileSync(join(work.dir, rel), 'utf8')
const trashed = (): string[] => readdirSync(trashDir)

const shot = (app: E2EApp, name: string, widths?: number[]): Promise<void> => takeShot(app, SHOTS, name, widths)

async function waitIdle(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Object.values((window as any).__onyxE2E.useSessions.getState().status).every((s) => s === 'idle')), {
      timeout: 30_000
    })
    .toBe(true)
}

describe.skipIf(!DEV)('Puntos de restauración (Tareas)', () => {
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin, ONYXCODE_E2E_TRASH_DIR: trashDir } })
  let sessionId = ''

  beforeAll(() => {
    writeFileSync(join(work.dir, 'a.txt'), A_ORIG)
    writeFileSync(join(work.dir, 'c.txt'), C_ORIG)
    // Archivos dispersos (tamaño sin bloques en disco): imitan el «solo en la nube» de iCloud. No se leen ni se copian.
    for (const n of [CLOUD_KEEP, CLOUD_EDIT]) {
      writeFileSync(join(work.dir, n), '')
      truncateSync(join(work.dir, n), 2 * 1024 * 1024)
      expect(statSync(join(work.dir, n)).blocks).toBe(0)
    }
  })

  it('(1-2) enviar un mensaje guarda el punto y el guion modifica a, crea b y borra c', async () => {
    const a = app()
    const { page } = a
    await page.locator('nav[aria-label="Modo"]').getByRole('button', { name: MODE_LABELS.tasks }).click()
    const onboarding = page.getByRole('button', { name: 'Entendido, no mostrar más' })
    if (await onboarding.isVisible().catch(() => false)) await onboarding.click()
    await stubDialog(a.electronApp, { openPaths: [work.dir] })
    await page.getByRole('button', { name: 'Elegir carpeta' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Permitir', exact: true }).click()
    await expect.poll(() => storeState(page, 'useTasks', 'phase'), { timeout: 60_000 }).toBe('ready')
    // El sandbox solo deja borrar con «Permitir borrar»: se activa desde el panel del proyecto (reinicia el servidor).
    await page.getByRole('button', { name: 'Proyecto e instrucciones' }).click()
    const grant = page.getByRole('switch', { name: TASKS_TERMS.deleteGrant })
    await expectVisible(grant)
    await grant.click()
    await expect.poll(() => grant.getAttribute('aria-checked'), { timeout: 60_000 }).toBe('true')
    await expect.poll(() => storeState(page, 'useTasks', 'phase'), { timeout: 60_000 }).toBe('ready')
    await storeSet(page, 'useTasks', { projectPanelOpen: false })
    // Reiniciar el servidor corta el SSE: el navegador lo registra como error de red (esperado).
    a.errors.length = 0
    const cw = await tasksFake(page)
    await cw.script({
      steps: [
        { type: 'text', text: 'Voy a editar los archivos.' },
        { type: 'fs', op: 'write', path: 'a.txt', content: A_NEW },
        { type: 'fs', op: 'write', path: 'b.txt', content: 'archivo nuevo\n' },
        { type: 'fs', op: 'delete', path: 'c.txt' },
        { type: 'fs', op: 'write', path: CLOUD_EDIT, content: CLOUD_EDIT_NEW },
        { type: 'text', text: 'Listo: edité a.txt, creé b.txt y borré c.txt.' }
      ]
    })
    await page.getByPlaceholder('Describe la tarea que quieres delegar…').fill('Reorganiza los archivos')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(page.getByText('Listo: edité a.txt, creé b.txt y borré c.txt.'), 30_000)
    await waitIdle(page)
    expect(read('a.txt')).toBe(A_NEW)
    expect(read('b.txt')).toBe('archivo nuevo\n')
    expect(existsSync(join(work.dir, 'c.txt'))).toBe(false)
    sessionId = await page.evaluate(() => (window as any).__onyxE2E.useTasks.getState().activeTaskId)
    expect(sessionId).toMatch(/^ses_/)
    // Nada del almacén dentro de la carpeta del usuario.
    expect(readdirSync(work.dir).sort()).toEqual(['a.txt', 'b.txt', CLOUD_EDIT, CLOUD_KEEP])
  })

  it('(3) el panel muestra 4 cambios (uno no restaurable, con su motivo) y se abre el diff', async () => {
    const { page } = app()
    await expectVisible(page.getByText('Cambios en archivos'), 20_000)
    const panel = page.locator('section', { has: page.getByText('Cambios en archivos', { exact: true }) })
    await expectVisible(panel.getByRole('button', { name: /a\.txt/ }))
    await expectCount(panel.locator('li'), 4)
    await expectVisible(panel.getByText('Modificado'))
    await expectVisible(panel.getByText('Nuevo'))
    await expectVisible(panel.getByText('Eliminado'))
    // El archivo «solo en la nube» que el agente sobrescribió: se explica por qué no se puede deshacer.
    await panel.getByRole('button', { name: new RegExp(CLOUD_EDIT.replace('.', '\\.')) }).click()
    await expectVisible(panel.getByText('No restaurable (solo en la nube)', { exact: false }))
    await panel.getByText('No restaurable (solo en la nube)', { exact: false }).scrollIntoViewIfNeeded()
    // El que el agente no tocó no aparece entre los cambios.
    expect(await panel.getByText(CLOUD_KEEP, { exact: true }).count()).toBe(0)
    await shot(app(), 'panel-cambios', [820, 1280])
    await panel.getByRole('button', { name: new RegExp(CLOUD_EDIT.replace('.', '\\.')) }).click()
    await panel.getByRole('button', { name: /a\.txt/ }).click()
    await expectVisible(panel.locator('table'))
    await expectVisible(panel.getByText('cuatro'))
    await shot(app(), 'diff-abierto', [1280])
  })

  it('(4) Deshacer: a vuelve al original, c reaparece y b queda en la Papelera de pruebas', async () => {
    const a = app()
    const { page } = a
    await page.getByRole('button', { name: 'Deshacer los cambios de esta tarea' }).click()
    const dialog = page.getByRole('alertdialog')
    await expectVisible(dialog.getByText('¿Deshacer los cambios de esta tarea?'))
    await expectVisible(dialog.getByText('Los archivos nuevos irán a la Papelera.', { exact: false }))
    await shot(a, 'confirmacion')
    await dialog.getByRole('button', { name: 'Deshacer cambios' }).click()
    await expectVisible(page.getByText('Cambios deshechos: 2 restaurados, 1 enviados a la Papelera.'), 20_000)
    expect(read('a.txt')).toBe(A_ORIG)
    expect(read('c.txt')).toBe(C_ORIG)
    expect(existsSync(join(work.dir, 'b.txt'))).toBe(false)
    expect(trashed().some((n) => n.endsWith('-b.txt'))).toBe(true)
    // Archivos «solo en la nube»: siguen en su sitio, no van a la Papelera y no se leyeron.
    expect(statSync(join(work.dir, CLOUD_KEEP)).size).toBe(2 * 1024 * 1024)
    expect(statSync(join(work.dir, CLOUD_KEEP)).blocks).toBe(0)
    expect(read(CLOUD_EDIT)).toBe(CLOUD_EDIT_NEW)
    expect(trashed().filter((n) => n.includes('nube'))).toEqual([])
    await shot(a, 'deshecho')
  })

  it('(5) Rehacer vuelve a dejar el resultado del agente', async () => {
    const { page } = app()
    await page.getByRole('button', { name: 'Rehacer' }).click()
    await expectVisible(page.getByText(/^Cambios rehechos: /), 20_000)
    expect(read('a.txt')).toBe(A_NEW)
    expect(read('b.txt')).toBe('archivo nuevo\n')
    expect(existsSync(join(work.dir, 'c.txt'))).toBe(false)
  })

  it('(6) permiso de edición: muestra el diff y «Rechazar con indicaciones» llega al servidor', async () => {
    const a = app()
    const { page } = a
    const cw = await tasksFake(page)
    const diff = `Index: ${work.dir}/a.txt\n===================================================================\n--- ${work.dir}/a.txt\n+++ ${work.dir}/a.txt\n@@ -1,4 +1,4 @@\n uno\n-DOS\n+dos\n tres\n cuatro\n`
    await cw.script({
      steps: [
        { type: 'text', text: 'Voy a editar a.txt.' },
        { type: 'permission', permission: 'edit', patterns: ['a.txt'], metadata: { filepath: join(work.dir, 'a.txt'), diff } }
      ]
    })
    const box = page.getByPlaceholder('Responde o pide un cambio…')
    await box.fill('Pon «dos» en minúsculas')
    await page.getByRole('button', { name: 'Enviar' }).click()
    const card = page.locator('[id^="perm-"]')
    await expectVisible(card.getByText('El agente quiere modificar «a.txt»'), 30_000)
    await expectVisible(card.locator('table'))
    expect(await card.locator('table').innerText()).toContain('dos')
    await shot(a, 'permiso')
    await card.getByRole('button', { name: 'Rechazar con indicaciones' }).click()
    await card.getByLabel('Indicaciones para el agente').fill('Mejor deja el archivo como está y crea notas.txt')
    await shot(a, 'permiso-indicaciones')
    await card.getByRole('button', { name: 'Rechazar y enviar indicaciones' }).click()
    const req = await cw.waitForRequest((r) => r.method === 'POST' && r.path.startsWith('/permission/') && r.path.endsWith('/reply'))
    expect(req.body).toEqual({ reply: 'reject', message: 'Mejor deja el archivo como está y crea notas.txt' })
    await expectCount(page.locator('[id^="perm-"]'), 0)
  })
})
