// F8-B43: cada modo (Chat, Code, Tareas) recuerda su propio modelo en `modelsByMode` (extras.json); el predeterminado global
// (`settings.json`) solo vale para los modos sin elección propia y elegir en un modo NO lo modifica.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { startApp, type E2EApp } from '../lib/launch'
import { makeGitRepo, openCodeProject } from '../lib/fase6'
import { setMode, storeCall } from '../lib/stores'
import { expectAttr, expectVisible } from '../lib/wait'

const DEF = { providerID: 'opencode-go', modelID: 'fake-go-model' }
const REASONER = { providerID: 'fake', modelID: 'fake-reasoner' }
const FAKE = { providerID: 'fake', modelID: 'fake-model' }
const GONE = { providerID: 'opencode-go', modelID: 'gpt-5.6-luna' }
const SHOTS = process.env.MPM_SHOTS_DIR

const apps: E2EApp[] = []
const dirs: string[] = []

const newUserData = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-mpm-')))
  dirs.push(d)
  return d
}

async function launch(userData: string, defaultModel: object = DEF): Promise<E2EApp> {
  const app = await startApp({ userData, keepUserData: true, settings: { onboarded: true, defaultModel } })
  apps.push(app)
  await setMode(app.page, 'chat')
  return app
}

async function restart(app: E2EApp, userData: string): Promise<E2EApp> {
  await app.stop()
  apps.splice(apps.indexOf(app), 1)
  return launch(userData)
}

const readJson = (userData: string, file: string): any => {
  try {
    return JSON.parse(readFileSync(join(userData, file), 'utf8'))
  } catch {
    return {}
  }
}
const diskDefault = (u: string): unknown => readJson(u, 'settings.json').defaultModel
const diskMode = (u: string, mode: string): unknown => readJson(u, 'extras.json').modelsByMode?.[mode]

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

const picker = (page: Page): ReturnType<Page['locator']> => page.locator('button[aria-haspopup="listbox"][title*="/"]').first()

async function choose(page: Page, name: string): Promise<void> {
  await picker(page).click()
  await page.getByRole('option', { name: new RegExp(name) }).click()
}

async function openModels(page: Page): Promise<void> {
  await storeCall(page, 'useUi', 'openSettings', true)
  const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
  await expectVisible(nav)
  await nav.getByRole('button', { name: 'Modelos', exact: true }).click()
  await expectVisible(page.getByRole('heading', { name: 'Modelos' }))
}
const closeSettings = (page: Page): Promise<unknown> => storeCall(page, 'useUi', 'openSettings', false)
const modeRow = (page: Page, mode: string): ReturnType<Page['locator']> => page.getByRole('button', { name: `Modelo para ${mode}` })

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
})
afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('cada modo recuerda su modelo sin tocar el predeterminado', () => {
  it('(a) Chat: elegir uno no predeterminado, recorrer otros modos y Ajustes y volver; el predeterminado global no cambia', async () => {
    const userData = newUserData()
    const { page } = await launch(userData)
    await expectVisible(picker(page))
    await expectAttr(picker(page), 'title', 'opencode-go/fake-go-model')
    await choose(page, 'Fake Reasoner')
    await expectAttr(picker(page), 'title', 'fake/fake-reasoner')
    await expect.poll(() => diskMode(userData, 'chat')).toEqual(REASONER)

    for (const mode of ['code', 'routines', 'chat'] as const) {
      await setMode(page, mode)
      await page.waitForTimeout(300)
    }
    await openModels(page)
    await page.waitForTimeout(400)
    await shot(page, 'a-ajustes-tras-elegir-en-chat')
    await closeSettings(page)
    await setMode(page, 'chat')

    await expectAttr(picker(page), 'title', 'fake/fake-reasoner')
    expect(diskDefault(userData)).toEqual(DEF)
    expect(diskMode(userData, 'chat')).toEqual(REASONER)
    expect(diskMode(userData, 'code')).toBeUndefined()
    // Code no hereda la elección de Chat: sigue el predeterminado.
    const repo = makeGitRepo()
    dirs.push(repo)
    await openCodeProject(apps[0]!, repo)
    await expectAttr(picker(page), 'title', 'opencode-go/fake-go-model')
  })

  it('(b) Code: elegir uno, reiniciar con el mismo userData; Code y Chat recuerdan el suyo, independientes', async () => {
    const userData = newUserData()
    const repo = makeGitRepo()
    dirs.push(repo)
    let app = await launch(userData)
    await openCodeProject(app, repo)
    await expectVisible(picker(app.page))
    await choose(app.page, 'Fake Reasoner')
    await expectAttr(picker(app.page), 'title', 'fake/fake-reasoner')
    await expect.poll(() => diskMode(userData, 'code')).toEqual(REASONER)
    expect(diskDefault(userData)).toEqual(DEF)
    // Chat sigue con el predeterminado y elige uno distinto.
    await setMode(app.page, 'chat')
    await expectAttr(picker(app.page), 'title', 'opencode-go/fake-go-model')
    await choose(app.page, 'Fake Model')
    await expectAttr(picker(app.page), 'title', 'fake/fake-model')
    await expect.poll(() => diskMode(userData, 'chat')).toEqual(FAKE)

    app = await restart(app, userData)
    await expectAttr(picker(app.page), 'title', 'fake/fake-model') // Chat
    await openCodeProject(app, repo)
    await expectAttr(picker(app.page), 'title', 'fake/fake-reasoner') // Code
    await shot(app.page, 'b-code-tras-reiniciar')
    await setMode(app.page, 'chat')
    await expectAttr(picker(app.page), 'title', 'fake/fake-model')
    expect(diskDefault(userData)).toEqual(DEF)
  })

  it('(c) Ajustes › Modelos refleja y edita lo mismo que los selectores; «Usar el predeterminado» borra el override', async () => {
    const userData = newUserData()
    const first = await launch(userData)
    const page = first.page
    await choose(page, 'Fake Reasoner')
    await expect.poll(() => diskMode(userData, 'chat')).toEqual(REASONER)

    await openModels(page)
    await expect.poll(async () => (await modeRow(page, 'Chat').innerText()).includes('Fake Reasoner')).toBe(true)
    expect(await modeRow(page, 'Code').innerText()).toContain('Usar el predeterminado')
    await shot(page, 'c1-ajustes-reflejan-chat')

    // Editar desde Ajustes cambia el selector de Chat.
    await modeRow(page, 'Chat').click()
    await page.getByRole('option', { name: /Fake Model/ }).click()
    await expect.poll(() => diskMode(userData, 'chat')).toEqual(FAKE)
    await closeSettings(page)
    await setMode(page, 'chat')
    await expectAttr(picker(page), 'title', 'fake/fake-model')

    // «Usar el predeterminado» borra el override: Chat vuelve al predeterminado global.
    await openModels(page)
    await modeRow(page, 'Chat').click()
    await page.getByRole('option', { name: /Usar el predeterminado/ }).click()
    await expect.poll(() => diskMode(userData, 'chat')).toBeUndefined()
    await shot(page, 'c2-usar-predeterminado')
    await closeSettings(page)
    await setMode(page, 'chat')
    await expectAttr(picker(page), 'title', 'opencode-go/fake-go-model')

    // Cambiar el predeterminado global mueve a los modos sin elección propia, no a los que la tienen.
    await openModels(page)
    await page.getByRole('button', { name: 'Modelo predeterminado' }).click()
    await page.getByRole('option', { name: /Fake Reasoner/ }).click()
    await expect.poll(() => diskDefault(userData)).toEqual(REASONER)
    await closeSettings(page)
    await setMode(page, 'chat')
    await expectAttr(picker(page), 'title', 'fake/fake-reasoner')
  })

  it('(d) el modelo del modo ausente de la lista: «no disponible», envío bloqueado y sin persistir sustituto', async () => {
    const userData = newUserData()
    const { page } = await launch(userData)
    await expectVisible(picker(page))
    // Se siembra la elección propia de Chat con un modelo que el servidor no ofrece.
    await page.evaluate((m) => (window as any).api.extras.invoke('extras:setPrefs', { modelsByMode: { chat: m } }), GONE)
    await expect.poll(() => diskMode(userData, 'chat')).toEqual(GONE)
    await expectAttr(picker(page), 'title', 'opencode-go/gpt-5.6-luna')
    await expect.poll(async () => (await picker(page).innerText()).includes('no disponible')).toBe(true)
    await expectVisible(page.getByTestId('model-unavailable-notice'))
    await shot(page, 'd-no-disponible')
    const box = page.getByPlaceholder('Elige un modelo disponible para continuar')
    await expectVisible(box)
    expect(await box.isDisabled()).toBe(true)
    // El predeterminado y la elección siguen intactos (nada de sustituto persistido).
    expect(diskDefault(userData)).toEqual(DEF)
    expect(diskMode(userData, 'chat')).toEqual(GONE)
  })
})
