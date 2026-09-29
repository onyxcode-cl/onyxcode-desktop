// Asistente de primer uso: OpenCode ausente → elegir binario → clave de OpenCode Go → terminar y no volver a verlo.
// Un solo userData compartido (y reutilizado al reiniciar): cada test continúa donde acabó el anterior.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MODE_LABELS } from '../../src/shared/labels'
import { stubDialog } from '../lib/dialogs'
import { startApp, type E2EApp } from '../lib/launch'
import { fakeOutsideUserData } from '../lib/lotes'
import { expectCount, expectVisible } from '../lib/wait'

const settingsOf = (userData: string): Record<string, unknown> => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown>

describe('asistente de primer uso', () => {
  let app: E2EApp | null = null
  let userData = ''
  let home = ''
  let env: Record<string, string> = {}
  const fakeBin = fakeOutsideUserData()

  beforeAll(() => {
    userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-onb-')))
    // HOME propio y PATH mínimo (con `node` para el falso): así `findOpencodeBinary` no encuentra un OpenCode real
    // en ~/.opencode/bin ni en el PATH de la máquina que corre el test.
    home = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-onb-home-')))
    mkdirSync(join(home, '.opencode', 'bin'), { recursive: true })
    env = { OPENCODE_BIN: join(home, 'no-existe', 'opencode'), HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }
  })

  afterEach(async (ctx) => {
    if (app) await app.assertClean(ctx.task.name)
  })

  afterAll(async () => {
    await app?.stop()
    app = null
    fakeBin.dispose()
    for (const d of [userData, home]) if (d) rmSync(d, { recursive: true, force: true })
  })

  const dialog = (): ReturnType<E2EApp['page']['getByRole']> => app!.page.getByRole('dialog')

  it('(a) sin OpenCode y sin onboarded: paso 1 con el error y «Reintentar»', async () => {
    app = await startApp({ userData, keepUserData: true, noServer: true, env, settings: { onboarded: false } })
    const d = dialog()
    await expectVisible(d.getByRole('heading', { name: 'Instala o localiza OpenCode' }))
    await expectVisible(d.getByText('Paso 1 de 5'))
    await expectVisible(d.getByRole('alert').filter({ hasText: 'No se encontró el binario' }))
    for (const name of ['Copiar comando de instalación', 'Abrir instrucciones', 'Elegir binario…', 'Reintentar']) {
      await expectVisible(d.getByRole('button', { name }))
    }
    // «Continuar» exige que OpenCode funcione.
    expect(await d.getByRole('button', { name: 'Continuar' }).isDisabled()).toBe(true)

    // «Reintentar» vuelve a intentarlo y, con el mismo binario inexistente, el error sigue ahí.
    await d.getByRole('button', { name: 'Reintentar' }).click()
    await expectVisible(d.getByRole('alert').filter({ hasText: 'No se encontró el binario' }))
    expect(settingsOf(userData).onboarded).toBe(false)
  })

  it('(b) «Elegir binario…» con el falso copiado a tmp: valida, guarda y avanza', async () => {
    const a = app!
    await stubDialog(a.electronApp, { openPaths: [fakeBin.bin] })
    await dialog().getByRole('button', { name: 'Elegir binario…' }).click()
    await expectVisible(dialog().getByText('OpenCode encontrado'))
    await expectVisible(dialog().getByText('OpenCode está en marcha.'))
    await expect.poll(() => dialog().getByRole('button', { name: 'Continuar' }).isEnabled()).toBe(true)
    // El binario elegido se persistió (solo main lo escribe).
    expect(settingsOf(userData).opencodeBin).toBe(fakeBin.bin)
    await a.connectFake()
  })

  it('(c) una clave en el paso 2 llega al servidor como PUT /auth/opencode-go', async () => {
    const a = app!
    await dialog().getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(dialog().getByRole('heading', { name: 'Conecta OpenCode Go' }))
    await dialog().getByLabel('API key').fill('sk-e2e-onboarding')
    await dialog().getByRole('button', { name: 'Guardar' }).click()
    const put = await a.fake.waitForRequest((r) => r.method === 'PUT' && r.path === '/auth/opencode-go')
    expect(put.body).toEqual({ type: 'api', key: 'sk-e2e-onboarding' })
    await expectVisible(dialog().getByText('OpenCode Go conectado'))
  })

  it('(d) terminar guarda onboarded y el asistente no vuelve tras reiniciar', async () => {
    const a = app!
    await dialog().getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(dialog().getByRole('heading', { name: 'Elige tu modelo' }))
    await dialog().getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(dialog().getByRole('heading', { name: 'Los cuatro modos' }))
    for (const label of [MODE_LABELS.chat, MODE_LABELS.code, MODE_LABELS.tasks, MODE_LABELS.routines]) {
      await expectVisible(dialog().getByText(label, { exact: true }))
    }
    await dialog().getByRole('button', { name: 'Continuar' }).click()
    await expectVisible(dialog().getByRole('heading', { name: 'Permisos de macOS' }))
    await dialog().getByRole('button', { name: 'Empezar' }).click()
    await expectCount(a.page.getByRole('dialog'), 0)
    await expect.poll(() => settingsOf(userData).onboarded).toBe(true)

    // Reinicio con el MISMO userData: el binario guardado en ajustes basta (OPENCODE_BIN sigue inválido).
    await a.stop()
    app = await startApp({ userData, keepUserData: true, env })
    const settings = await app.page.evaluate(async () => {
      const w = window as unknown as { api: { invoke: (c: string) => Promise<{ data: { onboarded: boolean } }> } }
      return (await w.api.invoke('settings:get')).data
    })
    expect(settings.onboarded).toBe(true)
    await app.page.waitForTimeout(1500)
    await expectCount(app.page.getByRole('dialog'), 0)
  })
})
