// Tareas en modo unificado (el camino de la gente: en macOS viene encendido por defecto desde la 1.8.0), contra la app real
// de Electron y el OpenCode falso, con userData temporal y HOME falso:
//  - «Chat sin carpeta»: la portada no pide carpeta y, al enviar, la app crea una carpeta nueva en ~/Lazunox/Chats;
//  - la tarea sale en la lista lateral y en Ctrl+K (W4 del plan 1.8.9, arreglado en P4).
// Las otras specs de Tareas (lotes, restore, control-total, fase6) fijan LAZUNOX_UNIFIED_APPS=0 y prueban el modo antiguo.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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

// Carpeta de capturas: LZX_SHOTS_DIR, o una carpeta temporal del sistema.
const SHOTS = process.env.LZX_SHOTS_DIR || join(tmpdir(), 'lzx-p4-capturas')
async function shot(page: { screenshot: (o: { path: string }) => Promise<unknown> }, name: string): Promise<void> {
  try {
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, `${name}.png`) })
  } catch {
    // las capturas son una comodidad
  }
}

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

  // W4 (plan 1.8.9, P4): la barra por carpetas alimenta el índice de chats también para una carpeta de chat (antes solo lo hacía TaskList).
  it('la tarea sale en la lista lateral (grupo «Este equipo»)', async () => {
    const { page } = app()
    await expectVisible(page.getByTestId('folder-group-header').filter({ hasText: 'Este equipo' }), 10_000)
    await expectVisible(page.getByRole('treeitem').filter({ hasText: PROMPT }), 5_000)
    await shot(page, 'P4-mac-lista-este-equipo')
  })

  // W4: Ctrl+K encuentra las tareas de Overdrive por su nombre (índice de la barra lateral).
  it('la tarea sale en Ctrl+K', async () => {
    const { page } = app()
    await page.keyboard.press('ControlOrMeta+k')
    const dlg = page.getByRole('dialog')
    await expectVisible(dlg)
    await dlg.getByRole('combobox').or(dlg.getByRole('textbox')).first().fill('apuntes')
    await expectVisible(dlg.getByText(PROMPT, { exact: false }), 5_000)
    await shot(page, 'P4-mac-ctrlk')
    await page.keyboard.press('Escape')
  })

  // W2 (P4): una carpeta imposible (contiene los Chats) ya no deja la tarea trabada: «Seguir en la carpeta de la tarea» solo NIEGA y orienta.
  it('carpeta imposible: la tarjeta ofrece «Seguir en la carpeta de la tarea», que rechaza la petición con una guía', async () => {
    const { page } = app()
    const cw = await tasksFake(page)
    const impossible = join(fakeHome, 'Lazunox')
    await cw.script({
      steps: [
        { type: 'text', text: 'Voy a guardar fuera.' },
        {
          type: 'permission',
          permission: 'external_directory',
          patterns: [`${impossible}/*`],
          metadata: { parentDir: impossible, reason: 'Guardar el informe' }
        }
      ]
    })
    // Mismo servidor de la carpeta de chat: el guion se aplica al siguiente mensaje de la tarea abierta.
    const box = page.getByPlaceholder('Responde o pide un cambio…')
    await box.fill('Guarda el informe fuera de la tarea')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(page.getByText('El agente quiere trabajar en otra carpeta'), 30_000)
    const stay = page.getByRole('button', { name: 'Seguir en la carpeta de la tarea' })
    await expectVisible(stay, 10_000)
    expect(await page.getByRole('button', { name: 'Permitir', exact: true }).count()).toBe(0)
    await shot(page, 'P4-mac-carpeta-imposible')
    const cw2 = await tasksFake(page)
    await stay.click()
    const reply = await cw2.waitForRequest((r) => r.method === 'POST' && /permission\/.+\/reply/.test(r.path), 15_000)
    const body = reply.body as { reply?: string; message?: string }
    expect(body.reply).toBe('reject')
    expect(body.message).toContain('dentro de la carpeta de la tarea')
  })
})
