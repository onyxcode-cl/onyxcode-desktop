import { afterAll, describe, expect, it } from 'vitest'
import { startApp, type E2EApp } from '../lib/launch'
import { expectVisible } from '../lib/wait'

let app: E2EApp

afterAll(async () => {
  await app?.stop()
})

describe('botón de tema de la barra lateral', () => {
  it('alterna claro y oscuro en cada clic (el segundo clic ya no repite el mismo tema)', async () => {
    app = await startApp({})
    const btn = app.page.getByRole('button', { name: 'Cambiar tema' })
    await expectVisible(btn)
    const theme = (): Promise<string | null> => app.page.locator('html').getAttribute('data-theme')
    const first = await theme()
    const seen: Array<string | null> = [first]
    for (let i = 0; i < 4; i++) {
      await btn.click()
      await expect.poll(theme, { timeout: 5000 }).not.toBe(seen[seen.length - 1])
      seen.push(await theme())
    }
    expect(seen[2]).toBe(seen[0])
    expect(seen[1]).toBe(seen[3])
    expect(seen[1]).not.toBe(seen[0])
    await app.assertClean('tema')
  })
})
