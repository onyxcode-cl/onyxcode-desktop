// Archivos del proyecto (Code): actualización automática (fs.watch en main, sin polling), gestor (crear / renombrar / eliminar)
// y «Abrir en…» con un editor simulado que registra la llamada. Repo temporal REAL; Papelera y editores de pruebas.
// Capturas con MX_SHOTS_DIR (claro/oscuro, 820/1280 px).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { shot } from '../lib/shots'
import { expectCount, expectVisible } from '../lib/wait'
import { makeGitRepo, openCodeProject } from '../lib/fase6'

const SHOTS = process.env.MX_SHOTS_DIR
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-mx-')))
const trashDir = join(scratch, 'trash')
const editorLog = join(scratch, 'editores.log')
const outside = join(scratch, 'fuera')
let repo = ''

type Api = {
  code: { files: Record<string, (...a: unknown[]) => Promise<unknown>>; editors: Record<string, (...a: unknown[]) => Promise<unknown>> }
}
/** Llama al canal real y devuelve el mensaje de error (o 'OK'). */
async function call(page: Page, area: 'files' | 'editors', fn: string, ...args: unknown[]): Promise<string> {
  return page.evaluate(
    async ({ area, fn, args }) => {
      try {
        await (window as unknown as { api: Api }).api.code[area][fn](...args)
        return 'OK'
      } catch (e) {
        return (e as Error).message
      }
    },
    { area, fn, args }
  )
}

describe.skipIf(MODE === 'prod')(`archivos del proyecto: vigilante, gestor y «Abrir en…» (${MODE})`, () => {
  beforeAll(() => {
    repo = makeGitRepo('onyx-e2e-mx-')
    mkdirSync(join(repo, 'src'))
    writeFileSync(join(repo, 'src', 'main.ts'), 'export {}\n')
    mkdirSync(join(repo, 'node_modules'))
    mkdirSync(outside)
    writeFileSync(join(outside, 'secreto.txt'), 'S')
  })
  const app = useApp({
    env: { ONYXCODE_E2E_TRASH_DIR: trashDir, ONYXCODE_E2E_EDITOR_LOG: editorLog, ONYXCODE_E2E_EDITORS: 'vscode,zed' }
  })
  afterAll(async () => {
    await app()
      .stop()
      .catch(() => undefined)
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  })

  const openFiles = async (): Promise<Page> => {
    const a = app()
    await openCodeProject(a, repo)
    const btn = a.page.locator('button[aria-label="Archivos"]')
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click()
    await expectVisible(a.page.getByRole('button', { name: 'README.md' }), 20_000)
    return a.page
  }
  const row = (page: Page, name: string): ReturnType<Page['getByRole']> => page.getByRole('button', { name, exact: true })

  it('un archivo creado fuera de la app aparece solo, y desaparece al borrarlo (sin pulsar Actualizar)', async () => {
    const page = await openFiles()
    await expectCount(row(page, 'externo.txt'), 0)
    writeFileSync(join(repo, 'externo.txt'), 'hola')
    await expectVisible(row(page, 'externo.txt'), 10_000)
    // Carpeta abierta: cambios dentro de ella también.
    await row(page, 'src').click()
    await expectVisible(row(page, 'main.ts'))
    writeFileSync(join(repo, 'src', 'nuevo.ts'), 'x')
    await expectVisible(row(page, 'nuevo.ts'), 10_000)
    rmSync(join(repo, 'externo.txt'))
    await expectCount(row(page, 'externo.txt'), 0, 10_000)
    await shot(app(), SHOTS, 'archivos-vigilante')
  })

  it('el panel Cambios también se pone al día con un cambio externo', async () => {
    const a = app()
    const page = a.page
    await page.locator('button[aria-label="Cambios"]').click()
    await expectVisible(
      page
        .getByText('cambiado-fuera.txt')
        .first()
        .or(page.getByRole('button', { name: 'Actualizar', exact: true })),
      20_000
    )
    writeFileSync(join(repo, 'cambiado-fuera.txt'), 'x')
    await expectVisible(page.getByText('cambiado-fuera.txt').first(), 10_000)
    rmSync(join(repo, 'cambiado-fuera.txt'))
    await page.locator('button[aria-label="Archivos"]').click()
    await expectVisible(row(page, 'README.md'), 20_000)
  })

  it('crear archivo y carpeta desde la UI (edición en línea) y rechazar un nombre repetido', async () => {
    const a = app()
    const page = a.page
    await page.getByRole('button', { name: 'Nuevo archivo', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Nombre' })
    await expectVisible(input)
    await shot(a, SHOTS, 'archivos-crear-linea')
    await input.fill('README.md')
    await input.press('Enter')
    await expectVisible(page.getByRole('alert').filter({ hasText: 'Ya existe' }))
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('# e2e\n') // no se sobrescribió
    await input.fill('notas.txt')
    await input.press('Enter')
    await expectVisible(row(page, 'notas.txt'))
    expect(existsSync(join(repo, 'notas.txt'))).toBe(true)
    await page.getByRole('button', { name: 'Nueva carpeta', exact: true }).click()
    await page.getByRole('textbox', { name: 'Nombre' }).fill('docs')
    await page.getByRole('textbox', { name: 'Nombre' }).press('Enter')
    await expectVisible(row(page, 'docs'))
    expect(existsSync(join(repo, 'docs'))).toBe(true)
    // Escape cancela sin crear nada.
    await page.getByRole('button', { name: 'Nuevo archivo', exact: true }).click()
    await page.getByRole('textbox', { name: 'Nombre' }).fill('cancelado.txt')
    await page.getByRole('textbox', { name: 'Nombre' }).press('Escape')
    await expectCount(page.getByRole('textbox', { name: 'Nombre' }), 0)
    expect(existsSync(join(repo, 'cancelado.txt'))).toBe(false)
  })

  it('renombrar con F2 y con el menú contextual; no sobrescribe un nombre existente', async () => {
    const a = app()
    const page = a.page
    await row(page, 'notas.txt').focus()
    await page.keyboard.press('F2')
    let input = page.getByRole('textbox', { name: 'Nombre' })
    await expectVisible(input)
    await input.fill('README.md')
    await input.press('Enter')
    await expectVisible(page.getByRole('alert').filter({ hasText: 'Ya existe' }))
    expect(existsSync(join(repo, 'notas.txt'))).toBe(true)
    await input.fill('apuntes.txt')
    await input.press('Enter')
    await expectVisible(row(page, 'apuntes.txt'))
    expect(existsSync(join(repo, 'notas.txt'))).toBe(false)
    expect(existsSync(join(repo, 'apuntes.txt'))).toBe(true)
    // Menú contextual (clic derecho)
    await row(page, 'apuntes.txt').click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expectVisible(menu)
    for (const n of ['Nuevo archivo aquí', 'Nueva carpeta aquí', 'Renombrar', 'Mover a la Papelera'])
      await expectVisible(menu.getByRole('menuitem', { name: n }))
    await shot(a, SHOTS, 'archivos-menu-contextual')
    await menu.getByRole('menuitem', { name: 'Renombrar', exact: true }).click()
    input = page.getByRole('textbox', { name: 'Nombre' })
    await input.fill('final.txt')
    await input.press('Enter')
    await expectVisible(row(page, 'final.txt'))
    expect(existsSync(join(repo, 'final.txt'))).toBe(true)
  })

  it('eliminar manda a la Papelera (de pruebas) con confirmación; cancelar no toca nada', async () => {
    const a = app()
    const page = a.page
    await row(page, 'final.txt').hover()
    await page.getByRole('button', { name: 'Mover final.txt a la Papelera' }).click()
    const dlg = page.getByRole('alertdialog')
    await expectVisible(dlg.getByText(/¿Mover «final\.txt» a la Papelera( de reciclaje)?\?/))
    await shot(a, SHOTS, 'archivos-confirmar-papelera')
    await dlg.getByRole('button', { name: 'Cancelar' }).click()
    expect(existsSync(join(repo, 'final.txt'))).toBe(true)
    await row(page, 'final.txt').focus()
    await page.keyboard.press('Delete')
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Mover a la Papelera( de reciclaje)?$/ })
      .click()
    await expectCount(row(page, 'final.txt'), 0)
    expect(existsSync(join(repo, 'final.txt'))).toBe(false)
    expect(readdirSync(trashDir).some((n) => n.endsWith('-final.txt'))).toBe(true)
    await expectVisible(page.getByText(/«final\.txt» se movió a la Papelera( de reciclaje)?\./))
  })

  it('rutas hostiles y carpetas ajenas las rechaza main sin tocar nada', async () => {
    const a = app()
    const page = a.page
    symlinkSync(outside, join(repo, 'enlace'))
    const sec = join(outside, 'secreto.txt')
    const bad = async (area: 'files', fn: string, ...args: unknown[]): Promise<void> => {
      const r = await call(page, area, fn, ...args)
      expect(r, `${fn} ${JSON.stringify(args)}`).not.toBe('OK')
    }
    await bad('files', 'rename', repo, '../fuera/secreto.txt', 'x')
    await bad('files', 'rename', repo, '.git', 'x')
    await bad('files', 'rename', repo, '.git/HEAD', 'x')
    await bad('files', 'rename', repo, 'README.md', '../x')
    await bad('files', 'rename', repo, 'README.md', '.git')
    await bad('files', 'rename', repo, 'README.md', 'CON')
    await bad('files', 'trash', repo, '.git')
    await bad('files', 'trash', repo, '..')
    await bad('files', 'trash', repo, '.')
    await bad('files', 'trash', repo, '/etc/hosts')
    await bad('files', 'trash', repo, 'enlace/secreto.txt')
    await bad('files', 'create', repo, '..', 'x.txt', 'file')
    await bad('files', 'create', repo, '.git', 'x.txt', 'file')
    await bad('files', 'create', repo, 'enlace', 'x.txt', 'file')
    await bad('files', 'create', repo, '.', 'a/b', 'file')
    // Otra carpeta que NO es el proyecto que muestra el panel.
    await bad('files', 'create', outside, '.', 'intruso.txt', 'file')
    await bad('files', 'trash', outside, 'secreto.txt')
    await bad('editors', 'open', outside, 'zed')
    await bad('editors', 'open', repo, '/bin/sh')
    await bad('editors', 'open', repo, 'sublime') // no está «instalado» en la detección simulada
    expect(readFileSync(sec, 'utf8')).toBe('S')
    expect(existsSync(join(outside, 'x.txt'))).toBe(false)
    expect(existsSync(join(outside, 'intruso.txt'))).toBe(false)
    expect(existsSync(join(repo, '.git', 'HEAD'))).toBe(true)
    // Un enlace simbólico se renombra COMO enlace (su destino queda intacto).
    expect(await call(page, 'files', 'rename', repo, 'enlace', 'enlace2')).toBe('OK')
    expect(existsSync(join(repo, 'enlace2'))).toBe(true)
    expect(readFileSync(sec, 'utf8')).toBe('S')
    rmSync(join(repo, 'enlace2'))
  })

  it('«Abrir en…» lista los editores detectados, lanza el elegido (id del catálogo) y recuerda el último', async () => {
    const a = app()
    const page = a.page
    await page.getByRole('button', { name: 'Abrir en…', exact: true }).click()
    const menu = page.getByRole('menu')
    await expectVisible(menu.getByRole('menuitem', { name: /Visual Studio Code/ }))
    await expectVisible(menu.getByRole('menuitem', { name: /Zed/ }))
    await expectVisible(menu.getByRole('menuitem', { name: /Predeterminado del sistema/ }))
    await expectCount(menu.getByRole('menuitem', { name: /Cursor/ }), 0)
    await shot(a, SHOTS, 'archivos-abrir-en')
    await menu.getByRole('menuitem', { name: /Zed/ }).click()
    await expect.poll(() => existsSync(editorLog), { timeout: 10_000 }).toBe(true)
    const calls = readFileSync(editorLog, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ id: 'zed', folder: repo })
    expect(calls[0].spec.args).toContain(repo)
    // Recuerda el último: ahora va primero y marcado.
    await page.getByRole('button', { name: 'Abrir en…', exact: true }).click()
    const first = page.getByRole('menu').getByRole('menuitem').first()
    await expectVisible(first.filter({ hasText: 'Zed' }))
    await expectVisible(first.filter({ hasText: 'Último usado' }))
    await page.keyboard.press('Escape')
  })
})
