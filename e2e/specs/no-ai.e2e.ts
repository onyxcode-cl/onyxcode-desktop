// Sin IA conectada: banner con «Conectar una IA» en Chat, Code y Tareas (composer bloqueado), conexión desde Ajustes,
// modelo gratuito elegido a propósito y errores técnicos que nunca salen crudos. Cada grupo arranca su propia app con
// el OpenCode falso configurado (`connected.json` junto al falso) y `onboarded: true` (sin asistente).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { MODE_LABELS } from '../../src/shared/labels'
import { startApp, type E2EApp } from '../lib/launch'
import { openCodeProject } from '../lib/fase6'
import { expectCount, expectVisible } from '../lib/wait'
import { IS_WIN } from '../lib/proc'

const GO_MODEL = { providerID: 'opencode-go', modelID: 'fake-go-model' }
const BANNER_TITLE = 'Aún no conectaste ninguna IA'
const FREE_NOTE = 'Estás usando un modelo gratuito de OpenCode. Conecta una IA para acceder a más modelos.'
const SHOTS = process.env.NOAI_SHOTS_DIR

const apps: E2EApp[] = []
const dirs: string[] = []

/** App con el falso conectado a `connected` (null = los proveedores por defecto del falso). */
async function launch(connected: string[] | null): Promise<E2EApp> {
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-noai-')))
  dirs.push(userData)
  if (connected) {
    mkdirSync(join(userData, 'fake-opencode'), { recursive: true })
    writeFileSync(join(userData, 'fake-opencode', 'connected.json'), JSON.stringify(connected))
  }
  const app = await startApp({ userData, keepUserData: true, settings: { onboarded: true, defaultModel: GO_MODEL } })
  apps.push(app)
  return app
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: null })
}

const modeButton = (page: Page, name: string): ReturnType<Page['getByRole']> =>
  page.locator('nav[aria-label="Modo"]').getByRole('button', { name })
const blockedBox = (page: Page): ReturnType<Page['getByPlaceholder']> => page.getByPlaceholder('Conecta una IA para empezar').first()
const banner = (page: Page): ReturnType<Page['getByText']> => page.getByText(BANNER_TITLE)

afterEach(async (ctx) => {
  for (const a of apps) await a.assertClean(ctx.task.name)
})

afterAll(async () => {
  for (const a of apps.splice(0)) await a.stop()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('sin ninguna IA conectada', () => {
  let app: E2EApp

  it('(a) banner y composer bloqueado en Chat, Code y Tareas; «Conectar una IA» abre Ajustes › Modelos en Proveedores', async () => {
    app = await launch([])
    const { page } = app

    // Chat (vista vacía).
    await modeButton(page, 'Chat').click()
    await expectVisible(banner(page))
    await expectVisible(blockedBox(page))
    expect(await blockedBox(page).isDisabled()).toBe(true)
    await expectVisible(page.getByRole('button', { name: 'Conectar una IA' }))
    // No hay modelo gratuito en el catálogo conectado (vacío): el botón secundario no aparece.
    await expectCount(page.getByRole('button', { name: 'Probar un modelo gratuito' }), 0)
    // El selector no enseña el id crudo guardado.
    await expectVisible(page.getByRole('button', { name: 'Elige un modelo' }))
    await shot(page, 'chat-sin-ia')

    // Code.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-noai-code-')))
    dirs.push(dir)
    await openCodeProject(app, dir)
    await expectVisible(banner(page))
    await expectVisible(blockedBox(page))
    expect(await blockedBox(page).isDisabled()).toBe(true)
    await shot(page, 'code-sin-ia')

    // Tareas.
    // Windows v1: sin modo Tareas.
    if (!IS_WIN) {
      await modeButton(page, MODE_LABELS.tasks).click()
      await expectVisible(banner(page))
      await expectVisible(blockedBox(page))
      expect(await blockedBox(page).isDisabled()).toBe(true)
      await shot(page, 'tareas-sin-ia')
    }

    // «Conectar una IA»: Ajustes › Modelos con la sección Proveedores a la vista.
    await modeButton(page, 'Chat').click()
    await page.getByRole('button', { name: 'Conectar una IA' }).first().click()
    await expectVisible(page.getByRole('heading', { name: 'Modelos' }))
    const providers = page.locator('#settings-providers')
    await expectVisible(providers.getByText('Proveedores'))
    await expect
      .poll(() =>
        providers.evaluate((el) => {
          const r = el.getBoundingClientRect()
          return r.top >= 0 && r.bottom <= window.innerHeight
        })
      )
      .toBe(true)
    await shot(page, 'ajustes-proveedores')
  })

  it('(b) conectar la clave de Go en Ajustes: el banner desaparece y el envío funciona', async () => {
    const { page, fake } = app
    const form = page.getByLabel('Proveedor')
    await expectVisible(form)
    await form.selectOption('opencode-go')
    await page.getByLabel('API key').fill('sk-e2e-noai-0123456789')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expectVisible(page.getByText('Conectado').first())

    await page.getByRole('button', { name: /Cerrar ajustes/ }).click()
    await modeButton(page, 'Chat').click()
    await expectCount(banner(page), 0)
    const box = page.getByPlaceholder('Escribe un mensaje…')
    await expectVisible(box)
    await box.fill('hola')
    await page.getByRole('button', { name: 'Enviar' }).click()
    const req = await fake.waitForRequest((r) => r.method === 'POST' && /\/session\/[^/]+\/prompt_async$/.test(r.path))
    expect(JSON.stringify(req.body)).toContain('fake-go-model')
    await expectVisible(page.getByText('Respuesta simulada: hola'), 30_000)
    // Sin nota de modelo gratuito.
    await expectCount(page.getByText(FREE_NOTE), 0)
  })
})

describe('solo el modelo gratuito', () => {
  it('(c) «Probar un modelo gratuito» habilita el envío y deja la nota suave', async () => {
    const app = await launch(['opencode'])
    const { page, fake } = app
    await modeButton(page, 'Chat').click()
    await expectVisible(banner(page))
    expect(await blockedBox(page).isDisabled()).toBe(true)
    await shot(page, 'chat-solo-gratuito')

    await page.getByRole('button', { name: 'Probar un modelo gratuito' }).click()
    await expectCount(banner(page), 0)
    await expectVisible(page.getByText(FREE_NOTE))
    await expectVisible(page.getByRole('button', { name: 'Conectar una IA' }))
    await shot(page, 'chat-gratuito-elegido')

    const box = page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('hola gratis')
    await page.getByRole('button', { name: 'Enviar' }).click()
    const req = await fake.waitForRequest((r) => r.method === 'POST' && /\/session\/[^/]+\/prompt_async$/.test(r.path))
    expect(JSON.stringify(req.body)).toContain('fake-free-model')
    await expectVisible(page.getByText('Respuesta simulada: hola gratis'), 30_000)
  })
})

describe('errores de la IA nunca crudos', () => {
  it('(d) error 401 forzado: mensaje claro, «Ver detalle» con el texto técnico y sin líneas de pila', async () => {
    const app = await launch(null)
    const { page, fake } = app
    await modeButton(page, 'Chat').click()
    await fake.script({
      steps: [{ type: 'error', name: 'APIError', statusCode: 401, message: 'Unauthorized: invalid key sk-e2e-secreto-0123456789' }],
      match: 'falla'
    })
    const box = page.getByPlaceholder('Escribe un mensaje…')
    await expectVisible(box)
    await box.fill('falla ahora')
    await page.getByRole('button', { name: 'Enviar' }).click()

    await expectVisible(page.getByText('La IA rechazó la conexión'))
    await expectVisible(page.getByText(/Vuelve a conectarla en Ajustes › Modelos/))
    await expectVisible(page.getByRole('button', { name: 'Conectar una IA' }))
    const detail = page.getByText('Ver detalle')
    await expectVisible(detail)
    await shot(page, 'error-401-plegado')
    await detail.click()
    await expectVisible(page.getByText(/statusCode: 401/))
    // El rótulo cambia junto con el contenido (antes seguía en «Ver detalle» hasta el evento `toggle`, que llega en otra tarea:
    // la causa de la prueba inestable). Se espera igualmente con reintento, por si el equipo va muy cargado.
    await expectVisible(page.getByText('Ocultar detalle'))
    const text = await page.locator('body').innerText()
    expect(text).toContain('Ocultar detalle')
    expect(text).not.toMatch(/at <anonymous>/)
    // La clave del mensaje técnico sale redactada.
    expect(text).not.toContain('sk-e2e-secreto-0123456789')
    await shot(page, 'error-401-detalle')
  })

  it('(e) proveedor desconectado tras cargar: el ProviderModelNotFoundError crudo queda solo dentro del detalle', async () => {
    const app = apps[apps.length - 1]
    const { page, fake } = app
    await page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    // El renderer aún cree que Go está conectado; el falso ya no (como un servidor reiniciado sin credencial).
    await fake.set({ connectedProviders: ['fake'] })
    const box = page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('hola de nuevo')
    await page.getByRole('button', { name: 'Enviar' }).click()

    await expectVisible(page.getByText('El modelo elegido no está disponible'))
    await expectVisible(page.getByText(/opencode-go\/fake-go-model/))
    const before = await page.locator('body').innerText()
    expect(before).not.toMatch(/at <anonymous>/)
    expect(before).not.toContain('ProviderModelNotFoundError')
    await page.getByText('Ver detalle').click()
    await expectVisible(page.getByText(/ProviderModelNotFoundError: Model not found/))
    await shot(page, 'error-modelo-no-encontrado')
  })
})
