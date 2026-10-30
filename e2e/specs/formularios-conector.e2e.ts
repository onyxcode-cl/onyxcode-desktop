// Formularios de conectores (MCP `elicitation`) en Code, con el OpenCode falso (paso `elicitation` + rutas `/mcp/elicitation`):
// la tarjeta sale con cabecera fija y texto plano, valida antes de enviar, envía solo lo escrito, un 400 la deja abierta, Esc cancela,
// Detener la cancela y un rechazo sin tarjeta previa deja un aviso. Solo modo dev (usa el motor falso y los ganchos del renderer).
import { afterAll, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { makeGitRepo, openCodeProject } from '../lib/fase6'
import { useApp } from '../lib/harness'
import { MODE, type E2EApp } from '../lib/launch'
import { storeState } from '../lib/stores'
import { expectCount, expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'

describe.skipIf(!DEV)('formularios de conectores: tarjeta en Code', () => {
  const dir = makeGitRepo()
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const app = useApp()

  const card = (a: E2EApp) => a.page.getByRole('dialog', { name: /Formulario del conector forms/ })
  const box = (a: E2EApp) => a.page.getByPlaceholder(/Pide un cambio en el código/)
  const status = async (a: E2EApp) =>
    (await a.fake.status()) as {
      pendingElicitations: Array<{ id: string }>
      elicitationReplies: Array<{ action: string; fields: string[] }>
    }

  const FIELDS = [
    { name: 'titulo', type: 'string', title: 'Título', required: true, maxLength: 30 },
    { name: 'urgente', type: 'boolean', title: 'Es urgente', required: false },
    { name: 'prioridad', type: 'integer', title: 'Prioridad', required: false, minimum: 1, maximum: 5 }
  ]

  async function ask(a: E2EApp, match: string, over: Record<string, unknown> = {}): Promise<void> {
    await openCodeProject(a, dir)
    await a.fake.script({
      match,
      steps: [
        { type: 'text', text: 'Voy a crear el ticket.' },
        {
          type: 'elicitation',
          server: 'forms',
          message: 'Necesito el título. <a href="https://evil.example">no es un enlace</a> **ni negrita**',
          fields: FIELDS,
          ...over
        },
        { type: 'text', text: 'Listo, ticket creado.' }
      ]
    })
    await box(a).fill(match)
    await box(a).press('Enter')
    await expectVisible(card(a), 30_000)
  }

  it('la variable LAZUNOX_MCP_ELICITATION=1 llega al motor principal (por defecto encendido en Chat y Code)', async () => {
    const env = (await app().fake.env()) as unknown as { flags: { mcpElicitation: boolean } }
    expect(env.flags.mcpElicitation).toBe(true)
  })

  it('cabecera fija, texto plano sin enlaces y nada rellenado; el foco entra al primer campo', async () => {
    const a = app()
    await ask(a, 'formulario uno')
    const c = card(a)
    await expect.poll(() => c.getAttribute('aria-modal')).toBe('true')
    expect(await c.textContent()).toContain('Lo pide el conector, no Lazunox')
    expect(await c.textContent()).toContain('<a href="https://evil.example">no es un enlace</a> **ni negrita**')
    expect(await c.locator('a, img, strong, em').count()).toBe(0)
    expect(await a.page.getByLabel('Título', { exact: true }).inputValue()).toBe('')
    expect(await a.page.getByLabel('Es urgente').isChecked()).toBe(false)
    await expect
      .poll(() => a.page.evaluate(() => document.activeElement?.id ?? ''), { timeout: 5_000 })
      .toBe(await a.page.getByLabel('Título', { exact: true }).evaluate((el) => el.id))
    // Cierra el formulario para el siguiente test.
    await a.page.getByRole('button', { name: 'No enviar' }).click()
    await expectCount(card(a), 0)
  })

  it('con el obligatorio vacío no envía; con datos válidos envía SOLO lo escrito y el resultado vuelve al agente', async () => {
    const a = app()
    await ask(a, 'formulario dos')
    const before = (await status(a)).elicitationReplies.length
    await a.page.getByRole('button', { name: /Enviar a forms/ }).click()
    await expectVisible(a.page.getByText('Este dato es obligatorio.'))
    expect((await status(a)).elicitationReplies.length).toBe(before) // no salió ninguna petición
    await a.page.getByLabel('Título', { exact: true }).fill('Falla el login')
    await a.page.getByLabel('Es urgente').check()
    await a.page.getByRole('button', { name: /Enviar a forms/ }).click()
    await expectCount(card(a), 0)
    await expectVisible(a.page.getByText('Listo, ticket creado.'), 30_000)
    const replies = (await status(a)).elicitationReplies
    expect(replies.at(-1)).toEqual({ requestID: expect.any(String), action: 'accept', fields: ['titulo', 'urgente'] })
  })

  it('un 400 del motor deja la tarjeta abierta con el motivo y lo escrito intacto', async () => {
    const a = app()
    await ask(a, 'formulario tres', {
      fields: [{ name: 'titulo', type: 'string', title: 'Título', required: true, maxLength: 30, forbid: 'XXX' }]
    })
    await a.page.getByLabel('Título', { exact: true }).fill('Hola XXX')
    await a.page.getByRole('button', { name: /Enviar a forms/ }).click()
    await expectVisible(a.page.getByText('El motor no aceptó este dato: valor no permitido'))
    expect(await card(a).count()).toBe(1)
    expect(await a.page.getByLabel('Título', { exact: true }).inputValue()).toBe('Hola XXX')
    await a.page.getByLabel('Título', { exact: true }).fill('Hola')
    await a.page.getByRole('button', { name: /Enviar a forms/ }).click()
    await expectCount(card(a), 0)
  })

  it('Esc cancela el formulario (el servidor recibe cancel)', async () => {
    const a = app()
    await ask(a, 'formulario cuatro')
    await a.page.getByLabel('Título', { exact: true }).press('Escape')
    await expectCount(card(a), 0)
    expect((await status(a)).elicitationReplies.at(-1)).toMatchObject({ action: 'cancel', fields: [] })
  })

  it('Detener con el formulario abierto: la tarjeta desaparece y no queda nada pendiente en el motor', async () => {
    const a = app()
    await ask(a, 'formulario cinco')
    await a.page.getByRole('button', { name: 'Detener' }).click()
    await expectCount(card(a), 0)
    await expect.poll(async () => (await status(a)).pendingElicitations.length, { timeout: 10_000 }).toBe(0)
    expect(await storeState(a.page, 'useCode', 'elicitations')).toEqual({})
  })

  it('un rechazo sin formulario previo (contraseña pedida) deja un aviso informativo y ningún formulario', async () => {
    const a = app()
    await openCodeProject(a, dir)
    const sid = await storeState<string | null>(a.page, 'useCode', 'activeSessionID')
    expect(sid).toBeTruthy()
    await a.fake.emit({ directory: dir, type: 'mcp.elicitation.rejected', properties: { id: 'eli_pwd', sessionID: sid, reason: 'secret' } })
    await expectVisible(a.page.getByText('Lazunox no envía contraseñas ni claves por formularios de conectores'))
    expect(await a.page.getByRole('dialog', { name: /Formulario del conector/ }).count()).toBe(0)
    await a.page.getByRole('button', { name: 'Cerrar aviso' }).click()
    await expectCount(a.page.getByText('Lazunox no envía contraseñas ni claves por formularios de conectores'), 0)
  })
})
