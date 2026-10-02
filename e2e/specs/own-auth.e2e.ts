// Conexión propia de la app: el motor usa `userData/opencode-data` (XDG_DATA_HOME propio), aislado del auth.json del CLI
// (simulado en el `xdg('data')` de launch.ts). Cubre: el CLI no cuenta como conectado, el almacén propio sí, la reapertura
// única del asistente en instalaciones existentes y que Tareas con sandbox solo parte del auth propio.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { MODE_LABELS } from '../../src/shared/labels'
import type { FakeClient } from '../lib/fake'
import { stubDialog } from '../lib/dialogs'
import { MODE, startApp, type E2EApp } from '../lib/launch'
import { fakeOutsideUserData, makeTasksDir, tasksFake } from '../lib/lotes'
import { storeState } from '../lib/stores'
import { expectCount, expectVisible } from '../lib/wait'
import { IS_WIN } from '../lib/proc'

const GO_AUTH = JSON.stringify({ 'opencode-go': { type: 'api', key: 'sk-e2e-falsa' } })
const apps: E2EApp[] = []
const dirs: string[] = []
const fakeBin = fakeOutsideUserData()
const work = makeTasksDir()

const settingsOf = (userData: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown>

function newUserData(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-ownauth-')))
  dirs.push(d)
  return d
}

/** Escribe `opencode/auth.json` dentro de `base` (un XDG_DATA_HOME). */
function seedAuth(base: string, content = GO_AUTH): void {
  mkdirSync(join(base, 'opencode'), { recursive: true })
  writeFileSync(join(base, 'opencode', 'auth.json'), content)
}

/** `connected.json` del falso (proveedores conectados «de fábrica»), vacío: solo cuenta el auth.json. */
function noDefaultProviders(userData: string): void {
  mkdirSync(join(userData, 'fake-opencode'), { recursive: true })
  writeFileSync(join(userData, 'fake-opencode', 'connected.json'), '[]')
}

const cliData = (userData: string): string => join(userData, 'xdg', 'data')
const ownData = (userData: string): string => join(userData, 'opencode-data')

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
})

afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  fakeBin.dispose()
  work.dispose()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('conexión propia de la app', () => {
  it('(a) el auth.json del CLI no cuenta: aparece «Conecta tu IA» y el motor usa userData/opencode-data', async () => {
    const userData = newUserData()
    seedAuth(cliData(userData))
    noDefaultProviders(userData)
    const app = await startApp({ userData, keepUserData: true, settings: { onboarded: false } })
    apps.push(app)
    await expectVisible(app.page.getByRole('dialog').getByRole('heading', { name: 'Conecta tu IA' }))
    expect((await app.fake.env()).xdgDataHome).toBe(ownData(userData))
    expect(((await app.fake.status()).authProviders as string[]) ?? []).toEqual([])
  })

  it('(b) con el auth.json propio sembrado no hay asistente y onboarded pasa a true', async () => {
    const userData = newUserData()
    seedAuth(ownData(userData))
    noDefaultProviders(userData)
    const app = await startApp({ userData, keepUserData: true, settings: { onboarded: false } })
    apps.push(app)
    await expect.poll(() => settingsOf(userData).onboarded, { timeout: 20_000 }).toBe(true)
    expect(((await app.fake.status()).authProviders as string[]).sort()).toEqual(['opencode-go'])
    await expectCount(app.page.getByRole('dialog'), 0)
  })

  it('(c) instalación existente: el asistente se reabre una vez y no vuelve tras reiniciar', async () => {
    const userData = newUserData()
    // Había chat-workspace y el asistente ya hecho; el almacén propio aún no existe.
    mkdirSync(join(userData, 'chat-workspace'), { recursive: true })
    noDefaultProviders(userData)
    let app = await startApp({ userData, keepUserData: true, settings: { onboarded: true } })
    apps.push(app)
    const d = (): ReturnType<E2EApp['page']['getByRole']> => app.page.getByRole('dialog')
    await expectVisible(d().getByRole('heading', { name: 'Conecta tu IA' }))
    expect(settingsOf(userData).onboarded).toBe(false)

    // Conecta una IA (clave de OpenCode Go) y termina el asistente.
    const go = d().getByRole('region', { name: 'OpenCode Go' })
    await go.getByLabel('API key').fill('sk-e2e-reabrir')
    await go.getByRole('button', { name: 'Guardar' }).click()
    await expectVisible(d().getByText('OpenCode Go conectado'))
    expect(JSON.parse(readFileSync(join(ownData(userData), 'opencode', 'auth.json'), 'utf8'))).toHaveProperty('opencode-go')
    await d().getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(d().getByRole('heading', { name: 'Elige tu modelo' }))
    await d().getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(d().getByRole('heading', { name: 'Los cuatro modos' }))
    await d().getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(d().getByRole('heading', { name: 'Permisos de macOS' }))
    await d().getByRole('button', { name: 'Empezar' }).click()
    await expectCount(app.page.getByRole('dialog'), 0)
    await expect.poll(() => settingsOf(userData).onboarded).toBe(true)

    // Reinicio con el mismo userData: el almacén ya existe, no se vuelve a reabrir.
    await app.stop()
    apps.splice(apps.indexOf(app), 1)
    app = await startApp({ userData, keepUserData: true })
    apps.push(app)
    expect(settingsOf(userData).onboarded).toBe(true)
    await app.page.waitForTimeout(1500)
    await expectCount(app.page.getByRole('dialog'), 0)
  })
})

// Windows v1: modo Tareas fuera de alcance (desactivado con aviso; sin Seatbelt ni credential proxy).
describe.skipIf(MODE !== 'dev' || IS_WIN)('Tareas con sandbox parte del auth propio', () => {
  async function tasksEnv(userData: string): ReturnType<FakeClient['env']> {
    const app = await startApp({ userData, keepUserData: true, env: { OPENCODE_BIN: fakeBin.bin } })
    apps.push(app)
    await app.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: MODE_LABELS.tasks }).click()
    await stubDialog(app.electronApp, { openPaths: [work.dir] })
    await app.page.getByRole('button', { name: 'Elegir carpeta' }).first().click()
    await app.page.getByRole('dialog').getByRole('button', { name: 'Permitir', exact: true }).click()
    await expect.poll(() => storeState(app.page, 'useTasks', 'phase'), { timeout: 60_000 }).toBe('ready')
    expect(await storeState<{ sandboxed: boolean }>(app.page, 'useTasks', 'conn')).toMatchObject({ sandboxed: true })
    return (await tasksFake(app.page)).env()
  }

  it('(d1) auth solo en el CLI: el sandbox no recibe ningún proveedor', async () => {
    const userData = newUserData()
    seedAuth(cliData(userData))
    const env = await tasksEnv(userData)
    expect(env.authContent.providers).toEqual([])
  })

  it('(d2) auth propio con opencode-go: solo ese proveedor y con clave centinela', async () => {
    const userData = newUserData()
    seedAuth(ownData(userData))
    const env = await tasksEnv(userData)
    expect(env.authContent.providers).toEqual(['opencode-go'])
    expect(env.authContent.allPlaceholder).toBe(true)
  })
})
