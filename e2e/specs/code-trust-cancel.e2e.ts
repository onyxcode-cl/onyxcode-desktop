// Code: denegar la confianza de una carpeta no deja nada a medias; abrir otra después deja Code usable.
import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { makeGitRepo } from '../lib/fase6'
import { stubDialog } from '../lib/dialogs'
import { storeState } from '../lib/stores'
import { expectCount, expectVisible } from '../lib/wait'

describe('Code: cancelar la confianza y abrir otra carpeta', () => {
  const app = useApp()
  const repoA = makeGitRepo('lazunox-e2e-trust-a-')
  const repoB = makeGitRepo('lazunox-e2e-trust-b-')
  afterAll(() => {
    for (const d of [repoA, repoB]) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  })

  it('cancelar → otra carpeta → Code se puede usar', async () => {
    const a = app()
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Code' }).click()
    const dlg = a.page.getByRole('alertdialog', { name: '¿Confiar en esta carpeta?' })

    await stubDialog(a.electronApp, { openPaths: [repoA] })
    await a.page
      .getByRole('button', { name: /Abrir carpeta/ })
      .first()
      .click()
    await expectVisible(dlg)
    await a.page.getByRole('button', { name: 'Cancelar' }).click()
    await expectCount(dlg, 0)
    expect(await storeState(a.page, 'useCode', 'directory')).toBeNull()
    expect(await storeState<string[]>(a.page, 'useCode', 'trustedFolders')).toEqual([])

    await stubDialog(a.electronApp, { openPaths: [repoB] })
    await a.page
      .getByRole('button', { name: /Abrir carpeta/ })
      .first()
      .click()
    await expectVisible(dlg)
    await a.page.getByRole('button', { name: 'Confiar y continuar' }).click()
    await expect.poll(() => storeState(a.page, 'useCode', 'directory'), { timeout: 15_000 }).toBe(repoB)

    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await expectVisible(box, 20_000)
    await box.fill('hola tras cancelar')
    await a.page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(a.page.getByText('Respuesta simulada: hola tras cancelar'), 30_000)
  })

  it('con un proyecto abierto: cancelar otra carpeta deja el foco donde estaba y luego otra abre bien', async () => {
    const a = app()
    const repoC = makeGitRepo('lazunox-e2e-trust-c-')
    const repoD = makeGitRepo('lazunox-e2e-trust-d-')
    try {
      const dlg = a.page.getByRole('alertdialog', { name: '¿Confiar en esta carpeta?' })
      await stubDialog(a.electronApp, { openPaths: [repoC] })
      await a.page.getByRole('button', { name: 'Abrir carpeta' }).first().click()
      await expectVisible(dlg)
      await a.page.getByRole('button', { name: 'Cancelar' }).click()
      await expectCount(dlg, 0)
      expect(await storeState(a.page, 'useCode', 'directory')).toBe(repoB)
      expect(await storeState<string[]>(a.page, 'useCode', 'openDirectories')).toEqual([repoB])

      await stubDialog(a.electronApp, { openPaths: [repoD] })
      await a.page.getByRole('button', { name: 'Abrir carpeta' }).first().click()
      await expectVisible(dlg)
      await a.page.getByRole('button', { name: 'Confiar y continuar' }).click()
      await expect.poll(() => storeState(a.page, 'useCode', 'directory'), { timeout: 15_000 }).toBe(repoD)
      const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
      await expectVisible(box, 20_000)
      await box.fill('segundo mensaje')
      await a.page.getByRole('button', { name: 'Enviar' }).click()
      await expectVisible(a.page.getByText('Respuesta simulada: segundo mensaje'), 30_000)
    } finally {
      for (const d of [repoC, repoD]) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    }
  })

  it('arranque con un proyecto restaurado sin confianza: cancelar no lo deja enfocado y otra carpeta funciona', async () => {
    const a = app()
    const repoE = makeGitRepo('lazunox-e2e-trust-e-')
    const repoF = makeGitRepo('lazunox-e2e-trust-f-')
    try {
      await a.page.evaluate((dir) => {
        localStorage.setItem('code.projects', JSON.stringify({ v: 1, open: [dir], focus: dir }))
        localStorage.setItem('code.project', dir)
        localStorage.setItem('code.trustedFolders', '[]')
      }, repoE)
      await a.page.reload() // el modo Code ya es el activo tras recargar
      const dlg = a.page.getByRole('alertdialog', { name: '¿Confiar en esta carpeta?' })
      await expectVisible(dlg, 20_000)
      await a.page.getByRole('button', { name: 'Cancelar' }).click()
      await expectCount(dlg, 0)
      // Nada enfocado ni abierto sin confianza: vuelve la pantalla de elegir proyecto y no hay compositor para esa carpeta.
      await expect.poll(() => storeState(a.page, 'useCode', 'directory')).toBeNull()
      expect(await storeState<string[]>(a.page, 'useCode', 'openDirectories')).toEqual([])
      expect(await storeState<string[]>(a.page, 'useCode', 'trustedFolders')).toEqual([])
      await expectCount(a.page.getByPlaceholder(/Pide un cambio en el código/), 0)
      // Otra carpeta después funciona y Code queda usable.
      await stubDialog(a.electronApp, { openPaths: [repoF] })
      await a.page
        .getByRole('button', { name: /Abrir carpeta/ })
        .first()
        .click()
      await expectVisible(dlg)
      await a.page.getByRole('button', { name: 'Confiar y continuar' }).click()
      await expect.poll(() => storeState(a.page, 'useCode', 'directory'), { timeout: 15_000 }).toBe(repoF)
      const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
      await expectVisible(box, 20_000)
      await box.fill('tras denegar al arrancar')
      await a.page.getByRole('button', { name: 'Enviar' }).click()
      await expectVisible(a.page.getByText('Respuesta simulada: tras denegar al arrancar'), 30_000)
    } finally {
      for (const d of [repoE, repoF]) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    }
  })
})
