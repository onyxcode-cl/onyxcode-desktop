// F8-B42 (+ F8-B43): el modelo elegido en Chat no se pierde al cambiar de modo, abrir Ajustes ni reiniciar la app. Desde B43 vive
// en `modelsByMode.chat` (extras.json) y NO toca el predeterminado global (`settings.json`).
// Se verifica en tres sitios: `settings.json` (disco), el store del renderer y el DOM del selector.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { startApp, type E2EApp } from '../lib/launch'
import { setMode, storeCall, storeState } from '../lib/stores'
import { expectAttr, expectCount, expectVisible } from '../lib/wait'

const GO = { providerID: 'opencode-go', modelID: 'fake-go-model' }
const REASONER = { providerID: 'fake', modelID: 'fake-reasoner' }
const GONE = { providerID: 'opencode-go', modelID: 'gpt-5.6-luna' }
const SHOTS = process.env.MOD_SHOTS_DIR

const apps: E2EApp[] = []
const dirs: string[] = []

function newUserData(connected?: string[]): string {
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-model-')))
  dirs.push(userData)
  if (connected) {
    mkdirSync(join(userData, 'fake-opencode'), { recursive: true })
    writeFileSync(join(userData, 'fake-opencode', 'connected.json'), JSON.stringify(connected))
  }
  return userData
}

async function launch(userData: string, defaultModel: object = GO): Promise<E2EApp> {
  const app = await startApp({ userData, keepUserData: true, settings: { onboarded: true, defaultModel } })
  apps.push(app)
  await setMode(app.page, 'chat')
  return app
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

const picker = (page: Page): ReturnType<Page['locator']> => page.locator('button[aria-haspopup="listbox"]').first()
const diskModel = (userData: string): unknown => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).defaultModel
const diskChat = (userData: string): unknown => {
  try {
    return JSON.parse(readFileSync(join(userData, 'extras.json'), 'utf8')).modelsByMode?.chat
  } catch {
    return undefined
  }
}
const storeModel = (page: Page): Promise<unknown> => storeState(page, 'useSettings', 'settings.defaultModel')
const goTo = async (page: Page, mode: 'chat' | 'code' | 'tasks' | 'routines'): Promise<void> => setMode(page, mode)

async function expectText(loc: ReturnType<Page['locator']>, text: string): Promise<void> {
  await expect.poll(async () => (await loc.innerText()).includes(text), { timeout: 15_000 }).toBe(true)
}

async function choose(page: Page, name: string): Promise<void> {
  await picker(page).click()
  await page.getByRole('option', { name: new RegExp(name) }).click()
}

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
})

afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('el modelo elegido en Chat persiste', () => {
  it('(a) elegir un modelo no predeterminado, ir a otros modos y a Ajustes, y volver: sigue el mismo (disco, store y DOM)', async () => {
    const userData = newUserData()
    const { page } = await launch(userData)
    await expectVisible(picker(page))
    await choose(page, 'Fake Reasoner')
    await expectAttr(picker(page), 'title', 'fake/fake-reasoner')
    await shot(page, 'a1-elegido')

    for (const mode of ['code', 'tasks', 'routines', 'chat'] as const) {
      await goTo(page, mode)
      await page.waitForTimeout(300)
    }
    await storeCall(page, 'useUi', 'openSettings', true)
    await expectVisible(page.getByRole('heading', { name: 'Modelos' }).or(page.getByRole('button', { name: /Cerrar ajustes/ })))
    await page.waitForTimeout(500)
    await storeCall(page, 'useUi', 'openSettings', false)
    await goTo(page, 'chat')

    await expectAttr(picker(page), 'title', 'fake/fake-reasoner')
    await expectText(picker(page), 'Fake Reasoner')
    expect(await storeModel(page)).toEqual(GO) // el predeterminado global no se tocó
    expect(diskModel(userData)).toEqual(GO)
    await expect.poll(() => diskChat(userData)).toEqual(REASONER)
    await shot(page, 'a2-tras-volver')
  })

  it('(b) cerrar y reabrir la app con el mismo userData: sigue el mismo modelo', async () => {
    const userData = newUserData()
    let app = await launch(userData)
    await choose(app.page, 'Fake Reasoner')
    await expectAttr(picker(app.page), 'title', 'fake/fake-reasoner')
    await expect.poll(() => diskChat(userData)).toEqual(REASONER)
    await app.stop()
    apps.splice(apps.indexOf(app), 1)

    app = await launch(userData)
    await expectVisible(picker(app.page))
    await expectText(picker(app.page), 'Fake Reasoner')
    await expectAttr(picker(app.page), 'title', 'fake/fake-reasoner')
    expect(diskModel(userData)).toEqual(GO)
    expect(diskChat(userData)).toEqual(REASONER)
  })

  it('(c) la lista de modelos recargada o aún sin cargar no cambia la elección', async () => {
    const userData = newUserData()
    const { page } = await launch(userData)
    await expectVisible(picker(page))
    await choose(page, 'Fake Reasoner')
    // Lista aún sin cargar (transitorio): no se cambia nada.
    await page.evaluate(() => (window as any).__onyxE2E.useProviders.setState({ loaded: false, providers: [], defaults: {} }))
    await expectAttr(picker(page), 'title', 'fake/fake-reasoner')
    expect(diskModel(userData)).toEqual(GO)
    await expect.poll(() => diskChat(userData)).toEqual(REASONER)
  })
})

describe('modelo que ya no está en la lista (o proveedor sin clave)', () => {
  it('(d) se muestra el elegido como «no disponible», se avisa, no se cambia en silencio ni se persiste el sustituto', async () => {
    const userData = newUserData()
    const { page, fake } = await launch(userData, GONE)
    await expectVisible(picker(page))
    // El selector no esconde la elección: sigue apuntando al modelo guardado y lo marca como no disponible.
    await expectAttr(picker(page), 'title', 'opencode-go/gpt-5.6-luna')
    await expectText(picker(page), 'gpt-5.6-luna')
    await expectText(picker(page), 'no disponible')
    await expectVisible(page.getByTestId('model-unavailable-notice'))
    await shot(page, 'd1-no-disponible')
    // No se persistió ningún sustituto.
    expect(diskModel(userData)).toEqual(GONE)
    expect(await storeModel(page)).toEqual(GONE)

    // Enviar con un modelo no disponible no se hace con otro a escondidas: el compositor queda bloqueado.
    const box = page.getByPlaceholder('Elige un modelo disponible para continuar')
    await expectVisible(box)
    expect(await box.isDisabled()).toBe(true)
    const posted = (await fake.requests()).filter((r) => r.method === 'POST' && /prompt_async$|\/message$/.test(r.path))
    expect(posted).toHaveLength(0)
    // El aviso de «sin IA» no aparece: hay IA, falta el modelo.
    await expectCount(page.getByTestId('no-ai-banner'), 0)

    // Elegir uno disponible lo reemplaza y el aviso desaparece.
    await choose(page, 'Fake Reasoner')
    await expectAttr(picker(page), 'title', 'fake/fake-reasoner')
    expect(diskModel(userData)).toEqual(GONE) // el predeterminado global no se toca
    await expect.poll(() => diskChat(userData)).toEqual(REASONER)
  })

  it('(e) proveedor sin clave: la elección se conserva en disco y vuelve a valer al reconectarlo', async () => {
    const userData = newUserData(['fake', 'opencode-go']) // `anthropic` sin conectar
    const app = await launch(userData, { providerID: 'anthropic', modelID: 'fake-claude' })
    const { page } = app
    await expectVisible(picker(page))
    await expectAttr(picker(page), 'title', 'anthropic/fake-claude')
    await expectText(picker(page), 'no disponible')
    expect(diskModel(userData)).toEqual({ providerID: 'anthropic', modelID: 'fake-claude' })

    // Al conectar el proveedor y recargar la lista, la elección vuelve a valer sin que el usuario la repita.
    await app.fake.set({ connectedProviders: ['fake', 'opencode-go', 'anthropic'] })
    await page.evaluate(() => {
      const w = (window as any).__onyxE2E
      return w.useProviders.getState().load(w.useServer.getState().client, true)
    })
    await expectAttr(picker(page), 'title', 'anthropic/fake-claude')
    await expectCount(page.getByTestId('model-unavailable-notice'), 0)
    await expectVisible(page.getByPlaceholder('Escribe un mensaje…'))
    expect(diskModel(userData)).toEqual({ providerID: 'anthropic', modelID: 'fake-claude' })
  })
})
