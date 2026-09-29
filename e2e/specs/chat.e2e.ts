import { describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { expectVisible } from '../lib/wait'

const app = useApp()

describe(`chat (${MODE})`, () => {
  it('crea una conversación y muestra la respuesta simulada', async () => {
    const { page, fake } = app()
    await page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const box = page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('hola')
    await page.getByRole('button', { name: 'Enviar' }).click()

    const req = await fake.waitForRequest((r) => r.method === 'POST' && /\/session\/[^/]+\/prompt_async$/.test(r.path))
    expect(JSON.stringify(req.body)).toContain('hola')
    await expectVisible(page.getByText('Respuesta simulada: hola'), 30_000)
  })
})
