// Tareas en modo unificado (el camino de la gente: en macOS viene encendido por defecto desde la 1.8.0), contra la app real
// de Electron y el OpenCode falso, con userData temporal y HOME falso:
//  - «Chat sin carpeta»: la portada no pide carpeta y, al enviar, la app crea una carpeta nueva en ~/Lazunox/Chats;
//  - la tarea debería salir en la lista lateral y en Ctrl+K (W4 del plan 1.8.9: hoy NO sale; van como `it.fails` hasta que P4 lo arregle).
// Las otras specs de Tareas (lotes, restore, control-total, fase6) fijan LAZUNOX_UNIFIED_APPS=0 y prueban el modo antiguo.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { fakeOutsideUserData, tasksFake } from '../lib/lotes'
import { MODE } from '../lib/launch'
import { IS_WIN } from '../lib/proc'
import { storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'
import { MODE_LABELS } from '../../src/shared/labels'

const DEV = MODE === 'dev'
const fakeBin = fakeOutsideUserData()
// HOME falso: la carpeta de chats sale de os.homedir() (main/tasks/manager.ts), así que nada toca ~/Lazunox real.
// Va DENTRO del home real y no en tmpdir(): la política de carpetas prohíbe todo bajo /private (y tmpdir es /private/var/folders).
const fakeHome = realpathSync(mkdtempSync(join(homedir(), '.lazunox-e2e-unif-')))
mkdirSync(join(fakeHome, 'Documents'))
const chatsDir = join(fakeHome, 'Lazunox', 'Chats')
afterAll(() => {
  fakeBin.dispose()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
})

const PROMPT = 'Ordena mis apuntes de la semana'

// Windows v1: modo Tareas fuera de alcance. Solo macOS tiene el modo unificado encendido por defecto sin variables.
describe.skipIf(!DEV || IS_WIN)('Tareas: modo unificado (Chat sin carpeta)', () => {
  // Sin LAZUNOX_UNIFIED_APPS: justo lo que ve la gente (encendido por defecto en macOS).
  const app = useApp({ env: { OPENCODE_BIN: fakeBin.bin, HOME: fakeHome } })

  it('la portada de Tareas no pide carpeta y el selector de acceso antiguo no está', async () => {
    const { page } = app()
    await page.locator('nav[aria-label="Modo"]').getByRole('button', { name: MODE_LABELS.tasks }).click()
    // Si el onboarding está, se descarta (no estorba a lo que sigue).
    const skip = page.getByRole('button', { name: 'Entendido, no mostrar más' })
    if (await skip.isVisible().catch(() => false)) await skip.click()
    await expectVisible(page.getByPlaceholder('Describe la tarea que quieres delegar…'))
    expect(await storeState(page, 'useTasks', 'folder')).toBeNull()
    expect(await page.getByRole('button', { name: 'Elegir carpeta' }).count()).toBe(0)
    expect(await page.getByRole('radiogroup', { name: 'Modo de acceso' }).count()).toBe(0)
    expect(existsSync(chatsDir)).toBe(false)
  })

  it('enviar sin carpeta crea una carpeta en ~/Lazunox/Chats y la tarea llega al servidor', async () => {
    const a = app()
    const { page } = a
    const box = page.getByPlaceholder('Describe la tarea que quieres delegar…')
    await box.fill(PROMPT)
    await page.getByRole('button', { name: 'Enviar' }).click()

    await expect.poll(() => storeState<string | null>(page, 'useTasks', 'folder'), { timeout: 60_000 }).toContain(chatsDir + '/')
    const folder = (await storeState<string>(page, 'useTasks', 'folder'))!
    expect(existsSync(folder)).toBe(true)
    expect(readdirSync(chatsDir)).toHaveLength(1)
    expect(realpathSync(folder)).toBe(folder)

    // La conexión es la de la carpeta de chat y la tarea llegó al servidor falso.
    const fake = await tasksFake(page)
    expect((await storeState<{ folder: string }>(page, 'useTasks', 'conn')).folder).toBe(folder)
    await fake.waitForRequest((r) => r.method === 'POST' && /prompt/.test(r.path), 30_000)
  })

  // W4 (plan 1.8.9, P4), reproducido en Mac: la tarea de «Chat sin carpeta» NO sale en la lista lateral. Causa probable: la barra por carpetas
  // (FolderGroups) solo pinta grupos de carpetas propias y de entradas del índice de chats; el índice solo lo alimenta `syncChatSession`
  // desde TaskList, que no se monta para una carpeta de chat, y `tasks:chatIndex:list` queda vacío.
  // Cuando P4 lo arregle, estas pruebas pasarán y `it.fails` las marcará como fallo: quitar `.fails`.
  it.fails('la tarea sale en la lista lateral (grupo «Este equipo»)', async () => {
    const { page } = app()
    await expectVisible(page.getByTestId('folder-group-header').filter({ hasText: 'Este equipo' }), 10_000)
    await expectVisible(page.getByRole('treeitem').filter({ hasText: PROMPT }), 5_000)
  })

  // W4 (plan 1.8.9, P4): las tareas «Chat sin carpeta» aún no entran en la búsqueda (search-service.ts solo indexa chat y code).
  // Cuando P4 lo arregle, esta prueba pasará y `it.fails` la marcará como fallo: quitar `.fails`.
  it.fails('la tarea sale en Ctrl+K', async () => {
    const { page } = app()
    await page.keyboard.press('ControlOrMeta+k')
    const dlg = page.getByRole('dialog')
    await expectVisible(dlg)
    await dlg.getByRole('combobox').or(dlg.getByRole('textbox')).first().fill('apuntes')
    await expectVisible(dlg.getByText(PROMPT, { exact: false }), 5_000)
  })
})
